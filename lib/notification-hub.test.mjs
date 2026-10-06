import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const hub = await jiti.import("./notification-hub.ts");
const { DEFAULT_NOTIFICATION_PREFS } = await jiti.import("./notification-events.ts");
const webpush = (await jiti.import("web-push")).default;

const NOW = 1_000_000;
const event = { type: "completed", sessionId: "s1", sessionName: "Session" };
const prefs = (patch = {}) => ({ ...DEFAULT_NOTIFICATION_PREFS, enabled: true, ...patch });
const client = (clientId, deviceId, patch = {}) => ({ clientId, deviceId, visible: false, sessionId: null, lastSeen: NOW, send: () => {}, ...patch });
const device = (deviceId, patch = {}) => ({ deviceId, prefs: prefs(), updatedAt: 0, ...patch });
const subscription = { endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" } };

test("nothing is sent anywhere while a visible tab shows the session, in either mode", () => {
  const clients = [client("viewer", "desk", { visible: true, sessionId: "s1" }), client("phone-tab", "phone")];
  const devices = [device("desk"), device("phone", { prefs: prefs({ whenActive: "system" }), subscription })];
  assert.deepEqual(hub.routeNotification(event, clients, devices, NOW), []);
});

test("active in another session: toast on the active tab only, toast-mode devices elsewhere stay quiet", () => {
  const clients = [
    client("desk-active", "desk", { visible: true, sessionId: "other" }),
    client("desk-hidden", "desk"),
    client("laptop-tab", "laptop"),
  ];
  const devices = [device("desk"), device("laptop")];
  assert.deepEqual(hub.routeNotification(event, clients, devices, NOW), [{ kind: "toast", clientId: "desk-active" }]);
});

test("'always send a system notification' devices still get one while the user is active elsewhere", () => {
  const clients = [client("desk-active", "desk", { visible: true, sessionId: "other" })];
  const devices = [device("desk", { prefs: prefs({ whenActive: "system" }) }), device("phone", { prefs: prefs({ whenActive: "system" }), subscription })];
  assert.deepEqual(hub.routeNotification(event, clients, devices, NOW), [
    { kind: "os", clientId: "desk-active" },
    { kind: "push", deviceId: "phone" },
  ]);
});

test("nobody active: push to subscribed devices, in-page to connected unsubscribed ones", () => {
  const clients = [client("desk-tab", "desk"), client("phone-tab", "phone"), client("beacon-only", "laptop", { send: undefined })];
  const devices = [device("desk"), device("phone", { subscription }), device("laptop")];
  assert.deepEqual(hub.routeNotification(event, clients, devices, NOW), [
    { kind: "os", clientId: "desk-tab" },
    { kind: "push", deviceId: "phone" },
  ]);
});

test("stale presence does not count as active", () => {
  const clients = [client("old", "desk", { visible: true, sessionId: "s1", lastSeen: NOW - hub.PRESENCE_TTL_MS - 1 })];
  assert.deepEqual(hub.routeNotification(event, clients, [device("desk")], NOW), [{ kind: "os", clientId: "old" }]);
});

test("disabled devices and disabled types get nothing", () => {
  const clients = [client("tab", "desk")];
  assert.deepEqual(hub.routeNotification(event, clients, [device("desk", { prefs: prefs({ enabled: false }) })], NOW), []);
  assert.deepEqual(hub.routeNotification(event, clients, [device("desk", { prefs: prefs({ types: { ...DEFAULT_NOTIFICATION_PREFS.types, completed: false } }) })], NOW), []);
});

test("push subscriptions must use an HTTPS endpoint", () => {
  assert.equal(hub.parsePushSubscription({ ...subscription, endpoint: "http://127.0.0.1:8080/x" }), null);
  assert.equal(hub.parsePushSubscription({ endpoint: subscription.endpoint, keys: {} }), null);
  assert.deepEqual(hub.parsePushSubscription(subscription), subscription);
});

test("a tab stays reachable when a stale stream of the same tab attaches late and then closes", (t) => {
  const previousHub = globalThis.__ompNotificationHub;
  globalThis.__ompNotificationHub = { clients: new Map(), streams: new Map(), store: { devices: [] } };
  t.after(() => { globalThis.__ompNotificationHub = previousHub; });

  // React strict mode / reconnects: the cancelled request reaches the server
  // after the live one, then its abort fires.
  const received = [];
  const detachLive = hub.attachNotificationClient("tab-0001", "desk-0001", () => received.push("live"));
  const detachStale = hub.attachNotificationClient("tab-0001", "desk-0001", () => received.push("stale"));
  detachStale();
  globalThis.__ompNotificationHub.clients.get("tab-0001").send({ kind: "toast", event });
  assert.deepEqual(received, ["live"]);

  detachLive();
  assert.equal(globalThis.__ompNotificationHub.clients.has("tab-0001"), false);
});

test("a push service 410 removes the subscription but keeps the device prefs", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "omp-notify-"));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  const previousSend = webpush.sendNotification;
  const previousHub = globalThis.__ompNotificationHub;
  process.env.PI_CODING_AGENT_DIR = dir;
  globalThis.__ompNotificationHub = undefined;
  t.after(() => {
    webpush.sendNotification = previousSend;
    globalThis.__ompNotificationHub = previousHub;
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
    rmSync(dir, { recursive: true, force: true });
  });

  let sent = 0;
  webpush.sendNotification = async () => {
    sent += 1;
    throw new webpush.WebPushError("Gone", 410, {}, "", subscription.endpoint);
  };
  hub.saveNotificationDevice("phone-device", prefs(), subscription);
  // The store holds the VAPID private key: owner-only.
  assert.equal(statSync(join(dir, "omp-web", "notifications.json")).mode & 0o077, 0);

  hub.publishNotification(event);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sent, 1);
  const stored = hub.getNotificationDevice("phone-device");
  assert.equal(stored.subscription, undefined);
  assert.equal(stored.prefs.enabled, true);
});

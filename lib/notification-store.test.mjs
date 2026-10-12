import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const store = await jiti.import("./notification-store.ts");
const { DEFAULT_NOTIFICATION_PREFS } = await jiti.import("./notification-events.ts");

const prefs = (patch = {}) => ({ ...DEFAULT_NOTIFICATION_PREFS, enabled: true, ...patch });
const subscription = (id = "abc") => ({ endpoint: `https://push.example/${id}`, keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) } });
const event = (sessionId, type = "completed") => ({ type, sessionId, sessionName: `Session ${sessionId}` });
const keys = { publicKey: "pub", privateKey: "priv" };

/** A fresh agent dir; `reopen()` drops the cached handle, as a restart or a second omp-web instance would. */
function isolated(t) {
  const dir = mkdtempSync(join(tmpdir(), "omp-notify-store-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  const reopen = () => {
    globalThis.__ompNotificationStore?.db.close();
    globalThis.__ompNotificationStore = undefined;
  };
  reopen();
  t.after(() => {
    reopen();
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, reopen };
}

test("VAPID keys are generated once and survive a restart", (t) => {
  const { reopen } = isolated(t);
  let generated = 0;
  const generate = () => (generated++, keys);
  assert.deepEqual(store.getVapidKeys(generate), keys);
  reopen();
  assert.deepEqual(store.getVapidKeys(generate), keys);
  assert.equal(generated, 1);
});

test("the database is owner-only", (t) => {
  const { dir } = isolated(t);
  store.getVapidKeys(() => keys);
  if (process.platform !== "win32") assert.equal(statSync(join(dir, "omp-web", "notifications.db")).mode & 0o077, 0);
});

test("saving a device without a subscription keeps the stored one", (t) => {
  isolated(t);
  store.saveDevice("phone-0001", prefs(), subscription());
  const saved = store.saveDevice("phone-0001", prefs({ locale: "ja" }));
  assert.deepEqual(saved.subscription, subscription());
  assert.equal(store.getDevice("phone-0001").prefs.locale, "ja");
});

test("a push endpoint moves to the device that saved it last", (t) => {
  isolated(t);
  store.saveDevice("old-device", prefs(), subscription());
  store.saveDevice("new-device", prefs(), subscription());
  assert.equal(store.getDevice("old-device"), undefined);
  assert.deepEqual(store.getDevice("new-device").subscription, subscription());
});

test("over 50 devices, idle ones are dropped before enabled or subscribed ones, then the oldest", (t) => {
  isolated(t);
  store.saveDevice("idle-0001", prefs({ enabled: false }));
  store.saveDevice("subscribed", prefs({ enabled: false }), subscription());
  for (let i = 0; i < 49; i++) store.saveDevice(`enabled-${String(i).padStart(4, "0")}`, prefs());
  const ids = store.listDevices().map((device) => device.deviceId);
  assert.equal(ids.length, 50);
  assert.ok(!ids.includes("idle-0001"));
  assert.ok(ids.includes("subscribed"));
});

test("devices and keys written by one instance are seen by another", (t) => {
  const { reopen } = isolated(t);
  store.saveDevice("desk-0001", prefs());
  reopen();
  assert.equal(store.getDevice("desk-0001").prefs.enabled, true);
});

test("changing PI_CODING_AGENT_DIR opens the new location", (t) => {
  isolated(t);
  store.saveDevice("desk-0001", prefs());
  isolated(t);
  assert.equal(store.getDevice("desk-0001"), undefined);
});

test("recording a reused id moves it to the top and makes it unread again", (t) => {
  isolated(t);
  store.recordHistory(event("s1"), 1);
  store.recordHistory(event("s2"), 2);
  store.markHistoryRead("all");
  const entry = store.recordHistory({ ...event("s1"), sessionName: "renamed" }, 3);
  assert.deepEqual(entry, { id: "s1:completed", event: { ...event("s1"), sessionName: "renamed" }, at: 3, read: false });
  assert.deepEqual(store.listHistory().map((e) => [e.id, e.read]), [["s1:completed", false], ["s2:completed", true]]);
});

test("history keeps the newest 100 entries", (t) => {
  isolated(t);
  for (let i = 0; i < 105; i++) store.recordHistory(event(`s${i}`), i);
  const entries = store.listHistory();
  assert.equal(entries.length, 100);
  assert.equal(entries[0].id, "s104:completed");
  assert.equal(entries.at(-1).id, "s5:completed");
});

test("mark read by ids or all, remove one, clear", (t) => {
  isolated(t);
  for (const id of ["s1", "s2", "s3"]) store.recordHistory(event(id));
  store.markHistoryRead(["s1:completed", "unknown"]);
  assert.deepEqual(store.listHistory().filter((e) => e.read).map((e) => e.id), ["s1:completed"]);
  store.markHistoryRead("all");
  assert.ok(store.listHistory().every((e) => e.read));
  store.removeHistory("s2:completed");
  assert.deepEqual(store.listHistory().map((e) => e.id).sort(), ["s1:completed", "s3:completed"]);
  store.clearHistory();
  assert.deepEqual(store.listHistory(), []);
});

function writeLegacy(dir, content) {
  mkdirSync(join(dir, "omp-web"), { recursive: true });
  const file = join(dir, "omp-web", "notifications.json");
  writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  return file;
}

test("keys and devices are imported from notifications.json, which is then removed", (t) => {
  const { dir } = isolated(t);
  const file = writeLegacy(dir, {
    vapid: keys,
    devices: [
      { deviceId: "phone-0001", prefs: prefs({ locale: "ja" }), subscription: subscription(), updatedAt: 5 },
      { deviceId: "bad id!", prefs: prefs(), updatedAt: 1 },
    ],
  });
  assert.deepEqual(store.getVapidKeys(() => assert.fail("must reuse the imported keys")), keys);
  assert.deepEqual(store.listDevices().map((d) => [d.deviceId, d.prefs.locale, d.updatedAt]), [["phone-0001", "ja", 5]]);
  assert.ok(!existsSync(file));
});

test("a leftover notifications.json does not overwrite an existing store", (t) => {
  const { dir, reopen } = isolated(t);
  store.getVapidKeys(() => keys);
  reopen();
  writeLegacy(dir, { vapid: { publicKey: "other", privateKey: "other" }, devices: [] });
  assert.deepEqual(store.getVapidKeys(() => assert.fail("keys exist")), keys);
});

test("a corrupt notifications.json stays in place and the store starts empty", (t) => {
  const { dir } = isolated(t);
  const file = writeLegacy(dir, "{not json");
  assert.deepEqual(store.listDevices(), []);
  assert.ok(existsSync(file));
});

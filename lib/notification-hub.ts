import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import webpush, { type PushSubscription } from "web-push";
import en from "./i18n/locales/en.json";
import ja from "./i18n/locales/ja.json";
import zhCN from "./i18n/locales/zh-CN.json";
import { getAgentDir } from "./omp/paths";
import {
  parseNotificationPrefs,
  renderNotification,
  type NotificationEvent,
  type NotificationPrefs,
  type RenderedNotification,
} from "./notification-events";

/**
 * Server side of notifications: presence of open tabs, per-device preferences
 * and Web Push subscriptions, and routing each event to an in-app toast, an
 * in-page system notification, or a push.
 */

/** A tab counts as present this long after its last presence report. */
export const PRESENCE_TTL_MS = 60_000;
const MAX_DEVICES = 50;
const PUSH_TTL_SECONDS = 3600;
// Apple's push service rejects VAPID subjects it cannot resolve (e.g. localhost mail).
const VAPID_SUBJECT = "https://github.com/kahme247/ompweb";

export interface NotificationClient {
  clientId: string;
  deviceId: string;
  visible: boolean;
  sessionId: string | null;
  lastSeen: number;
  /** Set while the tab holds its notification SSE stream. */
  send?: (message: NotificationMessage) => void;
}

export interface NotificationDevice {
  deviceId: string;
  prefs: NotificationPrefs;
  subscription?: PushSubscription;
  updatedAt: number;
}

export type NotificationMessage = { kind: "toast" | "os"; event: NotificationEvent };

export type Delivery =
  | { kind: "toast" | "os"; clientId: string }
  | { kind: "push"; deviceId: string };

interface StoreFile {
  vapid?: { publicKey: string; privateKey: string };
  devices: NotificationDevice[];
}

interface HubState {
  clients: Map<string, NotificationClient>;
  /** Open SSE streams per client: a remount or reconnect can overlap the old stream's close. */
  streams: Map<string, Set<(message: NotificationMessage) => void>>;
  store: StoreFile | null;
}

declare global {
  var __ompNotificationHub: HubState | undefined;
}

function hub(): HubState {
  return (globalThis.__ompNotificationHub ??= { clients: new Map(), streams: new Map(), store: null });
}

const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function isValidNotificationId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

/** Validate an untrusted PushSubscription JSON; only HTTPS push endpoints are accepted. */
export function parsePushSubscription(value: unknown): PushSubscription | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const keys = raw.keys && typeof raw.keys === "object" ? (raw.keys as Record<string, unknown>) : {};
  if (typeof raw.endpoint !== "string" || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") return null;
  try {
    if (new URL(raw.endpoint).protocol !== "https:") return null;
  } catch {
    return null;
  }
  return { endpoint: raw.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

// ---------------------------------------------------------------- store

function storePath(): string {
  return resolve(getAgentDir(), "omp-web", "notifications.json");
}

function loadStore(): StoreFile {
  const state = hub();
  if (state.store) return state.store;
  let store: StoreFile = { devices: [] };
  try {
    if (existsSync(storePath())) {
      const parsed = JSON.parse(readFileSync(storePath(), "utf8")) as Partial<StoreFile>;
      const devices = Array.isArray(parsed.devices) ? parsed.devices : [];
      store = {
        vapid: parsed.vapid && typeof parsed.vapid.publicKey === "string" && typeof parsed.vapid.privateKey === "string" ? parsed.vapid : undefined,
        devices: devices.flatMap((device) => {
          if (!device || !isValidNotificationId(device.deviceId)) return [];
          const subscription = parsePushSubscription(device.subscription) ?? undefined;
          return [{ deviceId: device.deviceId, prefs: parseNotificationPrefs(device.prefs), subscription, updatedAt: Number(device.updatedAt) || 0 }];
        }),
      };
    }
  } catch {
    // A corrupt file only loses device prefs; tabs re-register on load.
  }
  state.store = store;
  return store;
}

/** Atomic write (temp file + rename), owner-only: the file holds the VAPID private key. */
function saveStore(store: StoreFile): void {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temp, path);
  } finally {
    try {
      if (existsSync(temp)) rmSync(temp);
    } catch {
      // ignore cleanup failures
    }
  }
}

function vapidKeys(): { publicKey: string; privateKey: string } {
  const store = loadStore();
  if (!store.vapid) {
    store.vapid = webpush.generateVAPIDKeys();
    saveStore(store);
  }
  return store.vapid;
}

export function getVapidPublicKey(): string {
  return vapidKeys().publicKey;
}

export function getNotificationDevice(deviceId: string): NotificationDevice | undefined {
  return loadStore().devices.find((device) => device.deviceId === deviceId);
}

/**
 * Store a device's prefs. `subscription`: a value replaces the stored one,
 * `null` removes it, `undefined` keeps it.
 */
export function saveNotificationDevice(deviceId: string, prefs: NotificationPrefs, subscription: PushSubscription | null | undefined): NotificationDevice {
  const store = loadStore();
  const existing = store.devices.find((device) => device.deviceId === deviceId);
  const device: NotificationDevice = {
    deviceId,
    prefs,
    subscription: subscription === undefined ? existing?.subscription : subscription ?? undefined,
    updatedAt: Date.now(),
  };
  // A push endpoint belongs to one browser; drop it from any other device id.
  const others = store.devices.filter((entry) => entry.deviceId !== deviceId && !(device.subscription && entry.subscription?.endpoint === device.subscription.endpoint));
  store.devices = [device, ...others].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_DEVICES);
  saveStore(store);
  return device;
}

function dropSubscription(deviceId: string, endpoint: string): void {
  const store = loadStore();
  const device = store.devices.find((entry) => entry.deviceId === deviceId);
  if (!device?.subscription || device.subscription.endpoint !== endpoint) return;
  device.subscription = undefined;
  saveStore(store);
}

// ---------------------------------------------------------------- presence

function liveClients(now: number): NotificationClient[] {
  const { clients } = hub();
  for (const [id, client] of clients) {
    if (!client.send && now - client.lastSeen > PRESENCE_TTL_MS) clients.delete(id);
  }
  return [...clients.values()];
}

export function reportPresence(report: { clientId: string; deviceId: string; visible: boolean; sessionId: string | null }): void {
  const { clients } = hub();
  const existing = clients.get(report.clientId);
  clients.set(report.clientId, { ...existing, ...report, lastSeen: Date.now() });
}

/** Attach a tab's SSE stream. Returns the detach callback. */
export function attachNotificationClient(clientId: string, deviceId: string, send: (message: NotificationMessage) => void): () => void {
  const state = hub();
  const streams = state.streams.get(clientId) ?? new Set();
  streams.add(send);
  state.streams.set(clientId, streams);
  const existing = state.clients.get(clientId);
  state.clients.set(clientId, {
    clientId,
    deviceId,
    visible: existing?.visible ?? false,
    sessionId: existing?.sessionId ?? null,
    lastSeen: existing?.lastSeen ?? 0,
    send: (message) => streams.forEach((stream) => stream(message)),
  });
  return () => {
    streams.delete(send);
    // The tab is gone once its last stream closes; its presence goes with it.
    if (streams.size === 0 && state.streams.get(clientId) === streams) {
      state.streams.delete(clientId);
      state.clients.delete(clientId);
    }
  };
}

// ---------------------------------------------------------------- routing

function isActive(client: NotificationClient, now: number): boolean {
  return client.visible && now - client.lastSeen <= PRESENCE_TTL_MS;
}

/**
 * Decide where one event goes.
 * 1. A visible tab is showing the session: nothing, for every device.
 * 2. The user is active in some tab and the device prefers toasts: toast to
 *    that device's active tabs only (other devices stay quiet).
 * 3. Otherwise a system notification: push when the device has a
 *    subscription, else in-page on each of its connected tabs.
 */
export function routeNotification(event: NotificationEvent, clients: NotificationClient[], devices: NotificationDevice[], now: number): Delivery[] {
  if (event.type === "test") return [];
  if (clients.some((client) => isActive(client, now) && client.sessionId === event.sessionId)) return [];
  const anyActive = clients.some((client) => isActive(client, now));
  const deliveries: Delivery[] = [];
  for (const device of devices) {
    if (!device.prefs.enabled || !device.prefs.types[event.type]) continue;
    const own = clients.filter((client) => client.deviceId === device.deviceId && client.send);
    if (anyActive && device.prefs.whenActive === "toast") {
      for (const client of own) if (isActive(client, now)) deliveries.push({ kind: "toast", clientId: client.clientId });
    } else if (device.subscription) {
      deliveries.push({ kind: "push", deviceId: device.deviceId });
    } else {
      for (const client of own) deliveries.push({ kind: "os", clientId: client.clientId });
    }
  }
  return deliveries;
}

const dictionaries: Record<string, Record<string, string>> = { en, ja, "zh-CN": zhCN };

function renderFor(event: NotificationEvent, locale: string): RenderedNotification {
  const dictionary = Object.hasOwn(dictionaries, locale) ? dictionaries[locale] : dictionaries.en;
  return renderNotification(event, (key, vars) => {
    const template = dictionary[key] ?? dictionaries.en[key] ?? key;
    return vars ? template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match)) : template;
  });
}

async function sendPush(device: NotificationDevice, event: NotificationEvent): Promise<void> {
  const subscription = device.subscription;
  if (!subscription) return;
  const { publicKey, privateKey } = vapidKeys();
  try {
    await webpush.sendNotification(subscription, JSON.stringify(renderFor(event, device.prefs.locale)), {
      TTL: PUSH_TTL_SECONDS,
      urgency: event.type === "input" || event.type === "error" ? "high" : "normal",
      vapidDetails: { subject: VAPID_SUBJECT, publicKey, privateKey },
    });
  } catch (error) {
    const status = error instanceof webpush.WebPushError ? error.statusCode : undefined;
    // 404/410: the browser unsubscribed or the subscription expired.
    if (status === 404 || status === 410) dropSubscription(device.deviceId, subscription.endpoint);
    else console.warn("[notifications] push failed:", status ?? String(error));
  }
}

function sendToClient(clientId: string, message: NotificationMessage): void {
  try {
    hub().clients.get(clientId)?.send?.(message);
  } catch {
    // A closing stream must not break delivery to the others.
  }
}

export function publishNotification(event: NotificationEvent): void {
  const now = Date.now();
  const devices = loadStore().devices;
  for (const delivery of routeNotification(event, liveClients(now), devices, now)) {
    if (delivery.kind === "push") {
      const device = devices.find((entry) => entry.deviceId === delivery.deviceId);
      if (device) void sendPush(device, event);
    } else {
      sendToClient(delivery.clientId, { kind: delivery.kind, event });
    }
  }
}

/** Settings "Send test notification": the requesting device's system path, ignoring presence. */
export async function sendTestNotification(deviceId: string, clientId: string): Promise<"push" | "os"> {
  const event: NotificationEvent = { type: "test", sessionId: "", sessionName: "omp web" };
  const device = getNotificationDevice(deviceId);
  if (device?.subscription) {
    await sendPush(device, event);
    return "push";
  }
  sendToClient(clientId, { kind: "os", event });
  return "os";
}

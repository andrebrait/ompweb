/**
 * Browser side of notifications: device identity, per-device preferences,
 * service worker registration, Web Push subscription, and system notifications.
 * Server routing lives in lib/notification-hub.ts.
 */
import {
  DEFAULT_NOTIFICATION_PREFS,
  parseNotificationPrefs,
  type NotificationPrefs,
  type RenderedNotification,
} from "./notification-events";

const DEVICE_KEY = "omp-notify-device";
const PREFS_KEY = "omp-notify-prefs";

/** One id per page load: a duplicated tab copies sessionStorage, so it cannot hold this. */
export const notificationClientId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `c${Date.now()}${Math.random().toString(36).slice(2)}`;

let deviceId: string | null = null;

/** Stable per browser profile: shared by all tabs of this browser. */
export function getNotificationDeviceId(): string {
  if (deviceId) return deviceId;
  try {
    deviceId = localStorage.getItem(DEVICE_KEY);
    if (!deviceId || !/^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) {
      deviceId = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, deviceId);
    }
  } catch {
    deviceId ??= crypto.randomUUID();
  }
  return deviceId;
}

/** Query string that attaches this tab to notification delivery on the running-sessions SSE stream. */
export function notificationStreamQuery(): string {
  return `clientId=${encodeURIComponent(notificationClientId)}&deviceId=${encodeURIComponent(getNotificationDeviceId())}`;
}

// ---------------------------------------------------------------- prefs store

const listeners = new Set<() => void>();
let prefs: NotificationPrefs | null = null;

export function getNotificationPrefs(): NotificationPrefs {
  if (prefs) return prefs;
  try {
    const stored = localStorage.getItem(PREFS_KEY);
    prefs = stored ? parseNotificationPrefs(JSON.parse(stored)) : DEFAULT_NOTIFICATION_PREFS;
  } catch {
    prefs = DEFAULT_NOTIFICATION_PREFS;
  }
  return prefs;
}

export function subscribeNotificationPrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Save locally, then mirror to the server (which routes pushes while no tab is open). */
export async function updateNotificationPrefs(patch: Partial<NotificationPrefs>): Promise<void> {
  prefs = { ...getNotificationPrefs(), ...patch };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // storage unavailable: prefs still apply for this page and on the server
  }
  listeners.forEach((listener) => listener());
  await syncNotificationDevice();
}

/**
 * Send prefs (and optionally a push subscription change) to the server.
 * Returns whether the server holds a push subscription for this device.
 */
export async function syncNotificationDevice(subscription?: PushSubscriptionJSON | null): Promise<boolean> {
  const response = await fetch("/api/notifications/devices", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: getNotificationDeviceId(), prefs: getNotificationPrefs(), ...(subscription !== undefined ? { subscription } : {}) }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = (await response.json()) as { subscribed?: boolean };
  return body.subscribed === true;
}

// ---------------------------------------------------------------- support

export type NotificationSupport = "unsupported" | "insecure" | "ios-install" | "denied" | "no-push" | "push";

function isIosBrowserTab(): boolean {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || ("standalone" in navigator && navigator.standalone === true);
  return ios && !standalone;
}

/** What this browser can do for system notifications. In-app toasts work everywhere. */
export function getNotificationSupport(): NotificationSupport {
  if (!window.isSecureContext) return "insecure";
  if (isIosBrowserTab()) return "ios-install";
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return "PushManager" in window ? "push" : "no-push";
}

// ---------------------------------------------------------------- service worker + push

export async function registerNotificationWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = (value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

function sameKey(key: ArrayBuffer | null | undefined, expected: Uint8Array): boolean {
  if (!key) return false;
  const actual = new Uint8Array(key);
  return actual.length === expected.length && actual.every((byte, index) => byte === expected[index]);
}

/**
 * Make sure this device has a push subscription for the server's VAPID key
 * and the server knows it. Needs notification permission already granted.
 * Returns whether push is active.
 */
export async function ensurePushSubscription(): Promise<boolean> {
  if (getNotificationSupport() !== "push" || Notification.permission !== "granted") return false;
  const registration = await registerNotificationWorker();
  if (!registration) return false;
  const response = await fetch(`/api/notifications/devices?deviceId=${encodeURIComponent(getNotificationDeviceId())}`);
  if (!response.ok) return false;
  const { publicKey } = (await response.json()) as { publicKey: string };
  const applicationServerKey = base64UrlToBytes(publicKey);
  let subscription = await registration.pushManager.getSubscription();
  // A server that lost its keys signs with new ones; the old subscription would be rejected.
  if (subscription && !sameKey(subscription.options.applicationServerKey, applicationServerKey)) {
    await subscription.unsubscribe().catch(() => false);
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
  return syncNotificationDevice(subscription.toJSON());
}

/** Show a system notification the same way the service worker shows pushes. */
export async function showSystemNotification(notification: RenderedNotification): Promise<void> {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const options: NotificationOptions = {
    body: notification.body,
    icon: "/icon-192.png",
    badge: "/badge-96.png",
    tag: notification.tag,
    data: { url: notification.url, sessionId: notification.sessionId },
  };
  const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  if (registration) {
    await registration.showNotification(notification.title, options);
    return;
  }
  // No worker (registration failed or unsupported): Chrome on Android throws
  // here, desktop browsers show it.
  try {
    const fallback = new Notification(notification.title, options);
    fallback.onclick = () => {
      fallback.close();
      window.focus();
      window.dispatchEvent(new CustomEvent(OPEN_SESSION_EVENT, { detail: notification.sessionId }));
    };
  } catch {
    // blocked: nothing else to do
  }
}

/** Window event (detail: session id) asking the app to open a notification's session. */
export const OPEN_SESSION_EVENT = "omp-open-session";

/** Window event (detail: `{kind, event}` from the server) for a notification delivered to this tab. */
export const NOTIFICATION_MESSAGE_EVENT = "omp-notification";

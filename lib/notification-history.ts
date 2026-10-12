import { useSyncExternalStore } from "react";
import type { NotificationEvent, NotificationHistoryEntry } from "./notification-events";
import { isRecord } from "./type-guards";

/**
 * Browser mirror of the server's notification history (Notifications tab).
 * The server records every notification; this list shows them, updates at
 * once on read/remove/clear, and reloads from the server when a change
 * request fails or the tab becomes visible.
 */

const HISTORY_URL = "/api/notifications/history";
const LIMIT = 100;

let entries: NotificationHistoryEntry[] = [];
const listeners = new Set<() => void>();
function set(next: NotificationHistoryEntry[]) {
  entries = next;
  for (const listener of listeners) listener();
}

const isEntry = (value: unknown): value is NotificationHistoryEntry =>
  isRecord(value) && typeof value.id === "string" && isRecord(value.event) && typeof value.event.sessionId === "string" && typeof value.event.type === "string" && typeof value.at === "number" && typeof value.read === "boolean";

function send(method: "PATCH" | "DELETE", body?: object) {
  void fetch(HISTORY_URL, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    })
    // The server's list is the truth; drop the local change rather than show a state it does not have.
    .catch(() => notificationHistory.load());
}

export const notificationHistory = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  get: () => entries,
  /** Replace the list with the server's; a failed request keeps the current one. */
  async load() {
    try {
      const response = await fetch(HISTORY_URL);
      if (!response.ok) return;
      const body: unknown = await response.json();
      if (isRecord(body) && Array.isArray(body.entries)) set(body.entries.filter(isEntry));
    } catch {
      // Offline: keep what is shown; the next load catches up.
    }
  },
  /** A notification delivered to this tab, already recorded by the server. */
  add(event: NotificationEvent) {
    const id = `${event.sessionId}:${event.type}`;
    set([{ id, event, at: Date.now(), read: false }, ...entries.filter((entry) => entry.id !== id)].slice(0, LIMIT));
  },
  markRead(id: string) {
    if (!entries.some((entry) => entry.id === id && !entry.read)) return;
    set(entries.map((entry) => (entry.id === id ? { ...entry, read: true } : entry)));
    send("PATCH", { ids: [id] });
  },
  /** Marks the entries this tab shows; ones that reached the server since stay unread. */
  markAllRead() {
    const unread = entries.filter((entry) => !entry.read).map((entry) => entry.id);
    if (unread.length === 0) return;
    set(entries.map((entry) => (entry.read ? entry : { ...entry, read: true })));
    send("PATCH", { ids: unread });
  },
  remove(id: string) {
    set(entries.filter((entry) => entry.id !== id));
    send("DELETE", { id });
  },
  clear() {
    set([]);
    send("DELETE");
  },
};

export function useNotificationHistory(): NotificationHistoryEntry[] {
  return useSyncExternalStore(notificationHistory.subscribe, notificationHistory.get, notificationHistory.get);
}

const unreadCount = () => entries.reduce((count, entry) => count + (entry.read ? 0 : 1), 0);
/** Unread entry count. A primitive snapshot, so callers re-render only when the count changes. */
export function useUnreadNotificationCount(): number {
  return useSyncExternalStore(notificationHistory.subscribe, unreadCount, unreadCount);
}

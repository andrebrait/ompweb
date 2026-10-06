import { createElement, useEffect, useRef, useSyncExternalStore } from "react";
import { toast } from "@/components/ui/toast";
import { translate } from "@/lib/i18n";
import { DEFAULT_NOTIFICATION_PREFS, renderNotification, type NotificationEvent } from "@/lib/notification-events";
import {
  ensurePushSubscription,
  getNotificationDeviceId,
  getNotificationPrefs,
  NOTIFICATION_MESSAGE_EVENT,
  notificationClientId,
  OPEN_SESSION_EVENT,
  registerNotificationWorker,
  showSystemNotification,
  subscribeNotificationPrefs,
  syncNotificationDevice,
  updateNotificationPrefs,
} from "@/lib/notification-client";

const PRESENCE_INTERVAL_MS = 30_000;

/** Current per-device notification prefs (re-renders on change). */
export function useNotificationPrefs() {
  return useSyncExternalStore(subscribeNotificationPrefs, getNotificationPrefs, () => DEFAULT_NOTIFICATION_PREFS);
}

/**
 * App-level notification wiring, mounted once in AppShell:
 * - tells the server which session this tab shows and whether it is visible;
 * - shows toasts / system notifications the server routes to this tab;
 * - opens the session when a notification is clicked;
 * - keeps the server's copy of this device's prefs and push subscription current.
 */
export function useNotifications({ sessionId, locale, onOpenSession }: { sessionId: string | null; locale: string; onOpenSession: (sessionId: string) => void }) {
  const openRef = useRef(onOpenSession);
  useEffect(() => {
    openRef.current = onOpenSession;
  }, [onOpenSession]);

  // Presence: every change of visibility or session, plus a keep-alive.
  useEffect(() => {
    const report = (visible = document.visibilityState === "visible") => {
      const body = JSON.stringify({ clientId: notificationClientId, deviceId: getNotificationDeviceId(), visible, sessionId });
      if (!visible && navigator.sendBeacon) {
        navigator.sendBeacon("/api/notifications/presence", new Blob([body], { type: "application/json" }));
        return;
      }
      void fetch("/api/notifications/presence", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    };
    const onVisibility = () => report();
    const onPageHide = () => report(false);
    report();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") report();
    }, PRESENCE_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [sessionId]);

  // Pushes are written in the device's language.
  useEffect(() => {
    if (getNotificationPrefs().locale !== locale) void updateNotificationPrefs({ locale }).catch(() => {});
  }, [locale]);

  // Startup sync: the server may have lost its store, or the browser its subscription.
  useEffect(() => {
    void (async () => {
      if (getNotificationPrefs().enabled) {
        await registerNotificationWorker();
        if (await ensurePushSubscription().catch(() => false)) return;
      }
      await syncNotificationDevice();
    })().catch(() => {});
  }, []);

  // Delivery to this tab and notification clicks.
  useEffect(() => {
    const onMessage = (raw: Event) => {
      if (!(raw instanceof CustomEvent)) return;
      // Sent by SessionSidebar from our own SSE stream.
      const { kind, event }: { kind: "toast" | "os"; event: NotificationEvent } = raw.detail;
      const rendered = renderNotification(event, translate);
      if (kind === "os") {
        void showSystemNotification(rendered);
        return;
      }
      const description = createElement(
        "span",
        null,
        rendered.body,
        rendered.sessionId
          ? createElement(
              "button",
              {
                type: "button",
                className: "notification-toast-open",
                onClick: () => {
                  toast.close(rendered.tag);
                  openRef.current(rendered.sessionId);
                },
              },
              translate("notifications.open"),
            )
          : null,
      );
      const show = event.type === "error" ? toast.error : toast.info;
      show(rendered.title, description, { id: rendered.tag });
    };
    const onOpen = (raw: Event) => {
      if (raw instanceof CustomEvent && typeof raw.detail === "string" && raw.detail) openRef.current(raw.detail);
    };
    const onWorkerMessage = (message: MessageEvent) => {
      const data: unknown = message.data;
      if (data && typeof data === "object" && "type" in data && data.type === "omp-open-session" && "sessionId" in data && typeof data.sessionId === "string") {
        openRef.current(data.sessionId);
      }
    };
    window.addEventListener(NOTIFICATION_MESSAGE_EVENT, onMessage);
    window.addEventListener(OPEN_SESSION_EVENT, onOpen);
    navigator.serviceWorker?.addEventListener("message", onWorkerMessage);
    return () => {
      window.removeEventListener(NOTIFICATION_MESSAGE_EVENT, onMessage);
      window.removeEventListener(OPEN_SESSION_EVENT, onOpen);
      navigator.serviceWorker?.removeEventListener("message", onWorkerMessage);
    };
  }, []);
}

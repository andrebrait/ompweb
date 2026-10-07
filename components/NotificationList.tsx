"use client";

import { BellOff, X } from "lucide-react";
import { useRef } from "react";
import { useI18n } from "@/lib/i18n";
import { ClampedDescription, descriptionBaseStyle, dismissButtonStyle, KindIcon, toastHistory, useToastHistory } from "./ui/toast";

/** Notifications tab of the right panel: recent toasts and OS notifications, newest first. */
export function NotificationList() {
  const { t, locale } = useI18n();
  const entries = useToastHistory();
  // Dismissing unmounts the focused button; keep keyboard focus in the list.
  const listRef = useRef<HTMLDivElement>(null);
  if (entries.length === 0) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 24, textAlign: "center" }}>
        <BellOff size={26} strokeWidth={1.5} aria-hidden="true" style={{ color: "var(--text-dim)" }} />
        <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 600 }}>{t("appShell.notificationsEmpty")}</div>
      </div>
    );
  }
  return (
    <div ref={listRef} tabIndex={-1} style={{ flex: 1, minHeight: 0, overflowY: "auto", outline: "none" }}>
      <ul style={{ listStyle: "none", margin: 0, padding: 4 }}>
        {entries.map((entry) => (
          <li key={entry.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: 8, borderRadius: "var(--radius-control)", background: entry.read ? undefined : "var(--bg-subtle)" }}>
            <KindIcon kind={entry.kind} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <span className="display-serif" style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.4, overflowWrap: "anywhere" }}>{entry.title}</span>
                {!entry.read && (
                  <span role="img" aria-label={t("appShell.notificationUnread")} style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", flexShrink: 0, alignSelf: "center" }} />
                )}
                <time dateTime={new Date(entry.at).toISOString()} style={{ fontSize: 11, color: "var(--text-dim)", flexShrink: 0 }}>
                  {new Date(entry.at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
                </time>
              </div>
              {entry.description != null && (
                <div style={{ ...descriptionBaseStyle, overflowWrap: "anywhere" }}>
                  {entry.clamp ? <ClampedDescription>{entry.description}</ClampedDescription> : entry.description}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                toastHistory.remove(entry.id);
                listRef.current?.focus();
              }}
              aria-label={t("appShell.notificationDismiss")}
              title={t("appShell.notificationDismiss")}
              className="toast-close-button ui-focus-ring"
              style={dismissButtonStyle}
            >
              <X size={12} strokeWidth={2} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

"use client";

import { Popover } from "@base-ui/react/popover";
import { Bell, X } from "lucide-react";
import { useRef, useSyncExternalStore } from "react";
import { useI18n } from "@/lib/i18n";
import { ClampedDescription, descriptionBaseStyle, dismissButtonStyle, KindIcon, toastHistory } from "./ui/toast";

/** Top-bar bell listing recent toasts, so a toast that timed out can still be read and acted on. */
export function NotificationCenter() {
  const { t, locale } = useI18n();
  const entries = useSyncExternalStore(toastHistory.subscribe, toastHistory.get, toastHistory.get);
  // Removing an entry unmounts the focused button; keep keyboard focus inside the popup.
  const popupRef = useRef<HTMLDivElement>(null);
  const removeAndRefocus = (remove: () => void) => {
    remove();
    popupRef.current?.focus();
  };
  const label = t("appShell.notifications");
  return (
    <Popover.Root>
      <Popover.Trigger className="shell-toolbar-btn ui-focus-ring" title={label} aria-label={label}>
        <Bell size={16} strokeWidth={1.8} aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={4} align="start" style={{ zIndex: 2000 }}>
          <Popover.Popup
            ref={popupRef}
            className="dropdown-surface"
            style={{
              width: "min(92vw, 380px)",
              maxHeight: "min(70vh, 520px)",
              display: "flex",
              flexDirection: "column",
              background: "var(--bg-panel)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-card)",
              boxShadow: "var(--shadow-pop)",
              outline: "none",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
              <Popover.Title className="display-serif" style={{ margin: 0, fontSize: 14 }}>{label}</Popover.Title>
              <button
                type="button"
                onClick={() => removeAndRefocus(toastHistory.clear)}
                disabled={entries.length === 0}
                className="toast-close-button ui-focus-ring"
                style={{ border: 0, background: "transparent", color: entries.length ? "var(--accent)" : "var(--text-dim)", cursor: entries.length ? "pointer" : "default", fontSize: 12, padding: "2px 4px", borderRadius: "var(--radius-control)" }}
              >
                {t("appShell.notificationsClear")}
              </button>
            </div>
            {entries.length === 0 ? (
              <p style={{ margin: 0, padding: "20px 12px", textAlign: "center", fontSize: 12, color: "var(--text-muted)" }}>
                {t("appShell.notificationsEmpty")}
              </p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 4, overflowY: "auto" }}>
                {entries.map((entry) => (
                  <li key={entry.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px", borderRadius: "var(--radius-control)" }}>
                    <KindIcon kind={entry.kind} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                        <span className="display-serif" style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.4, overflowWrap: "anywhere" }}>{entry.title}</span>
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
                      onClick={() => removeAndRefocus(() => toastHistory.remove(entry.id))}
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
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

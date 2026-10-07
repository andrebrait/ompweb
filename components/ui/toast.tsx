"use client";

/**
 * Warm-paper toast system on @base-ui/react Toast.
 *
 * Usage anywhere (React or not):
 *   import { toast } from "./ui/toast";
 *   toast.success("Saved"); toast.error("Save failed", "Please retry");
 *   toast.info("..."); toast.success("Task complete");
 *
 * Mount <ToastProvider> once near the app root (AppShell).
 */
import { Toast } from "@base-ui/react/toast";
import { AlertCircle, Check, Info, X } from "lucide-react";
import { useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import type React from "react";

type ToastKind = "success" | "error" | "info";

interface ToastData {
  kind?: ToastKind;
  /** Clamp the description to 2 lines; click the description to expand it. */
  clamp?: boolean;
}

interface ToastOptions {
  /** Clamp the description to 2 lines; click the description to expand it. */
  clamp?: boolean;
  /** Auto-dismiss timeout in ms. 0 = sticky until dismissed. Defaults to 6s (10s for errors). */
  timeout?: number;
  /** Alias for timeout, for clarity. */
  duration?: number;
  /** Stable id for deduplication — same id will replace existing toast instead of stacking. */
  id?: string;
  /** Fired when the toast closes (dismissed by the user, `toast.close`, or timeout). */
  onClose?: () => void;
}

const manager = Toast.createToastManager<ToastData>();

const DEFAULT_TIMEOUT_MS = 6000;
const ERROR_TIMEOUT_MS = 10000;

/** Auto-dismiss delay: an explicit `timeout`/`duration` (0 = sticky) wins over the per-kind default. */
export function resolveToastTimeout(kind: ToastKind, options?: Pick<ToastOptions, "timeout" | "duration">): number {
  return options?.timeout ?? options?.duration ?? (kind === "error" ? ERROR_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
}

export const TOAST_HISTORY_LIMIT = 100;

export interface ToastHistoryEntry {
  id: string;
  kind: ToastKind;
  title: React.ReactNode;
  description?: React.ReactNode;
  clamp?: boolean;
  at: number;
}

let history: ToastHistoryEntry[] = [];
const historyListeners = new Set<() => void>();
function setHistory(next: ToastHistoryEntry[]) {
  history = next;
  for (const listener of historyListeners) listener();
}

let recordedCount = 0;

/** Recent toasts and OS notifications, newest first, kept in memory for the notification center. */
export const toastHistory = {
  subscribe(listener: () => void) {
    historyListeners.add(listener);
    return () => { historyListeners.delete(listener); };
  },
  get: () => history,
  /** Add an entry without showing a toast, e.g. for a notification already delivered by the OS. */
  record(kind: ToastKind, title: React.ReactNode, description?: React.ReactNode, options?: { id?: string; clamp?: boolean }) {
    const id = options?.id ?? `recorded-${++recordedCount}`;
    // A reused id replaces its toast on screen, so it replaces its history entry too.
    const entry: ToastHistoryEntry = { id, kind, title, description, clamp: options?.clamp, at: Date.now() };
    setHistory([entry, ...history.filter((e) => e.id !== id)].slice(0, TOAST_HISTORY_LIMIT));
  },
  remove: (id: string) => setHistory(history.filter((entry) => entry.id !== id)),
  clear: () => setHistory([]),
};

function add(kind: ToastKind, title: React.ReactNode, description?: React.ReactNode, options?: ToastOptions) {
  const timeout = resolveToastTimeout(kind, options);
  const id = manager.add({
    id: options?.id,
    title,
    description,
    type: kind,
    data: { kind, clamp: options?.clamp },
    timeout,
    ...(options?.onClose ? { onClose: options.onClose } : {}),
  });
  toastHistory.record(kind, title, description, { id, clamp: options?.clamp });
  return id;
}
export const toast = {
  success: (title: React.ReactNode, description?: React.ReactNode, options?: ToastOptions) =>
    add("success", title, description, options),
  error: (title: React.ReactNode, description?: React.ReactNode, options?: ToastOptions) =>
    add("error", title, description, options),
  info: (title: React.ReactNode, description?: React.ReactNode, options?: ToastOptions) =>
    add("info", title, description, options),
  close: (id?: string) => manager.close(id),
};

export function KindIcon({ kind }: { kind?: ToastKind }) {
  const common = { size: 13, strokeWidth: 2, style: { flexShrink: 0, marginTop: 2 } } as const;
  if (kind === "success") return <Check {...common} style={{ ...common.style, color: "var(--accent)" }} aria-hidden />;
  if (kind === "error") return <AlertCircle {...common} style={{ ...common.style, color: "var(--accent-strong)" }} aria-hidden />;
  return <Info {...common} style={{ ...common.style, color: "var(--text-muted)" }} aria-hidden />;
}

export const descriptionBaseStyle = {
  fontSize: 12,
  color: "var(--text-muted)",
  lineHeight: 1.5,
  marginTop: 2,
} as const;

/** Inline styles for a clamped description: 2-line ellipsis when collapsed, full content when expanded. */
export function clampDescriptionStyle(expanded: boolean): React.CSSProperties {
  return {
    ...descriptionBaseStyle,
    cursor: expanded ? "default" : "pointer",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    ...(expanded
      ? {}
      : {
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }),
  };
}

/**
 * Clamped text block: 2 lines with an ellipsis until clicked, then the full
 * content. Rendered inside a Toast.Description for long notices (e.g. the MCP
 * tool inventory) via toast.info(..., { clamp: true }).
 */
export function ClampedDescription({ children }: { children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <span
      onClick={() => setExpanded((v) => !v)}
      aria-expanded={expanded}
      title={expanded ? undefined : "Click to expand"}
      style={clampDescriptionStyle(expanded)}
    >
      {children}
    </span>
  );
}

export const dismissButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 20,
  height: 20,
  padding: 0,
  border: 0,
  borderRadius: "var(--radius-control)",
  background: "transparent",
  color: "var(--text-dim)",
  cursor: "pointer",
  flexShrink: 0,
} as const;

function Toaster() {
  const { toasts } = Toast.useToastManager<ToastData>();
  const isMobile = useIsMobile();
  // Clear the app chrome (topbar 36/44px + tab bar 36px) with a safe gap so
  // toasts never cover the header, tabs, or chat content.
  const topOffset = isMobile ? 88 : 80;
  return (
    <Toast.Portal>
      <Toast.Viewport
        style={{
          position: "fixed",
          top: topOffset,
          right: 16,
          zIndex: 2100,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          width: "min(92vw, 360px)",
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => (
          <Toast.Root
            key={t.id}
            toast={t}
            className="toast-card"
            style={{
              pointerEvents: "auto",
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              background: "var(--bg)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-card)",
              boxShadow: "var(--shadow-pop)",
              padding: "10px 12px",
            }}
          >
            <KindIcon kind={t.type as ToastKind | undefined} />
            <Toast.Content style={{ flex: 1, minWidth: 0 }}>
              <Toast.Title className="display-serif" style={{ fontSize: 13, lineHeight: 1.4 }} />
              {t.data?.clamp ? (
                <Toast.Description render={<div />} style={descriptionBaseStyle}>
                  <ClampedDescription>{t.description}</ClampedDescription>
                </Toast.Description>
              ) : (
                // Rendered as a div (not base-ui's default <p>): descriptions can
                // carry block-level JSX (e.g. the update toasts' flex rows), and a
                // <div> inside <p> would throw a hydration error.
                <Toast.Description render={<div />} style={descriptionBaseStyle} />
              )}
            </Toast.Content>
            <Toast.Close
              className="toast-close-button"
              aria-label="Dismiss"
              style={dismissButtonStyle}
            >
              <X size={12} strokeWidth={2} aria-hidden />
            </Toast.Close>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <Toast.Provider toastManager={manager} timeout={DEFAULT_TIMEOUT_MS} limit={4}>
      {children}
      <Toaster />
    </Toast.Provider>
  );
}

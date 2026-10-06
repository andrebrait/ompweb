/**
 * Notification events shared by the server (detection, routing, push) and the
 * browser (in-app toasts, in-page system notifications, settings).
 */

export const NOTIFICATION_TYPES = ["completed", "input", "error", "modelSwitch"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationEvent {
  /** `test` is only sent by the settings "Send test notification" button. */
  type: NotificationType | "test";
  sessionId: string;
  sessionName: string | null;
  /** Question, error text, or model-switch reason. */
  detail?: string;
  from?: string;
  to?: string;
}

export interface NotificationPrefs {
  enabled: boolean;
  types: Record<NotificationType, boolean>;
  /** While the user is active in another omp-web tab: in-app toast or system notification. */
  whenActive: "toast" | "system";
  /** UI locale, so pushes are written in the device's language. */
  locale: string;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  enabled: false,
  types: { completed: true, input: true, error: true, modelSwitch: false },
  whenActive: "toast",
  locale: "en",
};

/** Validate untrusted prefs (request bodies, localStorage); unknown fields fall back to defaults. */
export function parseNotificationPrefs(value: unknown): NotificationPrefs {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const rawTypes = raw.types && typeof raw.types === "object" ? (raw.types as Record<string, unknown>) : {};
  const types = { ...DEFAULT_NOTIFICATION_PREFS.types };
  for (const type of NOTIFICATION_TYPES) {
    if (typeof rawTypes[type] === "boolean") types[type] = rawTypes[type] as boolean;
  }
  return {
    enabled: raw.enabled === true,
    types,
    whenActive: raw.whenActive === "system" ? "system" : "toast",
    locale: typeof raw.locale === "string" && /^[A-Za-z-]{2,10}$/.test(raw.locale) ? raw.locale : "en",
  };
}

export interface RenderedNotification {
  title: string;
  body: string;
  url: string;
  tag: string;
  sessionId: string;
}

type Translate = (key: string, vars?: Record<string, string | number>) => string;

const MAX_DETAIL = 180;

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_DETAIL ? `${flat.slice(0, MAX_DETAIL - 1)}…` : flat;
}

/** Title, body, click target, and replace-tag for one event in the caller's language. */
export function renderNotification(event: NotificationEvent, t: Translate): RenderedNotification {
  const detail = event.detail ? clip(event.detail) : "";
  let body: string;
  switch (event.type) {
    case "completed":
      body = t("notifications.completedBody");
      break;
    case "input":
      body = detail ? t("notifications.inputBody", { detail }) : t("notifications.inputBodyNoDetail");
      break;
    case "error":
      body = detail ? t("notifications.errorBody", { detail }) : t("notifications.errorBodyNoDetail");
      break;
    case "modelSwitch":
      if (event.from && event.to) {
        body = detail
          ? t("notifications.modelSwitchBody", { from: event.from, to: event.to, detail })
          : t("notifications.modelSwitchBodyNoDetail", { from: event.from, to: event.to });
      } else {
        body = detail;
      }
      break;
    case "test":
      body = t("notifications.testBody");
      break;
  }
  return {
    title: event.sessionName || t("notifications.untitledSession"),
    body,
    url: event.sessionId ? `/?session=${encodeURIComponent(event.sessionId)}` : "/",
    tag: `${event.sessionId}:${event.type}`,
    sessionId: event.sessionId,
  };
}

const MODEL_SWITCH_NOTICE_SOURCES: Record<string, true> = { prewalk: true, "plan-yolo": true };

/** Extension UI methods that block the agent until the user answers. */
const INPUT_METHODS: Record<string, true> = { select: true, confirm: true, input: true, editor: true, ask: true, open_url: true };

type Frame = Record<string, unknown> & { type?: unknown };

const str = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value : undefined);

/**
 * Per-session detector: feed it every top-level rpc-ui frame in order. Subagent
 * activity arrives wrapped in `subagent_*` frames and is never inspected.
 *
 * "completed" fires on `session_settled` (the run and any background work it
 * started are done), unless the last prompt in that stretch failed or was
 * aborted. Errors fire on the failing `prompt_result` itself.
 */
export function createNotificationDetector(): (frame: Frame, session: { sessionId: string; sessionName: string | null }) => NotificationEvent | null {
  let lastOutcome: string | null = null;
  let lastRetryError: string | undefined;

  return (frame, { sessionId, sessionName }) => {
    const base = { sessionId, sessionName };
    switch (frame.type) {
      case "auto_retry_start":
        lastRetryError = str(frame.errorMessage);
        return null;
      case "retry_fallback_applied": {
        const from = str(frame.from);
        const to = str(frame.to);
        if (!from || !to) return null;
        return { ...base, type: "modelSwitch", from, to, detail: str(frame.reason) ?? lastRetryError };
      }
      case "notice": {
        const source = str(frame.source);
        const message = str(frame.message);
        if (!source || !message || MODEL_SWITCH_NOTICE_SOURCES[source] !== true) return null;
        return { ...base, type: "modelSwitch", detail: message };
      }
      case "prompt_result": {
        if (frame.agentInvoked !== true) return null;
        lastOutcome = str(frame.status) ?? null;
        if (lastOutcome !== "error") return null;
        const error = frame.error && typeof frame.error === "object" ? (frame.error as Record<string, unknown>) : {};
        return { ...base, type: "error", detail: str(error.message) };
      }
      case "session_settled": {
        const outcome = lastOutcome;
        lastOutcome = null;
        lastRetryError = undefined;
        if (outcome === "error" || outcome === "aborted") return null;
        return { ...base, type: "completed" };
      }
      case "extension_ui_request": {
        // Only reached for requests that wait on the user (omp-web answers
        // auto-approved ones before they are emitted).
        if (typeof frame.method !== "string" || INPUT_METHODS[frame.method] !== true) return null;
        const questions = Array.isArray(frame.questions) ? frame.questions : [];
        const firstQuestion = questions[0] && typeof questions[0] === "object" ? str((questions[0] as Record<string, unknown>).question) : undefined;
        return { ...base, type: "input", detail: str(frame.title) ?? firstQuestion ?? str(frame.message) ?? str(frame.instructions) };
      }
      default:
        return null;
    }
  };
}

"use client";

import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { CHAT_COLUMN_MAX_WIDTH } from "@/lib/chat-layout";

/**
 * The composer while an ask question's "Other" option is chosen: the typed
 * answer goes here instead of into a text field in the question panel, and
 * Send submits the panel's answers. Rendered in place of `ChatInput` (which
 * stays mounted, hidden, so the user's own draft is untouched).
 */
export function ComposerAskAnswer({
  question,
  value,
  canSend,
  onChange,
  onSend,
  onCancel,
}: {
  question: string;
  value: string;
  canSend: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    if (value) ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [value]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Enter" && !e.shiftKey && !isMobile) {
      // Same rule as the regular composer: soft keyboards rarely offer
      // Shift+Enter, so on phones Enter is a newline and Send submits.
      e.preventDefault();
      if (canSend) onSend();
    }
  };

  return (
    <div style={{ flexShrink: 0, padding: "0 16px calc(8px + env(safe-area-inset-bottom))" }}>
      <div style={{ maxWidth: CHAT_COLUMN_MAX_WIDTH, margin: "0 auto" }}>
        <div
          className="chat-input-shell"
          style={{
            display: "flex",
            flexDirection: "column",
            background: "var(--bg)",
            border: "1px solid var(--accent)",
            borderRadius: "var(--radius-card)",
            padding: "8px 12px 10px",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, color: "var(--text-muted)", fontSize: 12 }}>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {t("chatWindow.askAnswering", { question })}
            </span>
            <button
              type="button"
              onClick={onCancel}
              title={t("chatWindow.askCancelAnswer")}
              aria-label={t("chatWindow.askCancelAnswer")}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 24, height: 24, padding: 0, flexShrink: 0,
                background: "none", border: "none", borderRadius: 6,
                color: "var(--text-muted)", cursor: "pointer",
              }}
            >
              <X size={14} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
          <textarea
            ref={textareaRef}
            autoFocus
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("chatWindow.askAnswerPlaceholder")}
            aria-label={t("chatWindow.askAnswering", { question })}
            rows={1}
            style={{
              width: "100%",
              background: "none",
              border: "none",
              outline: "none",
              resize: "none",
              color: "var(--text)",
              fontSize: "var(--chat-user-font-size)",
              lineHeight: "var(--chat-line-height)",
              fontFamily: "inherit",
              minHeight: 24,
              maxHeight: 200,
              overflow: "auto",
            }}
          />
          <div className="composer-toolbar" style={{
            display: "flex",
            justifyContent: "flex-end",
            marginTop: 8,
            paddingTop: 8,
            borderTop: "1px solid color-mix(in srgb, var(--border) 62%, transparent)",
          }}>
            <button
              type="button"
              className="composer-primary-action"
              onClick={onSend}
              disabled={!canSend}
              title={t("chatInput.send")}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                background: canSend ? "var(--accent-strong)" : "var(--bg-panel)",
                border: "none",
                borderRadius: 8,
                color: canSend ? "var(--on-accent)" : "var(--text-dim)",
                cursor: canSend ? "pointer" : "not-allowed",
                fontSize: 12,
                fontWeight: 600,
                boxShadow: canSend ? "var(--shadow-card)" : "none",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="2" y1="7" x2="11" y2="7" />
                <polyline points="7.5 3 12 7 7.5 11" />
              </svg>
              {t("chatInput.send")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

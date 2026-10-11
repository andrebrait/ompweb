"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { ExtensionUiRequest } from "@/lib/types";
import type { RpcAskDialogAnswer } from "@/lib/pi-types";
import { useI18n } from "@/lib/i18n";
import { useModalDialog } from "@/hooks/useModalDialog";
import { useTouchTargets } from "@/hooks/useTouchTargets";
import { matchMobileViewport } from "@/hooks/useIsMobile";
import { ComposerAskAnswer } from "./ComposerAskAnswer";

export type ExtensionDialogRequest = Extract<
  ExtensionUiRequest,
  { method: "select" | "confirm" | "input" | "editor" | "ask" }
>;

export type ExtensionDialogResponse =
  | { value: string }
  | { confirmed: boolean }
  | { cancelled: true }
  | { answers: RpcAskDialogAnswer[] };

// `other` is null until the question's "Other" option is chosen.
type AskDraft = { selected: string[]; other: string | null };
const EMPTY_ASK_DRAFT: AskDraft = { selected: [], other: null };

// Keyboard-aware panel height. The on-screen keyboard shrinks the visible
// area, so a panel sized against the layout viewport alone keeps its footer
// (Cancel / Submit) below the keyboard. `dvh` follows the layout viewport —
// the placeholder cap — which older mobile browsers shrink for the keyboard
// too, so this is a backstop rather than a duplicate.
const DEFAULT_PANEL_MAX_HEIGHT = "min(420px, 60dvh)";
// Room the browser chrome and the keyboard accessory bar need above the panel.
const VIEWPORT_BLEED = 12;
// How much shorter the visual viewport must be before we call it a keyboard.
const KEYBOARD_INSET = 120;
// Some mobile browsers open the keyboard without resizing anything we can
// observe; a slow re-check costs nothing while a question is on screen.
const KEYBOARD_POLL_MS = 400;

function readPanelMaxHeight(): number | undefined {
  if (typeof window === "undefined") return undefined;
  const visual = window.visualViewport?.height;
  const height = typeof visual === "number" && visual > 0
    ? Math.min(visual, window.innerHeight)
    : window.innerHeight;
  return height > 0 ? Math.max(180, Math.round(height - VIEWPORT_BLEED)) : undefined;
}

function subscribeViewport(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const viewport = window.visualViewport;
  // Feature-detect the methods too: Safari 13 shipped a bare `visualViewport`.
  if (typeof viewport?.addEventListener !== "function") return () => {};
  viewport.addEventListener("resize", onChange);
  viewport.addEventListener("scroll", onChange);
  window.addEventListener("resize", onChange);
  return () => {
    viewport.removeEventListener("resize", onChange);
    viewport.removeEventListener("scroll", onChange);
    window.removeEventListener("resize", onChange);
  };
}

/**
 * CSS length px cap for a panel in the composer: the height of the visible
 * area, so the footer stays on screen while the soft keyboard is up. Reads
 * `undefined` when there is no window (SSR, tests) — the CSS default then
 * applies unchanged.
 */
function useViewportMaxHeight(): number | undefined {
  return useSyncExternalStore(subscribeViewport, readPanelMaxHeight, () => undefined);
}

/**
 * Whether the visible area is shorter than the layout viewport, which is how
 * an on-screen keyboard shows up: browsers cannot report the keyboard itself,
 * and an inline `<textarea>` does not necessarily resize the page.
 */
function isKeyboardOpen(): boolean {
  if (typeof window === "undefined") return false;
  const visual = window.visualViewport?.height;
  return typeof visual === "number" && visual > 0 && visual < window.innerHeight - KEYBOARD_INSET;
}

/**
 * Per-panel soft-keyboard tracking for a composer-attached request, active
 * only while focus is inside the panel. A panel in the composer is not a
 * modal, so the browser is free to scroll the page when the keyboard opens;
 * this is what keeps the footer (Cancel / Submit) inside the visible area
 * (#236).
 *
 * Two signals, because neither alone is enough: `visualViewport` shrinking is
 * the real keyboard (fingerprint-free), and a coarse pointer means the tap
 * that focused a field will raise one even before the browser has repainted.
 * A slow re-check covers mobile browsers that resize nothing on focus.
 */
function useMobileInputOpen(panelRef: RefObject<HTMLDivElement | null>, attached: boolean, composerHost?: HTMLElement | null) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!attached) {
      setOpen(false);
      return;
    }
    let focused = false;
    // The ask composer is portaled outside the panel but answers the same request.
    const inRequest = (node: EventTarget | null) =>
      node instanceof Node && Boolean(panelRef.current?.contains(node) || composerHost?.contains(node));
    const update = () => {
      const isOpen = focused && (isKeyboardOpen() || touchPointer());
      setOpen((current) => (current === isOpen ? current : isOpen));
    };
    const onFocusIn = (event: FocusEvent) => {
      focused = inRequest(event.target);
      update();
    };
    const onFocusOut = (event: FocusEvent) => {
      focused = inRequest(event.relatedTarget);
      update();
    };
    update();
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    const poll = setInterval(update, KEYBOARD_POLL_MS);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      clearInterval(poll);
    };
  }, [attached, panelRef, composerHost]);
  return open;
}

/**
 * Whether a composer-attached request should leave focus alone. Touch input
 * means the browser would raise the on-screen keyboard and yank the panel the
 * user has not read yet into view, so the request waits for a tap. The mobile
 * breakpoint covers where pointer media queries do not answer (older mobile
 * browsers, jsdom, a desktop browser's touch emulation); a narrow *desktop*
 * window is deferred too, which is the deliberate trade for never raising a
 * phone keyboard. Exported for the regression tests (#235).
 */
export function shouldDeferAttachedFocus(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return touchPointer() || matchMobileViewport();
}

/** The primary pointer is a finger: `(pointer: fine)` is the repo's test for a
 * mouse/trackpad, the same one `lib/composer-prefs.ts` uses for word
 * completion, so an unanswerable media query never counts as touch. */
function touchPointer(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return !window.matchMedia("(pointer: fine)").matches;
}

/** Single-select questions start on their recommended option. */
function initialAskDrafts(request: ExtensionDialogRequest): AskDraft[] {
  if (request.method !== "ask") return [];
  return request.questions.map((question) => {
    const recommended = question.multi || question.recommended === undefined ? undefined : question.options[question.recommended];
    return { selected: recommended ? [recommended.label] : [], other: null };
  });
}

/**
 * Overlay dialog for `select` / `confirm` / `input` / `editor` / `ask` extension UI
 * requests. Polished UX:
 *   - entrance animation (fade backdrop + scale-in panel)
 *   - focus trap: focus moves into the dialog on open and is returned to the
 *     opener on close; Tab/Shift-Tab wrap inside (via useModalDialog)
 *   - Escape closes as "cancelled" (document-level, top-of-stack only)
 *   - backdrop click closes as "cancelled"
 * Logic and i18n keys are unchanged from the in-ChatWindow original.
 */
export function ExtensionDialog({
  request,
  onRespond,
  attached = false,
  askComposerHost,
  onAskComposerChange,
}: {
  request: ExtensionDialogRequest;
  onRespond: (request: ExtensionDialogRequest, response: ExtensionDialogResponse) => void;
  /** Render as a composer panel instead of a full-chat overlay. */
  attached?: boolean;
  /** Where the composer sits. Choosing an ask question's "Other" option types
   * its answer there; without a host the option is not offered. */
  askComposerHost?: HTMLElement | null;
  /** Tells the host to hide its own composer while the answer is typed there. */
  onAskComposerChange?: (active: boolean) => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(request.method === "editor" ? request.prefill ?? "" : "");
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const requestIdRef = useRef(request.id);
  const [askDrafts, setAskDrafts] = useState(() => initialAskDrafts(request));
  // The question whose "Other" answer the composer is editing.
  const [typingIndex, setTypingIndex] = useState<number | null>(null);
  const viewportMaxHeight = useViewportMaxHeight();
  const { touchTargets } = useTouchTargets();

  useEffect(() => {
    // SSE reconnects replay the same request as a fresh object, not a new question.
    if (requestIdRef.current === request.id) return;
    requestIdRef.current = request.id;
    setValue(request.method === "editor" ? request.prefill ?? "" : "");
    setSelectedOption(null);
    setAskDrafts(initialAskDrafts(request));
    setTypingIndex(null);
  }, [request]);

  const askDraftAt = (index: number) => askDrafts[index] ?? EMPTY_ASK_DRAFT;
  const updateAskDraft = (index: number, update: (draft: AskDraft) => AskDraft) =>
    setAskDrafts((drafts) => drafts.map((draft, i) => i === index ? update(draft) : draft));
  // A chosen Other needs text; single-select needs a choice or that text;
  // multi-select may stay empty.
  const canSubmit = request.method === "ask"
    ? request.questions.every((question, index) => {
      const { selected, other } = askDraftAt(index);
      const typed = other !== null && other.trim() !== "";
      return (other === null || typed) && (question.multi || selected.length > 0 || typed);
    })
    : request.method !== "select" || selectedOption !== null;
  const askComposerActive = request.method === "ask" && typingIndex !== null && Boolean(askComposerHost);
  const title = request.method === "ask" ? t("chatWindow.askTitle") : request.title;

  const cancel = () => onRespond(request, { cancelled: true });

  useEffect(() => {
    if (!askComposerActive || !onAskComposerChange) return;
    onAskComposerChange(true);
    return () => onAskComposerChange(false);
  }, [askComposerActive, onAskComposerChange]);

  const chooseOption = (index: number, multi: boolean | undefined, label: string) => {
    if (!multi && typingIndex === index) setTypingIndex(null);
    updateAskDraft(index, (draft) => multi
      ? { ...draft, selected: draft.selected.includes(label) ? draft.selected.filter((current) => current !== label) : [...draft.selected, label] }
      : { selected: [label], other: null });
  };
  // Choosing Other hands typing to the composer. A checked Other whose answer
  // the composer is not editing (another question took it) is re-activated by
  // a click; a multi-select Other being edited is unchecked by one.
  const chooseOther = (index: number, multi: boolean | undefined) => {
    const chosen = askDraftAt(index).other !== null;
    if (chosen && multi && typingIndex === index) {
      cancelOther();
      return;
    }
    // A blank Other left behind would silently keep Submit disabled.
    if (typingIndex !== null && typingIndex !== index && !askDraftAt(typingIndex).other?.trim()) {
      updateAskDraft(typingIndex, (draft) => ({ ...draft, other: null }));
    }
    if (!chosen) updateAskDraft(index, (draft) => ({ selected: multi ? draft.selected : [], other: "" }));
    setTypingIndex(index);
  };
  function cancelOther() {
    if (typingIndex === null) return;
    updateAskDraft(typingIndex, (draft) => ({ ...draft, other: null }));
    setTypingIndex(null);
  }

  // useModalDialog gives us: focus-in on open, focus-restore on close,
  // document-level Escape (top-of-stack), and Tab wrapping inside the panel.
  const panelRef = useModalDialog<HTMLDivElement>({
    onClose: cancel,
    // A composer-attached request is a regular in-flow panel, not a modal.
    active: !attached,
  });
  const keyboardOpen = useMobileInputOpen(panelRef, attached, askComposerHost);
  // While the keyboard is up the panel fills the visible area instead of the
  // taller layout-viewport cap, so the footer with Cancel / Submit stays in
  // reach (#236).
  const attachedMaxHeight = keyboardOpen && viewportMaxHeight !== undefined
    ? `${viewportMaxHeight}px`
    : DEFAULT_PANEL_MAX_HEIGHT;

  useEffect(() => {
    if (!attached) return;
    const frame = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      // A tap on the composer, not a programmatic focus, opens the keyboard:
      // the request waits to be read on touch devices (#235).
      if (shouldDeferAttachedFocus()) return;
      // The frame runs after paint, by which time the user may already have
      // focused something inside the panel. Never yank focus back.
      if (panel.contains(document.activeElement)) return;
      // Never land on a radio or checkbox: a stray Space on a focused radio
      // selects that option, which silently overwrites what the user typed in
      // "Other". Prefer the first text entry, then any button.
      const target = panel.querySelector<HTMLElement>(
        "input:not([type=radio]):not([type=checkbox]), textarea, button:not([disabled])",
      );
      (target ?? panel).focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [attached, panelRef, request.id]);

  const submitValue = () => {
    if (request.method === "confirm") {
      onRespond(request, { confirmed: true });
    } else if (request.method === "select") {
      if (selectedOption) onRespond(request, { value: selectedOption });
    } else if (request.method === "ask") {
      if (!canSubmit) return;
      onRespond(request, {
        answers: request.questions.map((question, index) => {
          const draft = askDraftAt(index);
          const customInput = draft.other?.trim();
          return {
            id: question.id,
            selectedOptions: question.options.map((option) => option.label).filter((label) => draft.selected.includes(label)),
            ...(customInput ? { customInput } : {}),
          };
        }),
      });
    } else {
      onRespond(request, { value });
    }
  };

  return (
    <div
      className={attached ? undefined : "animate-fade-in"}
      onMouseDown={attached ? undefined : (event) => {
        // Close when the pointer goes down on the backdrop itself (not when
        // the press starts inside the panel and is dragged out).
        if (event.target === event.currentTarget) cancel();
      }}
      style={attached ? { width: "100%", flexShrink: 0 } : {
        position: "absolute",
        inset: 0,
        zIndex: 90,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "var(--overlay-backdrop)",
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal={attached ? undefined : "true"}
        aria-label={title}
        tabIndex={-1}
        className={attached ? undefined : "animate-scale-in"}
        style={{
          width: attached ? "100%" : "min(560px, 100%)",
          boxSizing: "border-box",
          // Grid/flex children below must be able to shrink: a min-content
          // question or option is wider than a phone, and without this the
          // panel grows past its composer column and gets clipped (#234).
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--border)",
          borderRadius: attached ? "var(--radius-card)" : "var(--radius-modal)",
          background: "var(--bg)",
          boxShadow: attached ? "var(--shadow-card)" : "var(--shadow-modal)",
          overflow: "hidden",
          outline: "none",
          maxHeight: attached ? attachedMaxHeight : "100%",
        }}
      >
        <div className="extension-dialog-content" style={{ minWidth: 0, minHeight: 0, overflowY: "auto", overflowX: "hidden", overflowWrap: "anywhere" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ color: "var(--text)", fontSize: 14, fontWeight: 650, whiteSpace: "pre-wrap" }}>{title}</div>
          <div style={{ marginTop: 3, color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)" }}>{t("chatWindow.extensionRequest")}</div>
        </div>

        <div style={{ padding: 14 }}>
          {request.method === "confirm" && (
            <div style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{request.message}</div>
          )}
          {request.method === "select" && (
            <div style={{ display: "grid", gap: 8 }}>
              {request.options.map((option) => {
                const selected = selectedOption === option;
                return (
                  <button
                    key={option}
                    onClick={() => attached ? setSelectedOption(option) : onRespond(request, { value: option })}
                    aria-pressed={attached ? selected : undefined}
                    style={{
                      width: "100%",
                      padding: "7px 10px",
                      borderRadius: 6,
                      border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                      background: selected ? "color-mix(in srgb, var(--accent) 10%, var(--bg-panel))" : "var(--bg-panel)",
                      color: "var(--text)",
                      cursor: "pointer",
                      textAlign: "left",
                      fontSize: 12.5,
                      fontFamily: "inherit",
                      transition: attached ? undefined : "background-color var(--dur-fast) var(--ease-out-warm), border-color var(--dur-fast) var(--ease-out-warm)",
                    }}
                    onMouseEnter={attached ? undefined : (e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                    onMouseLeave={attached ? undefined : (e) => { e.currentTarget.style.background = "var(--bg-panel)"; }}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          )}
          {request.method === "input" && (
            <input
              autoFocus
              aria-label={request.title || request.placeholder || "Input value"}
              value={value}
              placeholder={request.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitValue();
              }}
              style={{
                width: "100%",
                padding: "7px 10px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text)",
                outline: "none",
                fontSize: 12,
                fontFamily: "inherit",
              }}
            />
          )}
          {request.method === "editor" && (
            <textarea
              autoFocus
              aria-label={request.title || "Input value"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submitValue();
              }}
              style={{
                width: "100%",
                height: "min(220px, 30dvh)",
                minHeight: 80,
                padding: 10,
                borderRadius: 7,
                border: "1px solid var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text)",
                outline: "none",
                resize: "vertical",
                fontSize: request.promptStyle ? "var(--chat-font-size)" : 13,
                lineHeight: 1.55,
                fontFamily: request.promptStyle ? "inherit" : "var(--font-mono)",
              }}
            />
          )}
          {request.method === "ask" && (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 16 }}>
              {request.questions.map((question, index) => {
                const draft = askDraftAt(index);
                return (
                  <fieldset key={question.id} style={{ margin: 0, padding: 0, border: "none", minWidth: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8 }}>
                    <legend style={{ padding: 0, marginBottom: 8, color: "var(--text)", fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>
                      {question.header && (
                        <span style={{ display: "inline-block", marginRight: 6, padding: "0 7px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--text-muted)", fontSize: 11, fontWeight: 500 }}>
                          {question.header}
                        </span>
                      )}
                      <span style={{ whiteSpace: "pre-wrap" }}>{question.question}</span>
                    </legend>
                    {/* `null` is the "Other" row: its answer is typed in the composer. */}
                    {[...question.options, ...(askComposerHost ? [null] : [])].map((option, optionIndex) => {
                      const checked = option ? draft.selected.includes(option.label) : draft.other !== null;
                      return (
                        <label
                          key={option ? `option:${option.label}` : "other"}
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 8,
                            minWidth: 0,
                            padding: "8px 10px",
                            borderRadius: 7,
                            border: `1px solid ${checked ? "var(--accent)" : "var(--border)"}`,
                            background: checked ? "color-mix(in srgb, var(--accent) 10%, var(--bg-panel))" : "var(--bg-panel)",
                            color: "var(--text)",
                            cursor: "pointer",
                            fontSize: 13,
                          }}
                        >
                          <input
                            type={question.multi ? "checkbox" : "radio"}
                            name={`ask-${request.id}-${index}`}
                            checked={checked}
                            {...(option
                              ? { onChange: () => chooseOption(index, question.multi, option.label) }
                              // onClick, not onChange: re-clicking an already checked
                              // Other radio must hand the composer back to it.
                              : { readOnly: true, onClick: () => chooseOther(index, question.multi) })}
                            style={{ margin: "2px 0 0", accentColor: "var(--accent-strong)" }}
                          />
                          {option ? (
                            <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                              {option.label}
                              {optionIndex === question.recommended && (
                                <span style={{ marginLeft: 6, color: "var(--accent)", fontSize: 11, fontWeight: 600 }}>{t("chatWindow.askRecommended")}</span>
                              )}
                              {option.description && (
                                <span style={{ display: "block", marginTop: 2, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{option.description}</span>
                              )}
                              {option.preview && (
                                <span style={{ display: "block", marginTop: 6, padding: "6px 8px", borderRadius: 6, background: "var(--tool-bg)", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{option.preview}</span>
                              )}
                            </span>
                          ) : (
                            <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                              {t("chatWindow.askOther")}
                              {/* While the composer edits it the text is down there; otherwise show it. */}
                              {draft.other && typingIndex !== index && (
                                <span style={{ display: "block", marginTop: 2, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{draft.other}</span>
                              )}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </fieldset>
                );
              })}
            </div>
          )}
        </div>
        </div>

        <div className="extension-dialog-footer" style={{ display: "flex", flexShrink: 0, justifyContent: "flex-end", gap: 8, padding: "10px 14px", borderTop: "1px solid var(--border)", background: "var(--bg-panel)" }}>
          <button
            onClick={cancel}
            style={{
              padding: "6px 10px",
              minHeight: touchTargets === "accessible" ? 44 : undefined,
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text-muted)",
              cursor: "pointer",
              transition: "background-color var(--dur-fast) var(--ease-out-warm), color var(--dur-fast) var(--ease-out-warm)",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg)"; e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            {t("chatWindow.cancel")}
          </button>
          {request.method === "confirm" ? (
            <button
              onClick={submitValue}
              style={{
                padding: "6px 10px",
                minHeight: touchTargets === "accessible" ? 44 : undefined,
                borderRadius: 6,
                border: "1px solid var(--accent-strong)",
                background: "var(--accent-strong)",
                color: "var(--on-accent)",
                cursor: "pointer",
                transition: "background-color var(--dur-fast) var(--ease-out-warm)",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.filter = "brightness(1.12)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.filter = "none"; }}
            >
              {t("chatWindow.confirm")}
            </button>
          ) : (request.method === "select" && attached) || (request.method === "ask" && !askComposerActive) ? (
            <button
              onClick={submitValue}
              disabled={!canSubmit}
              style={{
                padding: "6px 10px",
                minHeight: touchTargets === "accessible" ? 44 : undefined,
                borderRadius: 6,
                border: "1px solid var(--accent-strong)",
                background: canSubmit ? "var(--accent-strong)" : "var(--bg-subtle)",
                color: canSubmit ? "var(--on-accent)" : "var(--text-dim)",
                cursor: canSubmit ? "pointer" : "not-allowed",
                opacity: canSubmit ? 1 : 0.65,
              }}
            >
              {request.method === "ask" ? t("chatWindow.submit") : t("chatWindow.next")}
            </button>
          ) : request.method !== "select" && request.method !== "ask" ? (
            <button
              onClick={submitValue}
              style={{
                padding: "6px 10px",
                minHeight: touchTargets === "accessible" ? 44 : undefined,
                borderRadius: 6,
                border: "1px solid var(--accent-strong)",
                background: "var(--accent-strong)",
                color: "var(--on-accent)",
                cursor: "pointer",
                transition: "background-color var(--dur-fast) var(--ease-out-warm)",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.filter = "brightness(1.12)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.filter = "none"; }}
            >
              {t("chatWindow.submit")}
            </button>
          ) : null}
        </div>
      </div>
      {askComposerActive && typingIndex !== null && askComposerHost && request.method === "ask" && createPortal(
        <ComposerAskAnswer
          key={typingIndex}
          question={request.questions[typingIndex]?.question ?? ""}
          value={askDraftAt(typingIndex).other ?? ""}
          canSend={canSubmit}
          onChange={(other) => updateAskDraft(typingIndex, (draft) => ({ ...draft, other }))}
          onSend={submitValue}
          onCancel={cancelOther}
        />,
        askComposerHost,
      )}
    </div>
  );
}

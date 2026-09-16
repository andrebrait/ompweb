"use client";

import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, Pause, Play, RotateCw, Square, X } from "lucide-react";
import { MAX_RECORDING_MS, type DictationCapture } from "@/hooks/useDictation";
import { useI18n } from "@/lib/i18n";

const WAVE_WIDTH = 160;
const WAVE_HEIGHT = 28;
const BAR_COUNT = 40;
const SAMPLE_INTERVAL_MS = 50;
const BAR_SCALE = 3;

interface RecordingDeckProps {
  captureRef: React.RefObject<DictationCapture>;
  isPaused: boolean;
  isTranscribing: boolean;
  transcribeError: string | null;
  onPauseResume: () => void;
  onConvert: () => void;
  onSend: () => void;
  onCancel: () => void;
  onRetry: () => void;
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function DeckIconButton({
  children,
  onClick,
  title,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  tone?: "danger" | "accent";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 28, height: 28, padding: 0, flexShrink: 0,
        background:
          tone === "danger" ? "var(--danger-subtle, rgba(239, 68, 68, 0.15))"
          : tone === "accent" ? "var(--bg-subtle)"
          : "var(--bg-subtle)",
        border: `1px solid ${tone === "danger" ? "var(--danger, #ef4444)" : tone === "accent" ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 7,
        color:
          tone === "danger" ? "var(--danger, #ef4444)"
          : tone === "accent" ? "var(--accent)"
          : "var(--text-muted)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

export function RecordingDeck({
  captureRef,
  isPaused,
  isTranscribing,
  transcribeError,
  onPauseResume,
  onConvert,
  onSend,
  onCancel,
  onRetry,
}: RecordingDeckProps) {
  useEffect(() => {
    const compute = () => {
      const capture = captureRef.current;
      setElapsed(
        capture
          ? Math.min(
              MAX_RECORDING_MS,
              Math.max(
                0,
                performance.now() -
                  capture.startedAt -
                  capture.pausedAccum -
                  (capture.pausedAt !== null ? performance.now() - capture.pausedAt : 0),
              ),
            )
          : 0,
      );
    };
    compute();
    const id = window.setInterval(compute, 100);
    return () => window.clearInterval(id);
  }, [captureRef]);
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const captureActive = !isTranscribing && !transcribeError;


  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !captureActive) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = WAVE_WIDTH * dpr;
    canvas.height = WAVE_HEIGHT * dpr;
    ctx.scale(dpr, dpr);

    const style = getComputedStyle(canvas);
    const barColor = (isPaused ? style.getPropertyValue("--text-muted") : style.getPropertyValue("--danger")).trim() || (isPaused ? "#888" : "#ef4444");

    const bars: number[] = [];
    const data = new Uint8Array(256);
    let raf = 0;
    let lastPush = 0;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const analyser = (isPaused ? null : captureRef.current?.analyser) ?? null;
      if (analyser && now - lastPush >= SAMPLE_INTERVAL_MS) {
        lastPush = now;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        bars.push(Math.min(1, rms * BAR_SCALE));
        if (bars.length > BAR_COUNT) bars.shift();
      }
      ctx.clearRect(0, 0, WAVE_WIDTH, WAVE_HEIGHT);
      ctx.fillStyle = barColor;
      ctx.globalAlpha = isPaused ? 0.45 : 1;
      const gap = 2;
      const barW = (WAVE_WIDTH - gap * (BAR_COUNT - 1)) / BAR_COUNT;
      for (let i = 0; i < bars.length; i++) {
        const h = Math.max(2, bars[i] * (WAVE_HEIGHT - 2));
        ctx.fillRect(i * (barW + gap), (WAVE_HEIGHT - h) / 2, barW, h);
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [captureRef, captureActive, isPaused]);

  return (
    <div
      role="status"
      aria-label={isTranscribing ? t("chatInput.transcribing") : transcribeError ? transcribeError : t("chatInput.dictationRecording")}
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 6,
        minHeight: 24,
        padding: "2px 0",
      }}
    >
      {isTranscribing ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 12 }}>
          <Loader2 size={14} strokeWidth={1.8} className="animate-spin" aria-hidden="true" />
          <span style={{ flexShrink: 0 }}>{t("chatInput.transcribing")}</span>
          <div style={{ flex: 1, maxWidth: 220, height: 3, borderRadius: 2, background: "var(--border)", overflow: "hidden", position: "relative" }}>
            <div className="dictation-indeterminate" style={{ position: "absolute", top: 0, bottom: 0, width: "40%", background: "var(--accent)", borderRadius: 2 }} />
          </div>
          <DeckIconButton onClick={onCancel} title={t("chatInput.cancelDictation")} tone="danger">
            <X size={14} strokeWidth={1.8} aria-hidden="true" />
          </DeckIconButton>
        </div>
      ) : transcribeError ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text)", minWidth: 0 }}>
          <AlertCircle size={14} strokeWidth={1.8} aria-hidden="true" style={{ color: "var(--danger, #ef4444)", flexShrink: 0 }} />
          <span title={transcribeError} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            {transcribeError}
          </span>
          <DeckIconButton onClick={onRetry} title={t("chatInput.retryDictation")} tone="accent">
            <RotateCw size={14} strokeWidth={1.8} aria-hidden="true" />
          </DeckIconButton>
          <DeckIconButton onClick={onCancel} title={t("chatInput.discardDictation")} tone="danger">
            <X size={14} strokeWidth={1.8} aria-hidden="true" />
          </DeckIconButton>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span
              aria-hidden="true"
              style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--danger, #ef4444)", flexShrink: 0 }}
            />
            <span
              style={{
                fontSize: 12,
                fontVariantNumeric: "tabular-nums",
                color: "var(--text)",
                flexShrink: 0,
                minWidth: 34,
              }}
            >
              {formatElapsed(elapsed)}
            </span>
            <canvas ref={canvasRef} style={{ width: WAVE_WIDTH, height: WAVE_HEIGHT, flexShrink: 1, minWidth: 0, alignSelf: "center" }} aria-hidden="true" />
            <div style={{ display: "flex", alignItems: "center", gap: 2, marginLeft: "auto", flexShrink: 0 }}>
              <DeckIconButton onClick={onPauseResume} title={isPaused ? t("chatInput.resumeDictation") : t("chatInput.pauseDictation")}>
                {isPaused ? <Play size={14} strokeWidth={1.8} aria-hidden="true" /> : <Pause size={14} strokeWidth={1.8} aria-hidden="true" />}
              </DeckIconButton>
              <DeckIconButton onClick={onConvert} title={t("chatInput.convertDictation")}>
                <Square size={11} strokeWidth={2} aria-hidden="true" />
              </DeckIconButton>
              <DeckIconButton onClick={onSend} title={t("chatInput.sendDictation")} tone="accent">
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="2" y1="7" x2="11" y2="7" />
                  <polyline points="7.5 3 12 7 7.5 11" />
                </svg>
              </DeckIconButton>
              <DeckIconButton onClick={onCancel} title={t("chatInput.cancelDictation")} tone="danger">
                <X size={14} strokeWidth={1.8} aria-hidden="true" />
              </DeckIconButton>
            </div>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={MAX_RECORDING_MS}
            aria-valuenow={Math.round(elapsed)}
            style={{ height: 2, borderRadius: 1, background: "var(--border)", overflow: "hidden" }}
          >
            <div
              style={{
                height: "100%",
                width: `${Math.min(100, (elapsed / MAX_RECORDING_MS) * 100)}%`,
                background: "var(--danger, #ef4444)",
                transition: "width 0.1s linear",
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

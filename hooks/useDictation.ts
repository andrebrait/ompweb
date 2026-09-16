"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export interface UseDictationOptions {
  onTranscript: (text: string) => void;
  onError?: (error: string) => void;
}

export const MAX_RECORDING_MS = 300_000;
const STT_TIMEOUT_MS = 60_000;

/**
 * Live capture state polled by RecordingDeck (timer + waveform) without
 * re-rendering the hook's consumer. Mutated in place; identity is stable.
 */
export interface DictationCapture {
  analyser: AnalyserNode | null;
  startedAt: number;
  pausedAccum: number;
  pausedAt: number | null;
}

function normalizeErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object" && "message" in error) {
    const message: unknown = error.message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

export function useDictation({ onTranscript, onError }: UseDictationOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  const isStartingRef = useRef(false);
  const maxTimeoutRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const captureRef = useRef<DictationCapture>({ analyser: null, startedAt: 0, pausedAccum: 0, pausedAt: null });
  // Audio kept after a failed/timed-out transcription so the user can retry
  // instead of losing the recording.
  const pendingAudioRef = useRef<{ blob: Blob; ext: string } | null>(null);

  const clearMaxTimeout = useCallback(() => {
    if (maxTimeoutRef.current !== null) {
      window.clearTimeout(maxTimeoutRef.current);
      maxTimeoutRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    clearMaxTimeout();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    }
    mediaRecorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    captureRef.current = { analyser: null, startedAt: 0, pausedAccum: 0, pausedAt: null };
    setIsRecording(false);
    setIsPaused(false);
  }, [clearMaxTimeout]);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      pendingAudioRef.current = null;
      cleanup();
    };
  }, [cleanup]);

  const runTranscription = useCallback(async (blob: Blob, ext: string) => {
    setIsTranscribing(true);
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const timeoutId = window.setTimeout(() => {
      abortController.abort(new DOMException("Transcription timed out", "TimeoutError"));
    }, STT_TIMEOUT_MS);

    try {
      const body = new FormData();
      body.append("file", blob, ext);

      const res = await fetch("/api/stt", {
        method: "POST",
        body,
        signal: abortController.signal,
      });
      if (cancelledRef.current) return;
      const data = await res.json();
      if (cancelledRef.current) return;
      if (!res.ok) {
        const message = normalizeErrorMessage(data?.error, "Transcription failed");
        setTranscribeError(message);
        onError?.(message);
        return;
      }
      if (typeof data.text === "string" && data.text.trim()) {
        if (!cancelledRef.current) {
          pendingAudioRef.current = null;
          onTranscript(data.text.trim());
        }
      } else if (!cancelledRef.current) {
        const message = "No speech detected";
        setTranscribeError(message);
        onError?.(message);
      }
    } catch (err) {
      if (cancelledRef.current) return;
      if (err instanceof DOMException && err.name === "TimeoutError") {
        const message = "Transcription timed out";
        setTranscribeError(message);
        onError?.(message);
        return;
      }
      if (err instanceof DOMException && err.name === "AbortError") return;
      const message = err instanceof Error ? err.message : normalizeErrorMessage(err, "Transcription failed");
      setTranscribeError(message);
      onError?.(message);
    } finally {
      window.clearTimeout(timeoutId);
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      setIsTranscribing(false);
    }
  }, [onTranscript, onError]);

  // Ends capture and moves the session into transcription. Gates on the live
  // MediaRecorder state (not the isRecording closure) because the 5-minute
  // cap timeout captures this callback from the render that started the
  // recording. Sets isTranscribing eagerly so the deck never flashes back to
  // the text composer between recorder.stop() and the async onstop event.
  const finishCapture = useCallback(() => {
    clearMaxTimeout();
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    try {
      recorder.stop();
    } catch {}
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    captureRef.current.analyser = null;
    setIsRecording(false);
    setIsPaused(false);
    setIsTranscribing(true);
  }, [clearMaxTimeout]);

  const start = useCallback(async () => {
    if (isStartingRef.current || isRecording || isTranscribing) return;
    isStartingRef.current = true;
    cleanup();
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    cancelledRef.current = false;
    pendingAudioRef.current = null;
    setTranscribeError(null);
    setIsTranscribing(false);
    if (
      typeof navigator?.mediaDevices?.getUserMedia !== "function" ||
      typeof window === "undefined" ||
      typeof window.MediaRecorder === "undefined"
    ) {
      isStartingRef.current = false;
      onError?.("Microphone not supported in this browser or context");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      captureRef.current = { analyser: null, startedAt: performance.now(), pausedAccum: 0, pausedAt: null };
      if (typeof window.AudioContext === "function") {
        let ctx: AudioContext | null = null;
        try {
          ctx = new AudioContext();
          audioContextRef.current = ctx;
          if (ctx.state === "suspended") void ctx.resume();
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          captureRef.current.analyser = analyser;
        } catch {
          // Own the failure: never leave a live context behind untracked.
          void ctx?.close().catch(() => {});
          audioContextRef.current = null;
        }
      }

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      const chunks: Blob[] = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      recorder.onstop = () => {
        if (cancelledRef.current) return;
        clearMaxTimeout();
        if (chunks.length === 0) {
          const message = "No speech detected";
          setTranscribeError(message);
          setIsTranscribing(false);
          onError?.(message);
          return;
        }
        const mimeType = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunks, { type: mimeType });
        const ext = mimeType.includes("mp4") ? "audio.mp4" : mimeType.includes("ogg") ? "audio.ogg" : "audio.webm";
        pendingAudioRef.current = { blob, ext };
        void runTranscription(blob, ext);
      };

      recorder.start();
      setIsRecording(true);
      maxTimeoutRef.current = window.setTimeout(() => {
        finishCapture();
      }, MAX_RECORDING_MS);
    } catch (err) {
      cleanup();
      onError?.(err instanceof Error ? err.message : "Microphone access denied");
    } finally {
      isStartingRef.current = false;
    }
  }, [isRecording, isTranscribing, cleanup, clearMaxTimeout, runTranscription, onError, finishCapture]);

  const togglePause = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || isTranscribing || transcribeError) return;
    if (recorder.state === "recording") {
      recorder.pause();
      captureRef.current.pausedAt = performance.now();
      setIsPaused(true);
    } else if (recorder.state === "paused") {
      recorder.resume();
      const { pausedAt, pausedAccum } = captureRef.current;
      if (pausedAt !== null) {
        captureRef.current.pausedAccum = pausedAccum + (performance.now() - pausedAt);
      }
      captureRef.current.pausedAt = null;
      setIsPaused(false);
    }
  }, [isTranscribing, transcribeError]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    pendingAudioRef.current = null;
    setTranscribeError(null);
    setIsTranscribing(false);
    cleanup();
  }, [cleanup]);

  const retry = useCallback(() => {
    const pending = pendingAudioRef.current;
    if (!pending || isTranscribing) return;
    setTranscribeError(null);
    void runTranscription(pending.blob, pending.ext);
  }, [isTranscribing, runTranscription]);

  const toggle = useCallback(() => {
    if (isRecording) finishCapture();
    else void start();
  }, [isRecording, start, finishCapture]);

  return {
    isRecording,
    isPaused,
    isTranscribing,
    transcribeError,
    captureRef,
    start,
    stop: finishCapture,
    cancel,
    toggle,
    togglePause,
    retry,
  };
}

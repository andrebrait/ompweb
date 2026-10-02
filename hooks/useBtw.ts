import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { toast } from "@/components/ui/toast";
import { sendAgentCommand } from "@/lib/agent-client";
import { translate } from "@/lib/i18n";
import { applyBtwEvent, isBtwRecord, latestBtwTurn, mergeBtwHistory, upsertBtwRecord, type BtwRecord } from "@/lib/btw";

/** An omp without the btw RPC commands gets an upgrade hint, not its raw error. */
export function toastBtwError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Unknown command")) toast.error(translate("btw.unsupported"));
  else toast.error(translate("btw.failed"), message);
}

type BtwFrame = { type: string; [key: string]: unknown };

/** Side questions (omp `/btw`) for one chat: the session's BTW history fed by
 * `btw_record`/`btw_delta` frames, the record shown in the composer panel, and
 * the history dialog. Never touches the main transcript. */
export function useBtw(sessionIdRef: RefObject<string | null>) {
  const [records, setRecords] = useState<BtwRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Deltas arrive at token rate; applying them once per frame keeps the chat
  // from re-rendering per token (same reason message_update is coalesced).
  const pendingFramesRef = useRef<BtwFrame[]>([]);
  const flushFrameRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (flushFrameRef.current !== null) cancelAnimationFrame(flushFrameRef.current);
  }, []);

  const applyEvent = useCallback((event: BtwFrame) => {
    pendingFramesRef.current.push(event);
    if (flushFrameRef.current !== null) return;
    flushFrameRef.current = requestAnimationFrame(() => {
      flushFrameRef.current = null;
      const frames = pendingFramesRef.current;
      pendingFramesRef.current = [];
      setRecords((prev) => frames.reduce(applyBtwEvent, prev));
      // A side question started elsewhere (another tab) surfaces in the panel too.
      const started = frames.map((frame) => frame.record)
        .findLast((record): record is BtwRecord => isBtwRecord(record) && latestBtwTurn(record).status === "running");
      if (started) setActiveId(started.id);
    });
  }, []);

  /** Background refreshes (SSE (re)connect) stay silent: an older omp simply has no history. */
  const refreshHistory = useCallback(async (sid: string, explicit = false) => {
    try {
      const data = await sendAgentCommand<{ records?: unknown[] } | null>(sid, { type: "get_btw_history" });
      if (sessionIdRef.current !== sid) return;
      const snapshot = (data?.records ?? []).filter(isBtwRecord);
      setRecords((prev) => mergeBtwHistory(prev, snapshot));
      const running = snapshot.find((record) => latestBtwTurn(record).status === "running");
      if (running) setActiveId((id) => id ?? running.id);
    } catch (error) {
      if (explicit) toastBtwError(error);
    }
  }, [sessionIdRef]);

  /** Resolves once omp accepted the question; the answer streams via frames. Throws on refusal. */
  const ask = useCallback(async (sid: string, question: string, recordId?: string) => {
    const data = await sendAgentCommand<{ record?: unknown } | null>(sid, { type: "btw", question, ...(recordId ? { recordId } : {}) });
    const record = data?.record;
    if (sessionIdRef.current !== sid || !isBtwRecord(record)) return;
    setRecords((prev) => upsertBtwRecord(prev, record));
    setActiveId(record.id);
  }, [sessionIdRef]);

  const cancel = useCallback(async (recordId: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "btw_cancel", recordId });
    } catch (error) {
      toastBtwError(error);
    }
  }, [sessionIdRef]);

  return { records, activeId, setActiveId, historyOpen, setHistoryOpen, applyEvent, refreshHistory, ask, cancel };
}

import { randomUUID } from "node:crypto";
import type { SttConfig } from "@/lib/stt";

/**
 * Server-owned transcription jobs. POST /api/stt starts one and returns its id
 * at once; browsers poll GET /api/stt/[jobId]. The server holds the slow
 * upstream request and keeps the recording in memory, so a job survives the
 * recording browser disconnecting: any browser showing the same composer
 * scope (session id or `new:<cwd>` draft key) can find it, play the audio,
 * retry a failure, and claim the transcript exactly once.
 */
export type SttJobStatus = "pending" | "done" | "error" | "gone";

interface SttJob {
  id: string;
  scope: string | null;
  audio: File;
  status: SttJobStatus;
  text?: string;
  error?: string;
  /** Bumped per attempt so a superseded upstream answer cannot land. */
  run: number;
  /** Claim token of the browser that took the transcript; lets it repeat a lost claim. */
  claimedBy?: string;
  expiry?: NodeJS.Timeout;
}

export interface SttJobView {
  id: string;
  status: SttJobStatus;
  text?: string;
  error?: string;
}

/**
 * Cap on how long the server waits on the STT endpoint. Kept under undici's
 * default 300s headersTimeout so a slow upstream ends as "timed out", not
 * an opaque "fetch failed".
 */
const STT_UPSTREAM_TIMEOUT_MS = 290_000;
/** Unclaimed results and failures (with their audio) stay retrievable this long. */
const SETTLED_JOB_TTL_MS = 60 * 60_000;
/** Claimed/discarded jobs answer "gone" this long so other browsers stand down. */
const GONE_JOB_TTL_MS = 10 * 60_000;
/** Each pending job runs an upstream request; refuse new ones past this. */
const MAX_PENDING_JOBS = 4;
/** Each live job holds up to 25MB of audio; refuse new ones past this. */
const MAX_LIVE_JOBS = 20;

declare global {
  // globalThis survives Next.js hot reload and is shared by the separately
  // bundled /api/stt route handlers; a module-level Map is neither.
  var __ompSttJobs: Map<string, SttJob> | undefined;
}

const store = (globalThis.__ompSttJobs ??= new Map<string, SttJob>());

function view(job: SttJob): SttJobView {
  // A claimed tombstone keeps its text only for repeat claims, never for pollers.
  return { id: job.id, status: job.status, text: job.status === "done" ? job.text : undefined, error: job.error };
}

function expireIn(job: SttJob, ms: number): void {
  clearTimeout(job.expiry);
  job.expiry = setTimeout(() => store.delete(job.id), ms);
  job.expiry.unref?.();
}

function extractUpstreamErrorMessage(data: unknown, rawText: string, status: number): string {
  if (data && typeof data === "object" && "error" in data) {
    const error: unknown = data.error;
    if (typeof error === "string" && error.trim()) return error;
    if (error && typeof error === "object" && "message" in error) {
      const message: unknown = error.message;
      if (typeof message === "string" && message.trim()) return message;
    }
  }
  if (rawText.trim()) return rawText.trim().slice(0, 500);
  return `Transcription failed (upstream ${status})`;
}

async function transcribe({ endpoint, apiKey, model }: SttConfig, audio: File): Promise<Pick<SttJob, "status" | "text" | "error">> {
  const formData = new FormData();
  formData.append("file", audio, audio.name);
  if (model) formData.append("model", model);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      body: formData,
      signal: AbortSignal.timeout(STT_UPSTREAM_TIMEOUT_MS),
    });
    const rawText = await res.text();
    let data: unknown = null;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      data = null;
    }
    if (!res.ok) {
      return { status: "error", error: extractUpstreamErrorMessage(data, rawText, res.status) };
    }
    // Plain-text upstreams (response_format=text) return the transcript as the body.
    if (data === null) return { status: "done", text: rawText };
    const text = typeof data === "object" && "text" in data && typeof data.text === "string" ? data.text : "";
    return { status: "done", text };
  } catch (error) {
    const message = error instanceof DOMException && error.name === "TimeoutError"
      ? "Transcription timed out"
      : error instanceof Error ? error.message : String(error);
    return { status: "error", error: apiKey ? message.replaceAll(apiKey, "[REDACTED]") : message };
  }
}

function launch(config: SttConfig, job: SttJob): void {
  const run = ++job.run;
  job.status = "pending";
  job.error = undefined;
  clearTimeout(job.expiry);
  void transcribe(config, job.audio).then((result) => {
    // Discarded or retried meanwhile: this answer is stale.
    if (job.run !== run || job.status !== "pending" || store.get(job.id) !== job) return;
    Object.assign(job, result);
    expireIn(job, SETTLED_JOB_TTL_MS);
  });
}

function countLive(): { pending: number; live: number } {
  let pending = 0;
  let live = 0;
  for (const job of store.values()) {
    if (job.status === "pending") pending++;
    if (job.status !== "gone") live++;
  }
  return { pending, live };
}

/** Starts a job; null when the pending or live job caps are reached. */
export function startSttJob(config: SttConfig, input: { audio: File; scope: string | null }): string | null {
  const { pending, live } = countLive();
  if (pending >= MAX_PENDING_JOBS || live >= MAX_LIVE_JOBS) return null;
  const job: SttJob = { id: randomUUID(), ...input, status: "pending", run: 0 };
  store.set(job.id, job);
  launch(config, job);
  return job.id;
}

/** Re-runs a failed job with its stored audio. */
export function retrySttJob(config: SttConfig, id: string): SttJobView | "busy" | null {
  const job = store.get(id);
  if (!job) return null;
  if (job.status !== "error") return view(job);
  if (countLive().pending >= MAX_PENDING_JOBS) return "busy";
  launch(config, job);
  return view(job);
}

export function getSttJob(id: string): SttJobView | null {
  const job = store.get(id);
  return job ? view(job) : null;
}

export function getSttJobAudio(id: string): File | null {
  const job = store.get(id);
  return job && job.status !== "gone" ? job.audio : null;
}

/** Jobs a browser showing this scope should pick up, newest first. */
export function listSttJobs(scope: string): SttJobView[] {
  return [...store.values()].filter((job) => job.scope === scope && job.status !== "gone").reverse().map(view);
}

/**
 * Ends a job and frees its audio. On a finished job with a claim token this is
 * the claim: only the first claimer gets the text back, so exactly one
 * browser inserts it; the same token may repeat the claim if its response
 * was lost. Without a token (discard) or on an unfinished job, later callers
 * see "gone".
 */
export function closeSttJob(id: string, claimToken?: string): SttJobView | null {
  const job = store.get(id);
  if (!job) return null;
  if (job.status === "gone") {
    return claimToken && job.claimedBy === claimToken
      ? { id, status: "done", text: job.text }
      : { id, status: "gone" };
  }
  const before = view(job);
  if (job.status === "done" && claimToken) job.claimedBy = claimToken;
  else job.text = undefined;
  job.status = "gone";
  job.error = undefined;
  // Drop the audio; the tombstone only answers "gone" (or repeats a claim).
  job.audio = new File([], job.audio.name);
  expireIn(job, GONE_JOB_TTL_MS);
  return before;
}

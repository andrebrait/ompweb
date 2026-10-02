import { randomUUID } from "node:crypto";

/**
 * Server-owned transcription jobs. POST /api/stt starts one and returns its id
 * at once; the browser polls GET /api/stt/[jobId]. The upstream STT request is
 * held by this process, so no proxy idle timeout between the browser and
 * omp-web can cut a slow transcription short.
 */
export type SttJob =
  | { status: "pending" }
  | { status: "done"; text: string }
  | { status: "error"; error: string };

/** Cap on how long the server waits on the STT endpoint. */
export const STT_UPSTREAM_TIMEOUT_MS = 10 * 60_000;
/** Finished jobs stay readable this long so a poll lost in transit can be repeated. */
const FINISHED_JOB_TTL_MS = 10 * 60_000;

declare global {
  // globalThis survives Next.js hot reload; a module-level Map does not.
  var __ompSttJobs: Map<string, SttJob> | undefined;
}

const store = (globalThis.__ompSttJobs ??= new Map<string, SttJob>());

export function getSttJob(id: string): SttJob | undefined {
  return store.get(id);
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

async function transcribe(endpoint: string, apiKey: string | undefined, formData: FormData): Promise<SttJob> {
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

/** Starts the upstream request in the background and returns the job id. */
export function startSttJob(endpoint: string, apiKey: string | undefined, formData: FormData): string {
  const id = randomUUID();
  store.set(id, { status: "pending" });
  void transcribe(endpoint, apiKey, formData).then((job) => {
    store.set(id, job);
    setTimeout(() => store.delete(id), FINISHED_JOB_TTL_MS).unref?.();
  });
  return id;
}

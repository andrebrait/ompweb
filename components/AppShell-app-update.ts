import { withStorageNamespace } from "@/lib/browser-storage.js";
import type { AppUpdateInfo } from "./AppUpdateDialog";

export const DISMISSED_APP_UPDATE_KEY = withStorageNamespace("omp-web:dismissed-app-update");
export const COMPLETED_APP_UPDATE_KEY = withStorageNamespace("omp-web:completed-app-update");
export const APP_UPDATE_POLL_MS = 500;
export const APP_UPDATE_STOPPING_POLL_MS = 200;
export const APP_UPDATE_TIMEOUT_MS = 15 * 60 * 1_000;
export const APP_UPDATE_PREPARING_MIN_MS = 1_000;
export const APP_UPDATE_VISIBLE_STAGE_MIN_MS = 1_000;
export const APP_UPDATE_COMPLETED_RELOAD_MS = 3_000;
export const APP_UPDATE_ERROR_MAX_LENGTH = 240;

export async function waitForAppUpdateDwell(startedAt: number | null, minimumMs: number): Promise<void> {
  if (startedAt == null) return;
  const remainingMs = minimumMs - (Date.now() - startedAt);
  if (remainingMs <= 0) return;
  await new Promise<void>((resolve) => window.setTimeout(resolve, remainingMs));
}

const CONTROL_CHARS_PATTERN = "[\\u0000-\\u001F\\u007F]+";

export function sanitizeAppUpdateError(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return raw
    .replace(new RegExp(CONTROL_CHARS_PATTERN, "g"), " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, APP_UPDATE_ERROR_MAX_LENGTH);
}

export function isExactLegacyTargetCompletion(update: AppUpdateInfo | null, targetVersion: string): boolean {
  return update?.selfUpdateStatus == null && update?.currentVersion === targetVersion;
}

export class AppUpdateTransportError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : "Update service connection failed");
    this.name = "AppUpdateTransportError";
  }
}

export async function fetchAppUpdateJson<T>(input: string, init?: RequestInit, expectedStatus?: number): Promise<T> {
  let response: Response;
  let responseBody: string;
  try {
    response = await fetch(input, init);
    responseBody = await response.text();
  } catch (error) {
    throw new AppUpdateTransportError(error);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(responseBody);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Malformed JSON";
    const prefix = response.ok ? "Invalid update response" : `HTTP ${response.status}: invalid update response`;
    throw new Error(`${prefix}: ${detail}`);
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(response.ok ? "Invalid update response" : `HTTP ${response.status}: invalid update response`);
  }

  const data = payload as T & { error?: unknown };
  if (typeof data.error === "string" && data.error.trim()) throw new Error(data.error);
  if (data.error != null) throw new Error("Invalid update error response");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (expectedStatus !== undefined && response.status !== expectedStatus) {
    throw new Error(`Expected HTTP ${expectedStatus}, received HTTP ${response.status}`);
  }
  return data;
}

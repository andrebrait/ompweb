import { NextResponse } from "next/server";
import type { Host } from "./hosts/host";
import { localHost } from "./hosts/local-host";
import type { OpResult } from "./hosts/session-ops";
import { resolveSessionPath } from "./session-reader";

const SESSION_NOT_FOUND = { error: "Session not found", code: "session_not_found" } as const;

/** Resolve a session id to its file path, or a 404 JSON response. Only the
 * routes that spawn omp for the session still need the local path. */
export async function resolveSessionPathOr404(
  id: string,
): Promise<{ filePath: string } | { response: NextResponse }> {
  const filePath = await resolveSessionPath(id);
  if (!filePath) return { response: NextResponse.json(SESSION_NOT_FOUND, { status: 404 }) };
  return { filePath };
}

/** Resolve a session id to the host holding its file, or a 404 JSON response. */
export async function resolveSessionHostOr404(
  id: string,
): Promise<{ host: Host } | { response: NextResponse }> {
  if (!(await resolveSessionPath(id))) return { response: NextResponse.json(SESSION_NOT_FOUND, { status: 404 }) };
  return { host: localHost };
}

/** The JSON error response for a failed host op. */
export function opErrorResponse(result: Extract<OpResult<unknown>, { ok: false }>): NextResponse {
  return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
}

/** Uniform JSON error body used by most API routes. */
export function apiErrorResponse(error: unknown, status = 500): NextResponse {
  return NextResponse.json({ error: String(error) }, { status });
}

import { NextResponse } from "next/server";
import { clearHistory, listHistory, markHistoryRead, removeHistory } from "@/lib/notification-store";
import { isRecord } from "@/lib/type-guards";

export const dynamic = "force-dynamic";

const MAX_BODY_CHARS = 32 * 1024;
const MAX_IDS = 100;
const MAX_ID_LENGTH = 256;

const invalid = () => NextResponse.json({ error: "Invalid history request", code: "invalid_history_request" }, { status: 400 });
const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH;

/** Parsed JSON body, `undefined` for an empty body, or `null` when it is too large or not JSON. */
async function readBody(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > MAX_BODY_CHARS) return null;
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** GET /api/notifications/history — every entry, newest first. */
export async function GET() {
  return NextResponse.json({ entries: listHistory() });
}

/** PATCH /api/notifications/history { ids } — mark entries read. A client marks what it shows, never entries it has not seen. */
export async function PATCH(req: Request) {
  const body = await readBody(req);
  if (!isRecord(body) || !Array.isArray(body.ids) || body.ids.length > MAX_IDS || !body.ids.every(isId)) return invalid();
  markHistoryRead(body.ids);
  return NextResponse.json({ ok: true });
}

/** DELETE /api/notifications/history { id } — remove one entry; no body clears the history. */
export async function DELETE(req: Request) {
  const body = await readBody(req);
  if (body === undefined) clearHistory();
  else if (isRecord(body) && isId(body.id)) removeHistory(body.id);
  else return invalid();
  return NextResponse.json({ ok: true });
}

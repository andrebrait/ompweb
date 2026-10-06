import { NextResponse } from "next/server";
import { isValidNotificationId, sendTestNotification } from "@/lib/notification-hub";
import { isRecord } from "@/lib/type-guards";

export const dynamic = "force-dynamic";

/** POST /api/notifications/test { deviceId, clientId } — one system notification to this device. */
export async function POST(req: Request) {
  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body) || !isValidNotificationId(body.deviceId) || !isValidNotificationId(body.clientId)) {
    return NextResponse.json({ error: "deviceId and clientId are required", code: "invalid_device" }, { status: 400 });
  }
  return NextResponse.json({ via: await sendTestNotification(body.deviceId, body.clientId) });
}

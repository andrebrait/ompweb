import { NextResponse } from "next/server";
import { getSttJob } from "@/lib/stt-jobs";

export const dynamic = "force-dynamic";

/**
 * GET /api/stt/[jobId] — transcription job state:
 * { status: "pending" } | { status: "done", text } | { status: "error", error },
 * or 404 for an unknown/expired job. Job failures are 200 payloads, not 5xx,
 * so an intermediate proxy cannot swap them for its own error page.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const job = getSttJob((await params).jobId);
  if (!job) {
    return NextResponse.json({ error: "Transcription job not found", code: "stt_job_not_found" }, { status: 404 });
  }
  return NextResponse.json(job);
}

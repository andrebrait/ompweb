import { NextResponse } from "next/server";
import { parseFormDataWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { MAX_STT_AUDIO_BYTES, MAX_STT_REQUEST_BYTES } from "@/lib/stt";
import { startSttJob } from "@/lib/stt-jobs";

export const dynamic = "force-dynamic";

function cleanEnvVar(val?: string): string | undefined {
  const cleaned = val?.replace(/\\n|[\r\n]/g, "").trim();
  return cleaned || undefined;
}

/**
 * POST /api/stt — validates the audio and starts a server-side transcription
 * job. Returns 202 { jobId }; poll GET /api/stt/[jobId] for the result.
 */
export async function POST(request: Request) {
  try {
    const endpoint = cleanEnvVar(process.env.OMP_WEB_STT_ENDPOINT);
    if (!endpoint) {
      return NextResponse.json(
        { error: "STT not configured. Set OMP_WEB_STT_ENDPOINT." },
        { status: 501 }
      );
    }

    const apiKey = cleanEnvVar(process.env.OMP_WEB_STT_KEY);
    const model = cleanEnvVar(process.env.OMP_WEB_STT_MODEL);
    const formData = await parseFormDataWithinLimit(request, MAX_STT_REQUEST_BYTES);
    const file = formData.get("file");
    if (!file || typeof file === "string" || file.size === 0) {
      return NextResponse.json(
        { error: "Audio file is required", code: "missing_audio_file" },
        { status: 400 }
      );
    }
    if (file.size > MAX_STT_AUDIO_BYTES) {
      return NextResponse.json(
        { error: "Audio file too large (max 25MB)", code: "audio_too_large" },
        { status: 413 }
      );
    }

    if (model && !formData.has("model")) {
      formData.append("model", model);
    }

    return NextResponse.json({ jobId: startSttJob(endpoint, apiKey, formData) }, { status: 202 });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        { error: "Audio file too large (max 25MB)", code: "audio_too_large" },
        { status: 413 }
      );
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

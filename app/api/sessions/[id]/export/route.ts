import { apiErrorResponse, opErrorResponse, resolveSessionHostOr404 } from "@/lib/api-utils";
import { getContentDisposition } from "@/lib/content-disposition";

export const runtime = "nodejs";

/** Render a session to self-contained HTML with the omp binary on its host (`omp --export`). */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const inline = new URL(req.url).searchParams.get("inline") === "1";

  try {
    const resolved = await resolveSessionHostOr404(id);
    if ("response" in resolved) return resolved.response;
    const result = await resolved.host.sessionOps.exportSession(id);
    if (!result.ok) return opErrorResponse(result);
    return new Response(result.value.html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": getContentDisposition(result.value.fileName, inline, "session.html"),
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

import { NextResponse } from "next/server";
import { apiErrorResponse, opErrorResponse } from "@/lib/api-utils";
import { allowFileRoot } from "@/lib/file-access";
import { localHost } from "@/lib/hosts/local-host";
import { projectIdentityKey } from "@/lib/paths";

// POST /api/cwd/validate  body: { cwd: string }
// Validates a candidate workspace before the UI selects it.
export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: unknown };
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";

    if (!cwd) {
      return NextResponse.json({ error: "Path is required", code: "path_required" }, { status: 400 });
    }

    const result = await localHost.sessionOps.validateCwd(cwd);
    if (!result.ok) return opErrorResponse(result);
    allowFileRoot(result.value.cwd);
    return NextResponse.json({
      success: true,
      cwd: result.value.cwd,
      projectRoot: result.value.projectRoot,
      projectKey: projectIdentityKey(result.value.projectRoot),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

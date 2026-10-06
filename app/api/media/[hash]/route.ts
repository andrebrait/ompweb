import { readFile } from "node:fs/promises";
import { createThumbnail, existingThumbnail, imageMimeType, mediaFilePath } from "@/lib/media-cache";

export const dynamic = "force-dynamic";

function image(body: Buffer, type: string): Response {
  // A view, not a copy: these buffers come from readFile/sharp, never a SharedArrayBuffer.
  return new Response(new Uint8Array(body.buffer as ArrayBuffer, body.byteOffset, body.byteLength), {
    headers: {
      "Content-Type": type,
      // Content-addressed: the bytes behind a hash never change.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function readIfPresent(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** GET /api/media/<sha256>[?thumb=1] — a tool-result image, or its small WebP preview. */
export async function GET(req: Request, { params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  const thumb = new URL(req.url).searchParams.has("thumb");
  const cached = thumb ? existingThumbnail(hash) : null;
  const cachedBytes = cached ? await readIfPresent(cached) : null;
  if (cachedBytes) return image(cachedBytes, "image/webp");

  const file = mediaFilePath(hash);
  // The daily sweep or omp can remove a file between the lookup and the read.
  const bytes = file ? await readIfPresent(file) : null;
  if (!bytes) return new Response("Not found", { status: 404 });
  const type = imageMimeType(bytes);
  if (!type) return new Response("Not an image", { status: 415 });
  if (thumb) {
    const preview = await createThumbnail(hash, bytes);
    if (preview) return image(preview, "image/webp");
  }
  return image(bytes, type);
}

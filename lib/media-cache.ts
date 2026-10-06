import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getBlobsDir, getDiagnosticsDir } from "./omp/paths";
import { isRecord } from "./type-guards";

/**
 * Tool-result images reach the browser as `/api/media/<sha256>` URLs instead of
 * inline base64, so big screenshots never sit in the chat's React state. The
 * hash is omp's own blob address (sha256 of the image bytes): history entries
 * already carry it as `blob:sha256:<hash>`, and live output is hashed here and
 * copied into omp-web's media directory until omp writes its own blob.
 */

const HASH_RE = /^[a-f0-9]{64}$/;
const BLOB_PREFIX = "blob:sha256:";
/** Twice the 240px tool-result preview, for high-density screens. */
const THUMB_PX = 480;

function mediaDir(): string {
  return path.join(getDiagnosticsDir(), "media");
}

function writeAtomic(file: string, data: Buffer): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

// Live tool output resends the full accumulated result on every update; this
// keeps one screenshot from being decoded and hashed once per frame.
const recentHashes = new Map<string, string>();
const RECENT_MAX = 32;

/** Store a base64 image under its content address and return the hash. */
export function storeInlineImage(base64: string): string {
  const cached = recentHashes.get(base64);
  if (cached) return cached;
  const bytes = Buffer.from(base64, "base64");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const copy = path.join(mediaDir(), hash);
  if (!existsSync(path.join(getBlobsDir(), hash)) && !existsSync(copy)) writeAtomic(copy, bytes);
  recentHashes.set(base64, hash);
  if (recentHashes.size > RECENT_MAX) recentHashes.delete(recentHashes.keys().next().value!);
  return hash;
}

function imageBlockAsUrl(block: unknown): unknown {
  if (!isRecord(block) || block.type !== "image") return block;
  let data: unknown;
  let mimeType: unknown;
  if (typeof block.data === "string") {
    data = block.data;
    mimeType = block.mimeType;
  } else if (isRecord(block.source) && block.source.type === "base64") {
    data = block.source.data;
    mimeType = block.source.media_type;
  }
  if (typeof data !== "string" || data === "") return block;
  let hash: string;
  if (data.startsWith(BLOB_PREFIX)) {
    hash = data.slice(BLOB_PREFIX.length);
    if (!HASH_RE.test(hash)) return block;
  } else {
    try {
      hash = storeInlineImage(data);
    } catch {
      return block; // Disk trouble: keep showing the inline image.
    }
  }
  return { type: "image", ...(typeof mimeType === "string" ? { mimeType } : {}), url: `/api/media/${hash}` };
}

/** Tool-result content with every image replaced by a media URL. */
export function toolResultContentAsUrls<T>(content: T): T {
  if (!Array.isArray(content) || !content.some((block) => isRecord(block) && block.type === "image")) return content;
  return content.map(imageBlockAsUrl) as T;
}

function withContentAsUrls(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const content = toolResultContentAsUrls(value.content);
  return content === value.content ? value : { ...value, content };
}

function toolResultMessageAsUrls(message: unknown): unknown {
  return isRecord(message) && message.role === "toolResult" ? withContentAsUrls(message) : message;
}

function mapMessages(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const mapped = value.map(toolResultMessageAsUrls);
  return mapped.some((message, i) => message !== value[i]) ? mapped : value;
}

/** An omp agent event with its tool-result images as media URLs (same object when it has none). */
export function eventWithToolResultImageUrls<E extends { type: string; [key: string]: unknown }>(event: E): E {
  const swap = (key: string, value: unknown): E => (value === event[key] ? event : { ...event, [key]: value });
  switch (event.type) {
    case "tool_execution_update": return swap("partialResult", withContentAsUrls(event.partialResult));
    case "tool_execution_end": return swap("result", withContentAsUrls(event.result));
    case "message_start":
    case "message_end": return swap("message", toolResultMessageAsUrls(event.message));
    case "turn_end": return swap("toolResults", mapMessages(event.toolResults));
    case "agent_end": return swap("messages", mapMessages(event.messages));
    default: return event;
  }
}

/** File holding a stored image: omp's blob first, else omp-web's copy (removed once omp has the blob). */
export function mediaFilePath(hash: string): string | null {
  if (!HASH_RE.test(hash)) return null;
  const blob = path.join(getBlobsDir(), hash);
  const copy = path.join(mediaDir(), hash);
  if (existsSync(blob)) {
    if (existsSync(copy)) {
      try { unlinkSync(copy); } catch { /* another request removed it */ }
    }
    return blob;
  }
  return existsSync(copy) ? copy : null;
}

/** Raster image type from magic bytes; null for anything else (the blob store also holds non-images). */
export function imageMimeType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif";
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/** Existing thumbnail for `hash`, if one was generated before. */
export function existingThumbnail(hash: string): string | null {
  const thumb = path.join(mediaDir(), `${hash}.thumb.webp`);
  return HASH_RE.test(hash) && existsSync(thumb) ? thumb : null;
}

/** Generate and cache a small WebP preview; null when sharp is unavailable or fails. */
export async function createThumbnail(hash: string, image: Buffer): Promise<Buffer | null> {
  try {
    // Dynamic on purpose: sharp's native binary is platform-specific and may be
    // missing, and this module is also loaded by the session reader and RPC
    // manager, which must not fail or load libvips just to rewrite URLs.
    const { default: sharp } = await import("sharp");
    const thumb = await sharp(image)
      .resize(THUMB_PX, THUMB_PX, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    writeAtomic(path.join(mediaDir(), `${hash}.thumb.webp`), thumb);
    return thumb;
  } catch {
    return null;
  }
}

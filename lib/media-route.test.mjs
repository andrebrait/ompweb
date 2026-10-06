import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import sharp from "sharp";

// Real GET /api/media/[hash] against a throwaway agent dir.
const agentDir = mkdtempSync(join(tmpdir(), "omp-web-media-route-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, {
  tryNative: false,
  alias: { "@/": fileURLToPath(new URL("../", import.meta.url)) },
});
const route = await jiti.import("../app/api/media/[hash]/route.ts");
const { eventWithToolResultImageUrls } = await jiti.import("./media-cache.ts");

const blobs = join(agentDir, "blobs");
const media = join(agentDir, "omp-web", "media");
mkdirSync(blobs, { recursive: true });
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const get = (hash, query = "") => route.GET(new Request(`http://localhost/api/media/${hash}${query}`), { params: Promise.resolve({ hash }) });

const screenshot = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: "#336699" } }).png().toBuffer();
const screenshotHash = sha(screenshot);
writeFileSync(join(blobs, screenshotHash), screenshot);

test("serves the full image with its real type, and a small cached WebP preview", async () => {
  const full = await get(screenshotHash);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), screenshot);

  const thumb = await get(screenshotHash, "?thumb=1");
  assert.equal(thumb.headers.get("content-type"), "image/webp");
  const bytes = Buffer.from(await thumb.arrayBuffer());
  const { width, height } = await sharp(bytes).metadata();
  assert.deepEqual([width, height], [480, 300]);
  assert.ok(bytes.length < screenshot.length);
  assert.ok(existsSync(join(media, `${screenshotHash}.thumb.webp`)), "preview is generated once and kept");
});

test("never serves non-images or paths outside the store", async () => {
  const text = Buffer.from("data:text/html,<script>alert(1)</script>");
  writeFileSync(join(blobs, sha(text)), text);
  assert.equal((await get(sha(text))).status, 415);
  assert.equal((await get(sha(text), "?thumb=1")).status, 415);
  assert.equal((await get("../../etc/passwd")).status, 404);
  assert.equal((await get("b".repeat(64))).status, 404);
});

test("live tool output is served from omp-web's copy until omp writes its own blob", async () => {
  const live = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#ff0000" } }).png().toBuffer();
  const hash = sha(live);
  const event = {
    type: "tool_execution_end",
    toolCallId: "t1",
    result: { content: [{ type: "text", text: "Screenshot captured" }, { type: "image", data: live.toString("base64"), mimeType: "image/png" }] },
  };
  const rewritten = eventWithToolResultImageUrls(event);
  assert.deepEqual(rewritten.result.content[1], { type: "image", mimeType: "image/png", url: `/api/media/${hash}` });
  assert.equal(event.result.content[1].data, live.toString("base64"), "omp's frame is not mutated");
  assert.deepEqual(Buffer.from(await (await get(hash)).arrayBuffer()), live);

  writeFileSync(join(blobs, hash), live);
  assert.equal((await get(hash)).status, 200);
  assert.equal(existsSync(join(media, hash)), false, "the duplicate copy is dropped once omp has the blob");
});

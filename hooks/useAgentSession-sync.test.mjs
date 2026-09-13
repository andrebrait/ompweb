import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@/": new URL("../", import.meta.url).pathname } });
const { createSessionCatchUp } = await jiti.import("./useAgentSession-sync.ts");

test("a newer user delivery cannot block recovery of an unrelated assistant partial", async (t) => {
  const context = { messages: [], entryIds: [], thinkingLevel: "off", model: null, todoPhases: [] };
  let displayed = "visible before the gap";
  let release;
  let started;
  const requested = new Promise((resolve) => { started = resolve; });
  t.mock.method(globalThis, "fetch", () => new Promise((resolve) => {
    release = () => resolve({ ok: true, json: async () => ({
      sessionId: "s1", mode: "append", baseEntryId: null, context,
      cursor: { firstEntryId: null, lastEntryId: null }, hasMore: false, leafId: null,
      live: {
        cursor: { streamId: "stream", sequence: 2 }, isStreaming: true, isPromptRunning: true, isCompacting: false,
        streamingMessage: { role: "assistant", content: [{ type: "text", text: "recovered partial" }] }, toolEvents: [],
      },
    }) });
    started();
  }));
  const catchUp = createSessionCatchUp({
    sessionId: () => "s1", scope: () => "same-run", history() {}, subscribe: () => false,
    live(snapshot, fields) { if (fields.message) displayed = snapshot.streamingMessage.content[0].text; },
  });
  catchUp.seed(context);
  catchUp.observe({ type: "connected", web: { streamId: "stream", sequence: 1 } });
  const pending = catchUp.request();
  await requested;
  catchUp.observe({ type: "message_end", message: { role: "user", content: "steering" }, web: { streamId: "stream", sequence: 3 } });
  release();
  await pending;
  assert.equal(displayed, "recovered partial");
});

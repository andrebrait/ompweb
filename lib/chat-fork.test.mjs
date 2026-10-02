import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { resolveForkTargets } = await jiti.import("./chat-fork.ts");

const edit = (entryId) => ({ entryId, editPrompt: true });
const keep = (entryId) => ({ entryId, editPrompt: false });

test("user prompts edit-and-resend; replies fork at the next prompt so they are kept", () => {
  const roles = ["user", "assistant", "toolResult", "assistant", "user", "assistant"];
  const entryIds = ["u1", "a1", "t1", "a2", "u2", "a3"];
  assert.deepEqual(resolveForkTargets(roles, entryIds), [
    undefined, keep("u2"), undefined, keep("u2"), edit("u2"), edit("u2"),
  ]);
});

test("a fork that would edit the first prompt into an empty session is not offered", () => {
  assert.deepEqual(resolveForkTargets(["user", "assistant"], ["u1", "a1"]), [undefined, undefined]);
  // After compaction the first prompt has a summary before it, so it can be edited.
  assert.deepEqual(
    resolveForkTargets(["compactionSummary", "user", "assistant"], ["c0", "u1", "a1"]),
    [undefined, edit("u1"), edit("u1")],
  );
});

test("messages with no usable user entry have no fork target", () => {
  assert.deepEqual(
    resolveForkTargets(["assistant", "toolResult", "bashExecution"], ["a0", "t0", "b0"]),
    [undefined, undefined, undefined],
  );
});

test("a reply whose next prompt has no id falls back to editing its own prompt", () => {
  assert.deepEqual(
    resolveForkTargets(["user", "assistant", "user", "assistant", "user", "assistant"], ["u0", "a0", "u1", "a1", undefined, "a2"]),
    [undefined, keep("u1"), edit("u1"), edit("u1"), undefined, undefined],
  );
});

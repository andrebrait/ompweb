import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { applyBtwEvent, latestBtwTurn, mergeBtwHistory, upsertBtwRecord } = await jiti.import("./btw.ts");

const record = (overrides = {}) => ({
  id: "r1", leafId: null, question: "what is 2+2", answer: "", status: "running", createdAt: 1, updatedAt: 1, ...overrides,
});
const delta = (text, recordId = "r1") => ({ type: "btw_delta", recordId, delta: text });

test("deltas stream into a running record and stop once it settles", () => {
  let records = applyBtwEvent([], { type: "btw_record", record: record() });
  records = applyBtwEvent(records, delta("It is "));
  records = applyBtwEvent(records, delta("4."));
  assert.equal(records[0].answer, "It is 4.");

  records = applyBtwEvent(records, { type: "btw_record", record: record({ answer: "It is 4.", status: "complete", updatedAt: 2 }) });
  records = applyBtwEvent(records, delta(" late"));
  assert.equal(records[0].answer, "It is 4.");
  assert.equal(records[0].status, "complete");
});

test("a late btw response never wipes streamed text or resurrects a finished answer", () => {
  // SSE can beat the HTTP response: deltas land before the `btw` command's running snapshot.
  let records = applyBtwEvent([], { type: "btw_record", record: record() });
  records = applyBtwEvent(records, delta("It is 4."));
  records = upsertBtwRecord(records, record());
  assert.equal(records[0].answer, "It is 4.");

  records = applyBtwEvent(records, { type: "btw_record", record: record({ answer: "It is 4.", status: "complete" }) });
  records = upsertBtwRecord(records, record({ answer: "It is" }));
  assert.equal(records[0].status, "complete");
});

test("follow-up deltas extend the latest turn, not the original answer", () => {
  const first = record({ answer: "4", status: "complete" });
  const followUp = { question: "and 3+3?", answer: "", status: "running", createdAt: 3, updatedAt: 3 };
  let records = upsertBtwRecord([first], { ...first, followUps: [followUp] });
  records = applyBtwEvent(records, delta("6"));
  assert.equal(records[0].answer, "4");
  assert.equal(latestBtwTurn(records[0]).answer, "6");
  // A snapshot from before the follow-up started is stale.
  assert.equal(upsertBtwRecord(records, first), records);
});

test("history snapshots keep newer local state and add unseen records newest first", () => {
  const streaming = record({ answer: "It is 4" });
  const local = [record({ id: "r2", question: "new" }), streaming];
  const merged = mergeBtwHistory(local, [record({ answer: "It" }), record({ id: "r0", status: "complete", answer: "old" })]);
  assert.deepEqual(merged.map((r) => r.id), ["r2", "r1", "r0"]);
  assert.equal(merged[1].answer, "It is 4");
});

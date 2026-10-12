import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

// Real /api/notifications/history against a throwaway agent dir.
const agentDir = mkdtempSync(join(tmpdir(), "omp-web-history-route-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
after(() => {
  globalThis.__ompNotificationStore?.db.close();
  globalThis.__ompNotificationStore = undefined;
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, {
  tryNative: false,
  alias: { "@/": fileURLToPath(new URL("../", import.meta.url)) },
});
const route = await jiti.import("../app/api/notifications/history/route.ts");
const store = await jiti.import("./notification-store.ts");

const URL_ = "http://localhost/api/notifications/history";
const send = (method, body) => route[method](new Request(URL_, { method, headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : body === undefined ? undefined : JSON.stringify(body) }));
const ids = () => store.listHistory().map((entry) => [entry.id, entry.read]);

beforeEach(() => {
  store.clearHistory();
  for (const [i, sessionId] of ["s1", "s2", "s3"].entries()) store.recordHistory({ type: "completed", sessionId, sessionName: sessionId }, i);
});

test("GET lists the history newest first", async () => {
  const response = await route.GET();
  assert.equal(response.status, 200);
  const { entries } = await response.json();
  assert.deepEqual(entries.map((entry) => entry.id), ["s3:completed", "s2:completed", "s1:completed"]);
  assert.deepEqual(entries[0].event, { type: "completed", sessionId: "s3", sessionName: "s3" });
});

test("PATCH with ids marks only those entries read", async () => {
  assert.equal((await send("PATCH", { ids: ["s1:completed"] })).status, 200);
  assert.deepEqual(ids(), [["s3:completed", false], ["s2:completed", false], ["s1:completed", true]]);
});

test("PATCH with all marks every entry read", async () => {
  assert.equal((await send("PATCH", { all: true })).status, 200);
  assert.ok(store.listHistory().every((entry) => entry.read));
});

test("DELETE with an id removes that entry", async () => {
  assert.equal((await send("DELETE", { id: "s2:completed" })).status, 200);
  assert.deepEqual(ids().map(([id]) => id), ["s3:completed", "s1:completed"]);
});

test("DELETE without a body clears the history", async () => {
  assert.equal((await send("DELETE")).status, 200);
  assert.deepEqual(ids(), []);
});

test("invalid requests return 400 and change nothing", async () => {
  const before = ids();
  const invalid = [
    ["PATCH", "{not json"],
    ["PATCH", { ids: "s1:completed" }],
    ["PATCH", { ids: Array.from({ length: 101 }, (_, i) => `s${i}:completed`) }],
    ["PATCH", { ids: ["x".repeat(257)] }],
    ["PATCH", { ids: [42] }],
    ["PATCH", { all: "yes" }],
    ["PATCH", {}],
    ["PATCH", { ids: [`${"x".repeat(250)}`], pad: "y".repeat(40_000) }],
    ["DELETE", { id: 7 }],
    ["DELETE", { id: "" }],
    ["DELETE", "{not json"],
  ];
  for (const [method, body] of invalid) {
    const response = await send(method, body);
    assert.equal(response.status, 400, `${method} ${typeof body === "string" ? body : JSON.stringify(body).slice(0, 60)}`);
    assert.equal((await response.json()).code, "invalid_history_request");
  }
  assert.deepEqual(ids(), before);
});

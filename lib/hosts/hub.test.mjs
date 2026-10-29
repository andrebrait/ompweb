import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

// The hub keeps its links on globalThis; every test links its own host.
const agentDir = mkdtempSync(join(tmpdir(), "omp-web-hub-test-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url);
const hub = await jiti.import("./hub.ts");
const { LINK_ACK_HEADER, LINK_HELLO_HEADER, LINK_LIMITS, LINK_PROTOCOL_VERSION } = await jiti.import("./link-protocol.ts");
const { createHost } = await jiti.import("./registry.ts");

const defaultTimings = { ...hub.linkTimings };
test.afterEach(() => Object.assign(hub.linkTimings, defaultTimings));

const URL_BASE = "http://main.test/api/hosts/link";

function hello(overrides = {}) {
  return { type: "hello", v: LINK_PROTOCOL_VERSION, ompVersion: "14.0.0", platform: "linux", home: "/home/u", ack: 0, channels: [], ...overrides };
}

function linkGet(token, message = hello()) {
  return hub.handleLinkGet(new Request(URL_BASE, {
    headers: { authorization: `Bearer ${token}`, [LINK_HELLO_HEADER]: Buffer.from(JSON.stringify(message)).toString("base64url") },
  }));
}

function linkPost(token, messages, ack = 0) {
  return hub.handleLinkPost(new Request(URL_BASE, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, [LINK_ACK_HEADER]: String(ack) },
    body: messages.map((m) => `${JSON.stringify(m)}\n`).join(""),
  }));
}

/** Reads the NDJSON downlink one message at a time; null once the stream ended. */
function downlink(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    async next() {
      for (;;) {
        const index = buffer.indexOf("\n");
        if (index !== -1) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          return JSON.parse(line);
        }
        const { done, value } = await reader.read();
        if (done) return null;
        buffer += decoder.decode(value, { stream: true });
      }
    },
    /** Next message that is not a ping. */
    async nextReal() {
      for (;;) {
        const message = await this.next();
        if (message?.type !== "ping") return message;
      }
    },
    cancel: () => reader.cancel(),
  };
}

async function linkedHost(label = "Build box", overrides = {}) {
  const { host, token } = createHost(label);
  const response = await linkGet(token, hello(overrides));
  assert.equal(response.status, 200);
  const down = downlink(response);
  assert.deepEqual(await down.next(), { type: "welcome", v: LINK_PROTOCOL_VERSION, hostId: host.id });
  return { id: host.id, token, down, remote: hub.getHost(host.id) };
}

/** Answer the spawn request the hub sent and return the resolved SpawnResult. */
async function spawnOverLink({ token, down, remote }, extraUp = []) {
  const spawning = remote.spawnRpc({ cwd: "/w", recordedCwd: null, sessionFile: "", advisor: false });
  const req = await down.nextReal();
  assert.equal(req.type, "req");
  assert.equal(req.op, "spawn");
  const result = { cwd: "/w", fellBack: false, launchAdvisor: false, autoApproveExtension: true };
  return { req, spawning, result, post: (messages) => linkPost(token, [...extraUp, ...messages], req.seq) };
}

test("a missing, malformed or wrong bearer token gets 401 before the body is read", async () => {
  createHost("Real");
  for (const authorization of [undefined, "Basic abc", "Bearer ", "Bearer not-a-token"]) {
    const headers = authorization ? { authorization } : {};
    assert.equal((await hub.handleLinkGet(new Request(URL_BASE, { headers }))).status, 401);
    let pulled = false;
    const body = new ReadableStream({ pull() { pulled = true; } }, { highWaterMark: 0 });
    const post = new Request(URL_BASE, { method: "POST", headers, body, duplex: "half" });
    assert.equal((await hub.handleLinkPost(post)).status, 401);
    const blob = new Request(`${URL_BASE}/blob/r1`, { method: "POST", headers, body: new ReadableStream({ pull() { pulled = true; } }, { highWaterMark: 0 }), duplex: "half" });
    assert.equal((await hub.handleLinkBlob(blob, "r1")).status, 401);
    assert.equal(pulled, false, "the body must not be read before the token is verified");
    assert.equal(post.bodyUsed, false);
  }
});

test("a version mismatch gets 426 with both versions and marks the host needs-upgrade", async () => {
  const { host, token } = createHost("Old daemon");
  const response = await linkGet(token, hello({ v: LINK_PROTOCOL_VERSION + 1 }));
  assert.equal(response.status, 426);
  assert.deepEqual(await response.json(), {
    error: "Link protocol version mismatch",
    hostVersion: LINK_PROTOCOL_VERSION + 1,
    serverVersion: LINK_PROTOCOL_VERSION,
  });
  assert.equal(hub.listHosts().find((h) => h.id === host.id).status, "needs-upgrade");
});

test("hello without omp marks the host omp-missing and spawnRpc rejects", async () => {
  const { id, remote, down } = await linkedHost("No omp", { ompVersion: null });
  const listed = hub.listHosts().find((h) => h.id === id);
  assert.equal(listed.status, "omp-missing");
  assert.equal(listed.ompVersion, null);
  assert.equal(listed.platform, "linux");
  assert.equal(remote.status(), "omp-missing");
  await assert.rejects(remote.spawnRpc({ cwd: "/w", recordedCwd: null, sessionFile: "", advisor: false }), /omp is not installed on No omp/);
  await down.cancel();
});

test("a second link with the same token sends replaced on the first stream", async () => {
  const first = await linkedHost("Twice");
  const second = await linkGet(first.token);
  assert.equal(second.status, 200);
  assert.equal((await first.down.next()).type, "replaced");
  assert.equal(await first.down.next(), null);
  const down = downlink(second);
  assert.equal((await down.next()).type, "welcome");
  await down.cancel();
});

test("closeHostLink ends the stream, rejects pending ops and marks the host offline", async () => {
  const { id, down, remote } = await linkedHost("Closing");
  const pending = remote.sessionOps.listSessions();
  assert.equal((await down.nextReal()).op, "listSessions");
  hub.closeHostLink(id);
  assert.equal(await down.next(), null);
  await assert.rejects(pending, (error) => error.status === 503);
  assert.equal(remote.status(), "offline");
});

test("an op with no answer within opTimeoutMs rejects with 504 naming the host", async () => {
  hub.linkTimings.opTimeoutMs = 30;
  const { remote, down } = await linkedHost("Slow box");
  await assert.rejects(remote.sessionOps.listSessions(), (error) => {
    assert.equal(error.status, 504);
    assert.match(error.message, /Slow box/);
    return true;
  });
  await down.cancel();
});

test("no uplink traffic for offlineMs marks the host offline and notifies", async () => {
  hub.linkTimings.offlineMs = 40;
  const changed = new Promise((resolve) => {
    const unsubscribe = hub.onHostsChange(() => {
      if (hub.listHosts().some((h) => h.label === "Quiet box" && h.status === "offline")) {
        unsubscribe();
        resolve();
      }
    });
  });
  const { remote, down } = await linkedHost("Quiet box");
  assert.equal(remote.status(), "online");
  const statuses = [];
  remote.onStatus((status) => statuses.push(status));
  const guard = setTimeout(() => {}, 2_000);
  await changed;
  clearTimeout(guard);
  assert.equal(remote.status(), "offline");
  assert.deepEqual(statuses, ["offline"]);
  assert.equal(await down.next(), null, "an offline link closes its downlink so the daemon redials");
});

test("onHostHello reports the channels a daemon still runs", async () => {
  const seen = [];
  const unsubscribe = hub.onHostHello((hostId, channels) => seen.push({ hostId, channels }));
  const { id, down } = await linkedHost("Reattach", { channels: [{ ch: "c1", sessionId: "s1" }] });
  unsubscribe();
  assert.deepEqual(seen, [{ hostId: id, channels: [{ ch: "c1", sessionId: "s1" }] }]);
  await down.cancel();
});

test("RemoteHost spawns over the link and its transport replays output sent before subscription", async () => {
  const link = await linkedHost("Spawner");
  const { req, spawning, result, post } = await spawnOverLink(link);
  assert.deepEqual(req.args, { ch: req.args.ch, cwd: "/w", recordedCwd: null, sessionFile: "", advisor: false });
  const ch = req.args.ch;
  // Output can overtake the spawn result; the transport holds it for RpcProcess.
  const response = await post([
    { type: "stdout", seq: 1, ch, line: '{"type":"ready"}' },
    { type: "res", seq: 2, id: req.id, ok: true, result },
  ]);
  assert.deepEqual(await response.json(), { ack: 2 });
  const spawned = await spawning;
  assert.equal(spawned.cwd, "/w");
  assert.equal(link.remote.autoApproveExtension(), true);
  const lines = [];
  spawned.transport.onLine((line) => lines.push(line));
  assert.deepEqual(lines, ['{"type":"ready"}']);

  await new Promise((resolve) => spawned.transport.write('{"type":"get_state"}\n', resolve));
  assert.deepEqual(await link.down.nextReal(), { type: "stdin", seq: req.seq + 1, ch, line: '{"type":"get_state"}\n' });
  spawned.transport.killTree(true);
  assert.deepEqual(await link.down.nextReal(), { type: "kill", seq: req.seq + 2, ch, force: true });

  const exited = new Promise((resolve) => spawned.transport.onExit((code, signal) => resolve({ code, signal })));
  await linkPost(link.token, [{ type: "exit", seq: 3, ch, code: null, signal: "SIGKILL" }]);
  assert.deepEqual(await exited, { code: null, signal: "SIGKILL" });
  await link.down.cancel();
});

test("a resent uplink batch applies only the new seq and acks the highest", async () => {
  const link = await linkedHost("Resender");
  const { req, spawning, result, post } = await spawnOverLink(link);
  const ch = req.args.ch;
  const lines = [];
  await post([{ type: "res", seq: 1, id: req.id, ok: true, result }, { type: "stdout", seq: 2, ch, line: "a" }]);
  (await spawning).transport.onLine((line) => lines.push(line));
  // The response to that POST was lost: the daemon resends seq 1-2 with the new seq 3.
  const response = await linkPost(link.token, [
    { type: "res", seq: 1, id: req.id, ok: true, result },
    { type: "stdout", seq: 2, ch, line: "a" },
    { type: "stdout", seq: 3, ch, line: "b" },
  ]);
  assert.deepEqual(await response.json(), { ack: 3 });
  assert.deepEqual(lines, ["a", "b"]);
  await link.down.cancel();
});

test("downlink messages the daemon did not ack are resent after it redials", async () => {
  const link = await linkedHost("Redial");
  const { req, spawning, result, post } = await spawnOverLink(link);
  await post([{ type: "res", seq: 1, id: req.id, ok: true, result }]);
  const { transport } = await spawning;
  transport.write("one\n", () => {});
  transport.write("two\n", () => {});
  // The daemon applied "one" before its downlink broke; "two" was lost in flight.
  const one = await link.down.nextReal();
  await link.down.cancel();
  const again = downlink(await linkGet(link.token, hello({ ack: one.seq })));
  assert.equal((await again.next()).type, "welcome");
  assert.deepEqual(await again.nextReal(), { type: "stdin", seq: one.seq + 1, ch: req.args.ch, line: "two\n" });
  await again.cancel();
});

test("a restarted daemon (hello ack 0) starts a fresh uplink sequence", async () => {
  const link = await linkedHost("Restarted");
  const first = link.remote.sessionOps.listSessions();
  const req = await link.down.nextReal();
  await linkPost(link.token, [{ type: "res", seq: 1, id: req.id, ok: true, result: [] }], req.seq);
  assert.deepEqual(await first, []);
  await link.down.cancel();

  const down = downlink(await linkGet(link.token, hello({ ack: 0 })));
  assert.equal((await down.next()).type, "welcome");
  const second = link.remote.sessionOps.listSessions();
  const req2 = await down.nextReal();
  assert.ok(req2.seq > req.seq, "the hub keeps numbering its downlink");
  const response = await linkPost(link.token, [{ type: "res", seq: 1, id: req2.id, ok: true, result: [{ id: "s" }] }], req2.seq);
  assert.deepEqual(await response.json(), { ack: 1 });
  assert.deepEqual(await second, [{ id: "s" }]);
  await down.cancel();
});

test("large results arrive through the blob leg; daemon results are validated", async () => {
  const link = await linkedHost("Blobby");
  const reading = link.remote.sessionOps.readSession("s1", { deferThinking: true, deferMedia: true });
  const req = await link.down.nextReal();
  assert.deepEqual(req.args, { id: "s1", options: { deferThinking: true, deferMedia: true } });
  const value = { ok: true, value: { big: "x".repeat(100) } };
  const bytes = Buffer.from(JSON.stringify(value));
  const blobRequest = (id, body) => new Request(`${URL_BASE}/blob/${id}`, { method: "POST", headers: { authorization: `Bearer ${link.token}` }, body });
  assert.equal((await hub.handleLinkBlob(blobRequest("unknown", bytes), "unknown")).status, 404);
  assert.equal((await hub.handleLinkBlob(blobRequest(req.id, bytes), req.id)).status, 200);
  await linkPost(link.token, [{ type: "res", seq: 1, id: req.id, ok: true, blob: { bytes: bytes.byteLength } }], req.seq);
  assert.deepEqual(await reading, value);

  const media = link.remote.sessionOps.readMedia("f".repeat(64));
  const mediaReq = await link.down.nextReal();
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  assert.equal((await hub.handleLinkBlob(blobRequest(mediaReq.id, png), mediaReq.id)).status, 200);
  await linkPost(link.token, [{ type: "res", seq: 2, id: mediaReq.id, ok: true, blob: { bytes: 4 } }], mediaReq.seq);
  const result = await media;
  assert.equal(result.ok, true);
  assert.deepEqual([...result.value], [...png]);

  assert.deepEqual(await link.remote.sessionOps.readMedia("../etc/passwd"), { ok: false, status: 400, code: "invalid_hash", error: "Invalid media hash" });

  const bad = link.remote.sessionOps.readSessionState("s1");
  const badReq = await link.down.nextReal();
  await linkPost(link.token, [{ type: "res", seq: 3, id: badReq.id, ok: true, result: { ok: "yes" } }], badReq.seq);
  await assert.rejects(bad, (error) => error.status === 502 && /Blobby/.test(error.message));

  const failed = link.remote.sessionOps.readSessionState("s1");
  const failedReq = await link.down.nextReal();
  await linkPost(link.token, [{ type: "res", seq: 4, id: failedReq.id, ok: false, error: { status: 200, code: "x", message: "boom" } }], failedReq.seq);
  await assert.rejects(failed, (error) => error.status === 502 && /boom/.test(error.message));
  await link.down.cancel();
});

test("an over-limit batch gets 413; a batch cut mid-line applies nothing", async () => {
  const link = await linkedHost("Flood");
  const tooLarge = await hub.handleLinkPost(new Request(URL_BASE, {
    method: "POST",
    headers: { authorization: `Bearer ${link.token}`, [LINK_ACK_HEADER]: "0" },
    body: "x".repeat(LINK_LIMITS.uplinkBytes + 1),
  }));
  assert.equal(tooLarge.status, 413);

  let settled = false;
  const listing = link.remote.sessionOps.listSessions().then((value) => { settled = true; return value; });
  const req = await link.down.nextReal();
  const res = JSON.stringify({ type: "res", seq: 1, id: req.id, ok: true, result: [] });
  const cut = await hub.handleLinkPost(new Request(URL_BASE, {
    method: "POST",
    headers: { authorization: `Bearer ${link.token}`, [LINK_ACK_HEADER]: String(req.seq) },
    body: `${res}\n{"type":"stdout","seq":2,"ch":"c`,
  }));
  assert.equal(cut.status, 400);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "no line of a malformed batch is applied");
  assert.deepEqual(await (await linkPost(link.token, [JSON.parse(res)], req.seq)).json(), { ack: 1 });
  assert.deepEqual(await listing, []);
  await link.down.cancel();
});

test("getHost resolves local, linked and unknown ids", async () => {
  const { localHost } = await jiti.import("./local-host.ts");
  assert.equal(hub.getHost("local"), localHost);
  assert.equal(hub.getHost("no-such-host"), null);
  const { host } = createHost("Never linked");
  const remote = hub.getHost(host.id);
  assert.equal(remote, hub.getHost(host.id), "one RemoteHost per id");
  assert.equal(remote.label, "Never linked");
  assert.equal(remote.status(), "offline");
  await assert.rejects(remote.sessionOps.listSessions(), (error) => error.status === 503);
});

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

// The daemon in-process against a scripted server (the `fetch` option).
const scratch = mkdtempSync(join(tmpdir(), "omp-web-daemon-test-"));
const saved = { agentDir: process.env.PI_CODING_AGENT_DIR, bin: process.env.OMP_WEB_OMP_BIN };
process.env.PI_CODING_AGENT_DIR = join(scratch, "agent");
const fakeOmp = join(scratch, "fake-omp");
const pidFile = join(scratch, "omp.pid");
process.env.OMP_WEB_OMP_BIN = fakeOmp;
after(() => {
  for (const [key, value] of [["PI_CODING_AGENT_DIR", saved.agentDir], ["OMP_WEB_OMP_BIN", saved.bin]]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(scratch, { recursive: true, force: true });
});

writeFileSync(fakeOmp, `#!${process.execPath}
if (process.argv.includes("--version")) { console.log("14.0.0-fake"); process.exit(0); }
require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
  const { type } = JSON.parse(line);
  if (type === "flood") for (let i = 0; i < 200; i++) process.stdout.write(JSON.stringify({ type: "x", i, pad: "y".repeat(100_000) }) + "\\n");
  if (type === "echo") process.stdout.write('{"type":"echoed"}\\n');
});
`, { mode: 0o755 });

const jiti = createJiti(import.meta.url);
const { runHostDaemon } = await jiti.import("./daemon.ts");
const { LINK_HELLO_HEADER } = await jiti.import("./link-protocol.ts");

const encoder = new TextEncoder();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, what, timeoutMs = 15_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
}

/** A scripted main server: one downlink at a time, uplink POSTs recorded and acked. */
function scriptedServer({ getStatus = () => 200 } = {}) {
  const server = { up: [], hellos: [], downlink: null, uplinkDown: false, gets: 0 };
  let downSeq = 0;
  let ack = 0;
  server.fetch = async (url, init = {}) => {
    if (!init.method || init.method === "GET") {
      server.gets += 1;
      const status = getStatus(server.gets);
      if (status !== 200) return Response.json({}, { status });
      server.hellos.push(JSON.parse(Buffer.from(init.headers[LINK_HELLO_HEADER], "base64url").toString("utf8")));
      const body = new ReadableStream({ start(controller) { server.downlink = controller; } });
      const downlink = server.downlink;
      // Like real fetch: aborting the request errors its body.
      init.signal?.addEventListener("abort", () => {
        try { downlink.error(new Error("aborted")); } catch { /* already closed */ }
      });
      server.raw({ type: "welcome", v: 1, hostId: "h1" });
      return new Response(body);
    }
    if (String(url).includes("/blob/")) return Response.json({ ok: true });
    if (server.uplinkDown) throw new TypeError("fetch failed");
    const messages = String(init.body).split("\n").filter(Boolean).map((line) => JSON.parse(line));
    server.up.push(...messages);
    for (const message of messages) if (Number.isInteger(message.seq)) ack = Math.max(ack, message.seq);
    return Response.json({ ack });
  };
  server.raw = (message) => server.downlink.enqueue(encoder.encode(`${JSON.stringify(message)}\n`));
  server.send = (message) => {
    downSeq += 1;
    server.raw({ ...message, seq: downSeq });
    return downSeq;
  };
  server.res = (id) => server.up.find((m) => m.type === "res" && m.id === id);
  return server;
}

function start(server) {
  return runHostDaemon({ url: "http://127.0.0.1:9", token: "t", allowHttp: false, fetch: server.fetch });
}

async function spawnChannel(server, ch) {
  server.send({ type: "req", id: `spawn-${ch}`, op: "spawn", args: { ch, cwd: scratch, recordedCwd: null, sessionFile: "", advisor: false } });
  await waitFor(() => server.res(`spawn-${ch}`), "the spawn result");
  assert.equal(server.res(`spawn-${ch}`).ok, true, JSON.stringify(server.res(`spawn-${ch}`)));
}

function captureLog() {
  const lines = [];
  const original = console.error;
  console.error = (line) => lines.push(String(line));
  return { lines, restore: () => { console.error = original; } };
}

test("an http:// server needs loopback or --allow-http", () => {
  assert.throws(() => runHostDaemon({ url: "http://example.com", token: "t", allowHttp: false, fetch: async () => Response.json({}, { status: 503 }) }), /https:\/\//);
});

test("ops outside the allow-list are refused and a resent downlink seq runs once", async () => {
  const log = captureLog();
  const server = scriptedServer();
  const daemon = start(server);
  try {
    await waitFor(() => server.downlink, "the downlink");
    assert.equal(server.hellos[0].ack, 0);
    server.raw({ type: "req", seq: 1, id: "r1", op: "exec", args: { command: "id" } });
    const listing = { type: "req", seq: 2, id: "r2", op: "listProjects", args: {} };
    server.raw(listing);
    server.raw(listing);
    await waitFor(() => server.res("r1") && server.res("r2"), "both results");
    await sleep(100);
    assert.deepEqual(server.res("r1").error, { status: 400, code: "invalid_request", message: "unknown host op: exec" });
    assert.equal(server.res("r2").ok, true);
    assert.equal(server.up.filter((m) => m.id === "r2").length, 1);
  } finally {
    await daemon.stop();
    log.restore();
  }
  assert.equal(await daemon.done, 0);
});

test("output beyond the channel buffer while the uplink is down is dropped, then resync", async () => {
  const log = captureLog();
  const server = scriptedServer();
  const daemon = start(server);
  try {
    await waitFor(() => server.downlink, "the downlink");
    await spawnChannel(server, "c1");
    server.uplinkDown = true;
    server.send({ type: "stdin", ch: "c1", line: '{"type":"flood"}\n' });
    // 20 MB of output, read by the daemon well within this pause.
    await sleep(1_500);
    server.uplinkDown = false;
    await waitFor(() => server.up.some((m) => m.type === "resync" && m.ch === "c1"), "resync");
    const floodLines = server.up.filter((m) => m.type === "stdout" && m.ch === "c1").length;
    assert.ok(floodLines < 200, `dropped output must not arrive (${floodLines} lines did)`);
    // Output flows again after the resync.
    server.send({ type: "stdin", ch: "c1", line: '{"type":"echo"}\n' });
    await waitFor(() => server.up.some((m) => m.type === "stdout" && m.line === '{"type":"echoed"}'), "output after resync");
    const resyncAt = server.up.findIndex((m) => m.type === "resync");
    const echoAt = server.up.findIndex((m) => m.line === '{"type":"echoed"}');
    assert.ok(resyncAt < echoAt);
  } finally {
    await daemon.stop();
    log.restore();
  }
});

test("a 401 on redial (revoked) kills every omp child and exits 1", async () => {
  const log = captureLog();
  rmSync(pidFile, { force: true });
  const server = scriptedServer({ getStatus: (n) => (n === 1 ? 200 : 401) });
  const daemon = start(server);
  try {
    await waitFor(() => server.downlink, "the downlink");
    await spawnChannel(server, "c1");
    await waitFor(() => existsSync(pidFile), "the child");
    const pid = Number(readFileSync(pidFile, "utf8"));
    server.downlink.close();
    assert.equal(await daemon.done, 1);
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    assert.ok(log.lines.some((line) => line.includes("revoked")));
  } finally {
    log.restore();
  }
});

test("426 exits 1 asking for an upgrade; replaced exits 0", async () => {
  const log = captureLog();
  try {
    const outdated = start(scriptedServer({ getStatus: () => 426 }));
    assert.equal(await outdated.done, 1);
    assert.ok(log.lines.some((line) => line.includes("upgrade omp-web on this host")));

    const server = scriptedServer();
    const replaced = start(server);
    await waitFor(() => server.downlink, "the downlink");
    server.send({ type: "replaced" });
    assert.equal(await replaced.done, 0);
  } finally {
    log.restore();
  }
});

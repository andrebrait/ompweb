import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: {
    "@/": new URL("../", import.meta.url).pathname,
  },
});
const { getSelfUpdateStatus, parseSystemdServiceCgroup, resolveSelfUpdateTempRoot } = await jiti.import("./self-update.ts");

test("parseSystemdServiceCgroup finds system and user services, and nothing outside one", () => {
  assert.deepEqual(parseSystemdServiceCgroup("0::/system.slice/ompweb-api.service\n"), { unit: "ompweb-api.service", user: false });
  assert.deepEqual(
    parseSystemdServiceCgroup("0::/user.slice/user-1000.slice/user@1000.service/app.slice/ompweb.service\n"),
    { unit: "ompweb.service", user: true },
  );
  assert.deepEqual(
    parseSystemdServiceCgroup("12:pids:/system.slice/x.service\n1:name=systemd:/system.slice/ompweb.service\n"),
    { unit: "ompweb.service", user: false },
  );
  assert.deepEqual(
    parseSystemdServiceCgroup("1:name=systemd:/system.slice/ompweb.service\n0::/\n"),
    { unit: "ompweb.service", user: false },
  );
  assert.equal(parseSystemdServiceCgroup("0::/user.slice/user-1000.slice/session-3.scope\n"), null);
  assert.equal(parseSystemdServiceCgroup("0::/user.slice/user-1000.slice/user@1000.service/app.slice/tmux-spawn-1.scope\n"), null);
  assert.equal(parseSystemdServiceCgroup(""), null);
});

function withUpdateState(t, { workerPid, leaseExpiresAt }) {
  const temporary = mkdtempSync(join(tmpdir(), "self-update-test-"));
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = temporary;
  t.after(() => {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
    rmSync(temporary, { recursive: true, force: true });
  });
  const root = resolveSelfUpdateTempRoot("app");
  mkdirSync(root, { mode: 0o700 });
  const attemptId = "2e4c6460-5a8f-4ef7-8d81-42cb688a8bdc";
  if (leaseExpiresAt !== null) {
    writeFileSync(join(root, "lease.json"), JSON.stringify({ attemptId, kind: "app", expiresAt: leaseExpiresAt }), { mode: 0o600 });
  }
  writeFileSync(join(root, "status.json"), JSON.stringify({
    attemptId,
    state: "running",
    stage: "stopping",
    fromVersion: "0.5.2",
    targetVersion: "0.6.0",
    preparedAt: new Date().toISOString(),
    workerPid,
  }), { mode: 0o600 });
  return join(root, "status.json");
}

// A pid far above any pid_max, so it is never alive.
const DEAD_PID = 2 ** 30;

test("a running update whose worker died is reported, and stored, as failed", (t) => {
  const statusFile = withUpdateState(t, { workerPid: DEAD_PID, leaseExpiresAt: Date.now() + 60_000 });
  const status = getSelfUpdateStatus("app");
  assert.equal(status.state, "failed");
  assert.equal(status.cleanupReady, true);
  assert.match(status.error, /worker stopped/);
  assert.equal(JSON.parse(readFileSync(statusFile, "utf8")).state, "failed");
});

test("a running update past its lease is failed even when its pid is alive (reused)", (t) => {
  withUpdateState(t, { workerPid: process.pid, leaseExpiresAt: Date.now() - 1 });
  assert.equal(getSelfUpdateStatus("app").state, "failed");
});

test("a running update with a live worker inside its lease stays running", (t) => {
  const statusFile = withUpdateState(t, { workerPid: process.pid, leaseExpiresAt: Date.now() + 60_000 });
  assert.equal(getSelfUpdateStatus("app").state, "running");
  assert.equal(JSON.parse(readFileSync(statusFile, "utf8")).state, "running");
});

test("a running update before its worker pid is recorded stays running", (t) => {
  withUpdateState(t, { workerPid: undefined, leaseExpiresAt: Date.now() + 60_000 });
  assert.equal(getSelfUpdateStatus("app").state, "running");
});

test("a running update without a lease is failed", (t) => {
  withUpdateState(t, { workerPid: process.pid, leaseExpiresAt: null });
  assert.equal(getSelfUpdateStatus("app").state, "failed");
});

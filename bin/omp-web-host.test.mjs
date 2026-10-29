import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const bin = fileURLToPath(new URL("./omp-web.js", import.meta.url));

// Windows has no signals: child.kill("SIGTERM") terminates the process outright, so the daemon's handler never runs.
test("SIGTERM to `ompweb host` stops the daemon itself, leaving no orphan", { skip: process.platform === "win32" && "Windows kills on SIGTERM without running handlers" }, async (t) => {
  const scratch = mkdtempSync(join(tmpdir(), "omp-web-host-cli-"));
  const agentDir = join(scratch, "agent");
  mkdirSync(join(agentDir, "omp-web"), { recursive: true });
  // Nothing listens on this loopback port: the daemon redials until it is stopped.
  writeFileSync(join(agentDir, "omp-web", "host.json"), JSON.stringify({ url: "http://127.0.0.1:9", token: "t" }), { mode: 0o600 });
  const child = spawn(process.execPath, [bin, "host"], {
    env: { ...process.env, HOME: scratch, USERPROFILE: scratch, PI_CODING_AGENT_DIR: agentDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => {
    child.kill("SIGKILL");
    // An orphan holding the pipes must not keep this test process alive.
    child.stdout.destroy();
    child.stderr.destroy();
    rmSync(scratch, { recursive: true, force: true });
  });
  let log = "";
  child.stderr.on("data", (chunk) => { log += chunk; });
  // `close` fires once every holder of the stdio pipes is gone, an orphaned daemon included.
  const closed = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));

  const deadline = Date.now() + 15_000;
  while (!log.includes("redialing")) {
    assert.ok(Date.now() < deadline, `the daemon never dialed:\n${log}`);
    await sleep(20);
  }
  child.kill("SIGTERM");
  const stopped = await Promise.race([closed, sleep(10_000, null, { ref: false })]);
  assert.ok(stopped, `the daemon outlived SIGTERM:\n${log}`);
  assert.deepEqual(stopped, { code: 0, signal: null }, "the daemon's own stop handled the signal");
});

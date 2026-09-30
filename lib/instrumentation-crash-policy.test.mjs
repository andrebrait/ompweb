import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

// Runs instrumentation.node.ts's register() in a child, then throws `error`
// uncaught. Returns the exit status (0 = kept serving) and the crash journal.
function throwAfterRegister(errorExpr) {
  const home = mkdtempSync(join(tmpdir(), "omp-web-crash-policy-"));
  try {
    const script = `
      const { createJiti } = await import("jiti");
      const jiti = createJiti(${JSON.stringify(join(root, "lib/"))}, { tsconfigPaths: true });
      const { register } = await jiti.import(${JSON.stringify(join(root, "instrumentation.node.ts"))});
      await register();
      setTimeout(() => { throw ${errorExpr}; }, 0);
      setTimeout(() => process.exit(0), 300);
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: root,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        PI_CODING_AGENT_DIR: join(home, "agent"),
        OMP_WEB_OMP_BIN: join(home, "missing-omp"),
      },
      encoding: "utf8",
      timeout: 60_000,
    });
    let journal = "";
    try {
      journal = readFileSync(join(home, ".omp", "omp-web", "diagnostics.log"), "utf8");
    } catch {
      // No journal written.
    }
    return { status: result.status, journal, stderr: result.stderr };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("a client disconnect surfacing as uncaught `aborted` is journaled without exiting", () => {
  const { status, journal, stderr } = throwAfterRegister(`Object.assign(new Error("aborted"), { code: "ECONNRESET" })`);
  assert.equal(status, 0, stderr);
  assert.match(journal, /\[client-abort\] uncaughtException Error: aborted/);
  assert.doesNotMatch(journal, /\[crash\]/);
});

test("any other uncaught exception still exits with code 2", () => {
  for (const errorExpr of [
    `new Error("boom")`,
    `Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })`,
    `Object.assign(new Error("aborted"), { code: "ERR_OTHER" })`,
  ]) {
    const { status, journal, stderr } = throwAfterRegister(errorExpr);
    assert.equal(status, 2, `${errorExpr}\n${stderr}`);
    assert.match(journal, /\[crash\] uncaughtException/, errorExpr);
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("launcher refuses unauthenticated non-loopback binds", async () => {
  const source = await readFile(new URL("./omp-web.js", import.meta.url), "utf8");
  assert.match(source, /Refusing to listen on/);
  assert.match(source, /!passwordEnabled/);
});

test("launcher never reads or exports a plaintext password", async () => {
  const source = await readFile(new URL("./omp-web.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /process\.env\.OMP_WEB_PASSWORD\s*=/);
  assert.doesNotMatch(source, /process\.env\.OMP_WEB_PASSWORD\b(?!\s*[=!])/);
  assert.doesNotMatch(source, /\bOMP_WEB_PASSWORD:\s/);
  assert.match(source, /OMP_WEB_PASSWORD_HASH/);
});

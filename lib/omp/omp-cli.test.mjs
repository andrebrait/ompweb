import assert from "node:assert/strict";
import childProcess from "node:child_process";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });

test("version lookup reflects an updated executable without restarting the web server", async (t) => {
  const previousBin = process.env.OMP_WEB_OMP_BIN;
  process.env.OMP_WEB_OMP_BIN = process.execPath;
  t.after(() => {
    if (previousBin === undefined) delete process.env.OMP_WEB_OMP_BIN;
    else process.env.OMP_WEB_OMP_BIN = previousBin;
  });

  let installedVersion = "omp/18.1.19\n";
  t.mock.method(childProcess, "execFile", (_bin, _args, _options, callback) => {
    callback(null, installedVersion);
  });
  const { getOmpVersion } = jiti("./omp-cli.ts");

  assert.equal(await getOmpVersion(), "omp/18.1.19");
  installedVersion = "omp/18.1.21\n";
  assert.equal(await getOmpVersion(), "omp/18.1.21");
});

test("overlapping version lookups share a result instead of racing failure backoff", async (t) => {
  const previousBin = process.env.OMP_WEB_OMP_BIN;
  process.env.OMP_WEB_OMP_BIN = process.execPath;
  t.after(() => {
    if (previousBin === undefined) delete process.env.OMP_WEB_OMP_BIN;
    else process.env.OMP_WEB_OMP_BIN = previousBin;
  });
  const callbacks = [];
  t.mock.method(childProcess, "execFile", (_bin, _args, _options, callback) => {
    callbacks.push(callback);
  });
  const { getOmpVersion } = jiti("./omp-cli.ts");
  const first = getOmpVersion();
  const second = getOmpVersion();
  // Without coalescing, a later success can be followed by an older failure.
  if (callbacks.length > 1) {
    callbacks[1](null, "omp/18.1.21\n");
    await second;
    callbacks[0](new Error("executable replaced during update"), "");
  } else {
    callbacks[0](null, "omp/18.1.21\n");
  }
  assert.deepEqual(await Promise.all([first, second]), ["omp/18.1.21", "omp/18.1.21"]);
  const refreshed = getOmpVersion();
  callbacks.at(-1)(null, "omp/18.1.22\n");
  assert.equal(await refreshed, "omp/18.1.22");
});

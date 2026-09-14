import assert from "node:assert/strict";
import childProcess from "node:child_process";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

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

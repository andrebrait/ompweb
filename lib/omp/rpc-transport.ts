import { type ChildProcessWithoutNullStreams, spawn } from "child_process";
import { createInterface } from "readline";
import { wrapWindowsScript } from "./omp-cli";

/**
 * Byte pipe under `RpcProcess`. A transport owns the child (or any other
 * stream endpoint), delivers stdout lines and stderr chunks, reports exit once,
 * and terminates the whole tree. The protocol layer never touches a child.
 */
export interface RpcTransport {
  write(line: string, callback: (error?: Error | null) => void): void;
  onLine(listener: (line: string) => void): void;
  onStderr(listener: (chunk: string) => void): void;
  /** Fires once; a spawn error fires (null, null) after an onStderr("\nspawn error: …"). */
  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  endInput(): void;
  /** force=false → SIGTERM the tree, true → SIGKILL (taskkill /t[/f] on Windows). */
  killTree(force: boolean): void;
}

export function spawnLocalRpcTransport(options: {
  bin: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  spawn?: typeof spawn;
}): RpcTransport {
  const spawnProcess = options.spawn ?? spawn;
  const target = wrapWindowsScript(options.bin, options.args);
  const child: ChildProcessWithoutNullStreams = spawnProcess(target.file, target.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    // On POSIX, omp launches grandchildren (LSP servers, extension subprocesses). Run the
    // child in its own process group so killTree() can SIGTERM/SIGKILL the whole
    // tree — otherwise a crashed omp would orphan its LSP children as zombies.
    // Windows uses taskkill /t instead, so detaching would only create a console.
    detached: process.platform !== "win32",
  });

  // A write queued when the child dies fails both the write callback and an
  // 'error' event on the pipe. Without a listener that event becomes an
  // uncaughtException (Next merely logs it today; other hosts die).
  child.stdin.on("error", () => {});
  child.stdout.on("error", () => {});

  const lineListeners: Array<(line: string) => void> = [];
  const stderrListeners: Array<(chunk: string) => void> = [];
  const exitListeners: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];
  let exited = false;
  const emitExit = (code: number | null, signal: NodeJS.Signals | null) => {
    if (exited) return;
    exited = true;
    for (const listener of exitListeners) listener(code, signal);
  };

  createInterface({ input: child.stdout }).on("line", (line) => {
    for (const listener of lineListeners) listener(line);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    for (const listener of stderrListeners) listener(chunk.toString("utf8"));
  });
  child.on("exit", emitExit);
  child.on("error", (error) => {
    for (const listener of stderrListeners) listener(`\nspawn error: ${error.message}`);
    emitExit(null, null);
  });

  const killTree = (force: boolean) => {
    const signal: NodeJS.Signals = force ? "SIGKILL" : "SIGTERM";
    const pid = child.pid;
    if (!pid) return;
    // POSIX can signal the detached process group directly. Windows has no
    // portable negative-pid equivalent, so use taskkill's tree operation to
    // avoid orphaning extension and LSP grandchildren.
    if (process.platform === "win32") {
      const args = ["/pid", String(pid), "/t", ...(force ? ["/f"] : [])];
      const reaper = spawnProcess("taskkill", args, { windowsHide: true, stdio: "ignore" });
      reaper.once("error", () => {
        try { child.kill(signal); } catch {}
      });
      return;
    }
    try {
      process.kill(-pid, signal);
    } catch {
      try { child.kill(signal); } catch {}
    }
  };

  return {
    write(line, callback) {
      if (child.stdin.destroyed) {
        callback(new Error("RPC process is not running"));
        return;
      }
      child.stdin.write(line, (error) => callback(error ?? null));
    },
    onLine(listener) { lineListeners.push(listener); },
    onStderr(listener) { stderrListeners.push(listener); },
    onExit(listener) { exitListeners.push(listener); },
    endInput() {
      try { child.stdin.end(); } catch {}
    },
    killTree,
  };
}

# Remote Hosts (Sessions MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One omp-web runs omp sessions on other machines through an `omp-web host` daemon that dials out to it.

**Architecture:** A `Host` seam (`LocalHost` = today's code, `RemoteHost` = calls over a link) sits under `RpcProcess` and the session routes. The daemon spawns `omp --mode rpc-ui` locally, passes its NDJSON through unchanged, and answers an allow-listed set of host ops by running the same `lib/` code. The link is two HTTP legs (long-lived NDJSON GET down, batched POST up) with per-direction sequence numbers and acks.

**Tech Stack:** Next 16 route handlers, Node 24 (`fetch`, `node:test`), `jiti` (already a runtime dependency) to load `lib/*.ts` in the daemon.

**Spec:** `docs/specs/2026-10-28-remote-hosts-design.md`

## Global Constraints

- No new dependencies. No `ws`, no custom server: `next start` stays as is.
- `lib/hosts/*.ts` and everything they import that the daemon loads must not import `next/*` or `@/` aliases (the daemon runs them through plain `jiti`).
- Add `lib/hosts/*.test.mjs` to the `test` script glob in `package.json`.
- Client code (`components/`, `hooks/`) never calls `AbortSignal.timeout`, `AbortSignal.any` or `Promise.withResolvers`.
- Every new UI string gets a key in every file under `lib/i18n/locales/`.
- Live data reaches the browser only through `/api/events` channels; never add an `EventSource`.
- Values (copy them exactly): `LINK_PROTOCOL_VERSION = 1`; ping every 15 s; host offline after 30 s without `pong`; per-channel daemon buffer 8 MB; uplink flush every 16 ms or at 256 KB; uplink POST cap 16 MB; blob upload cap 64 MB; results over 1 MB go through the blob leg; op timeout 30 s; reconnect backoff 1 s doubling to 60 s with ±20 % jitter; token = 32 random bytes base64url, stored as `sha256` hex.
- Files: `<agent dir>/omp-web/hosts.json` (main) and `<agent dir>/omp-web/host.json` (daemon), both mode 0600, written temp-file + rename.
- Copy: "This machine"; "Not available on remote hosts yet"; "<host> is offline. The run continues there; it reconnects automatically."; "upgrade omp-web on this host"; "needs upgrade (host vN, server vM)"; "omp not installed"; "Start a session on <host> in <cwd>?".

## Review Focus

1. A leg breaks mid-write (downlink stdin line, uplink stdout batch): the line arrives exactly once after reconnect. Tests in Tasks 5 and 6.
2. The same session id on two hosts (a copied sessions dir): listed once, local first, else first host by label; routes go to that host. Test in Task 7.
3. A command sent while the host is offline fails fast with 503 `host_offline`; a command in flight when the link dropped still resolves after reconnect. Tests in Task 7.
4. A session result over 1 MB (long history) goes through the blob leg instead of failing the 8 MB line limit. Test in Task 6.
5. main restarts while a remote run is mid-turn: the orphan child is killed and the session resumes exactly once, after the orphan's `exit`, never two children on one file. Test in Task 7.

---

### Task 1: `RpcTransport` seam under `RpcProcess`

Pure refactor: `RpcProcess` stops owning `child_process`.

**Files:**
- Create: `lib/omp/rpc-transport.ts`
- Modify: `lib/omp/rpc-process.ts` (constructor, `writeFrame`, `dispose`)
- Test: `lib/omp/rpc-process-runtime.test.mjs` (extend)

**Interfaces:**
- Produces:
  ```ts
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
  export function spawnLocalRpcTransport(options: { bin: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; spawn?: typeof spawn }): RpcTransport;
  ```
  `RpcProcessOptions` gains `transport?: RpcTransport`. When absent, `RpcProcess` builds args/env exactly as today and calls `spawnLocalRpcTransport`. `dispose()` keeps today's grace → `killTree(false)` → `killTree(true)` timing.

- [ ] **Step 1: Write the failing test** `RpcProcess runs over an injected transport`: an in-memory transport that answers `ready` and a `get_state` response; assert `waitReady()` resolves, `sendCommand({type:"get_state"})` resolves to the response `data`, `dispose()` calls `endInput()` once and resolves after the transport fires `onExit(0, null)`.
- [ ] **Step 2: Run** `node --experimental-strip-types --test lib/omp/rpc-process-runtime.test.mjs` → FAIL (`transport` ignored, spawn attempted).
- [ ] **Step 3: Implement** `lib/omp/rpc-transport.ts` by moving the spawn, pipe error guards, process-group/taskkill code out of `RpcProcess`; `RpcProcess` uses only `RpcTransport`.
- [ ] **Step 4: Run** the full suite `npm test` → PASS (existing `rpc-process-runtime`, `win32-spawn`, `rpc-manager` tests unchanged).
- [ ] **Step 5: Commit** `refactor(rpc): run RpcProcess over an RpcTransport`.

### Task 2: Link protocol codec

**Files:**
- Create: `lib/hosts/link-protocol.ts`
- Test: `lib/hosts/link-protocol.test.mjs`
- Modify: `package.json` (test glob)

**Interfaces:**
- Produces:
  ```ts
  export const LINK_PROTOCOL_VERSION = 1;
  export const LINK_LIMITS: { pingMs: 15_000; offlineMs: 30_000; channelBufferBytes: 8 * 1024 * 1024; flushMs: 16; flushBytes: 256 * 1024; uplinkBytes: 16 * 1024 * 1024; blobBytes: 64 * 1024 * 1024; inlineResultBytes: 1024 * 1024; opTimeoutMs: 30_000; maxLineBytes: 8 * 1024 * 1024 };
  export type DownMessage = { type: "welcome"; v: number; hostId: string } | { type: "stdin"; seq: number; ch: string; line: string } | { type: "kill"; seq: number; ch: string; force: boolean } | { type: "req"; seq: number; id: string; op: HostOpName; args: unknown } | { type: "replaced"; seq: number } | { type: "ping" } | { type: "pong" };
  export type UpMessage = { type: "hello"; v: number; ompVersion: string | null; platform: string; home: string; ack: number; channels: { ch: string; sessionId: string | null }[] } | { type: "stdout"; seq: number; ch: string; line: string } | { type: "stderr"; seq: number; ch: string; chunk: string } | { type: "exit"; seq: number; ch: string; code: number | null; signal: string | null } | { type: "resync"; seq: number; ch: string } | { type: "res"; seq: number; id: string; ok: true; result?: unknown; blob?: { bytes: number } } | { type: "res"; seq: number; id: string; ok: false; error: { status: number; code: string; message: string } } | { type: "ping" } | { type: "pong" };
  export const HOST_OP_NAMES: readonly HostOpName[]; // the spec's Host ops table, exact names
  export type HostOpName = "listSessions" | "readSession" | "readContext" | "readThinking" | "readSessionState" | "readSubagentHistory" | "readSubagentTranscript" | "renameSessionFile" | "deleteSession" | "archiveSession" | "exportSession" | "readMedia" | "listProjects" | "addProject" | "updateProject" | "hideProject" | "validateCwd" | "spawn" | "sessionFileExists" | "invalidateSessionLists";
  export function encodeLine(message: DownMessage | UpMessage): string; // JSON + "\n"; throws LinkLimitError over maxLineBytes
  export function decodeDown(line: string): DownMessage; // throws LinkProtocolError on bad shape / unknown op
  export function decodeUp(line: string): UpMessage;
  export class SeqWindow { next(): number; applied(seq: number): boolean /* true if new, records it */; get acked(): number }
  export class Outbox<M extends { seq: number }> { push(m: M): void; ack(upTo: number): void; pending(): M[] }
  ```
- [ ] **Step 1: Write failing tests**: round-trip every message kind; `decodeUp('{"type":"res","seq":1,"id":"a","ok":true,"result":1}')` deep-equals the object; `decodeDown` rejects `op:"exec"` with `LinkProtocolError`; `encodeLine` of a `stdout` whose `line` is 8 MB + 1 throws `LinkLimitError`; `SeqWindow.applied(3)` after `applied(3)` is `false`; `Outbox.ack(2)` leaves only seq 3 in `pending()`.
- [ ] **Step 2: Run** `node --experimental-strip-types --test lib/hosts/link-protocol.test.mjs` → FAIL (module missing).
- [ ] **Step 3: Implement** the module and add `lib/hosts/*.test.mjs` to the `test` glob.
- [ ] **Step 4: Run** the test → PASS.
- [ ] **Step 5: Commit** `feat(hosts): link protocol codec`.

### Task 3: Host registry and tokens

**Files:**
- Create: `lib/hosts/registry.ts`
- Test: `lib/hosts/registry.test.mjs`

**Interfaces:**
- Produces:
  ```ts
  export interface HostRecord { id: string; label: string; tokenHash: string; createdAt: string; lastSeenAt: string | null; allowAgentStart: boolean }
  export function loadHosts(): HostRecord[];
  export function createHost(label: string): { host: HostRecord; token: string }; // id = randomUUID()
  export function updateHost(id: string, updates: { label?: string; allowAgentStart?: boolean }): HostRecord;
  export function revokeHost(id: string): boolean;
  export function hostForToken(token: string): HostRecord | null; // timingSafeEqual on sha256 hex
  export function touchHost(id: string, at: string): void;
  export function localAllowAgentStart(): boolean; // stored as top-level "localAllowAgentStart" in hosts.json, default false
  export function setLocalAllowAgentStart(value: boolean): void;
  ```
- [ ] **Step 1: Write failing tests** (temp `PI_CODING_AGENT_DIR`): `createHost` returns a 43-char base64url token and the file holds only its sha256; `hostForToken(token)` returns the record and `hostForToken(token + "x")` returns `null`; `revokeHost` then `hostForToken(token)` is `null`; the file mode is `0o600` on POSIX; a corrupt `hosts.json` loads as `[]` without throwing.
- [ ] **Step 2: Run** `node --experimental-strip-types --test lib/hosts/registry.test.mjs` → FAIL.
- [ ] **Step 3: Implement** with the atomic write pattern of `saveProjectRegistry` (`lib/project-registry.ts:128`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(hosts): host registry with hashed tokens`.

### Task 4: `Host` seam, `LocalHost`, wrapper and spawn path

Behavior-preserving: everything still runs on `LocalHost`.

**Files:**
- Create: `lib/hosts/host.ts`, `lib/hosts/local-host.ts`
- Modify: `lib/rpc-manager.ts` (`startRpcSession`, `AgentSessionWrapper` constructor/restart, the five `existsSync` sites at 722, 1121, 1395, 1450, 2201, `invalidateSessionLists` at 1101, `readNativeSettings` at 917, `resumeInterruptedSessions`, `launchConfigForCwd`)
- Test: `lib/rpc-manager.test.mjs` (extend)

**Interfaces:**
- Consumes: `RpcTransport`, `spawnLocalRpcTransport` (Task 1).
- Produces:
  ```ts
  export type HostStatus = "online" | "offline" | "needs-upgrade" | "omp-missing";
  export interface SpawnRequest { cwd: string; recordedCwd: string | null; sessionFile: string; toolNames?: string[]; advisor: boolean }
  export interface SpawnResult { transport: RpcTransport; cwd: string; fellBack: boolean; launchAdvisor: boolean }
  export interface Host {
    readonly id: string;            // "local" for LocalHost
    readonly label: string;
    status(): HostStatus;
    onStatus(listener: (status: HostStatus) => void): () => void;
    spawnRpc(request: SpawnRequest): Promise<SpawnResult>;
    sessionFileExists(path: string): Promise<boolean>;
    invalidateSessionLists(sessionFile?: string): void;
    autoApproveExtension(): boolean;
  }
  export const localHost: Host; // lib/hosts/local-host.ts
  ```
  `startRpcSession(sessionId, sessionFile, cwd, toolNames?, advisor?, recordedCwd?, host = localHost)` (the `launchConfig` parameter is removed; the host computes it). `AgentSessionWrapper` gets `readonly host: Host` and uses it at every site listed above; sync sites that need `sessionFileExists` become `void this.host.sessionFileExists(f).then(...)`. `resolveSpawnCwdResult` and `launchConfigForCwd` move into `local-host.ts`.
- [ ] **Step 1: Write failing test** `wrapper spawns through its host`: a fake `Host` whose `spawnRpc` returns the existing in-memory child as an `RpcTransport` and records the `SpawnRequest`; `startRpcSession("s1", "", "/w", undefined, false, null, fakeHost)` resolves, the recorded request equals `{cwd:"/w", recordedCwd:null, sessionFile:"", toolNames:undefined, advisor:false}`, and an `agent_end` frame calls `fakeHost.invalidateSessionLists`.
- [ ] **Step 2: Run** `node --experimental-strip-types --test lib/rpc-manager.test.mjs` → the new test FAILS.
- [ ] **Step 3: Implement** `host.ts`, `local-host.ts` and the wrapper changes.
- [ ] **Step 4: Run** `npm test` → PASS; `node_modules/.bin/tsc --noEmit` → no errors.
- [ ] **Step 5: Commit** `refactor(rpc): spawn and file checks go through a Host`.

### Task 5: Session ops and host-resolving routes

Behavior-preserving locally; this is the code the daemon will call.

**Files:**
- Create: `lib/hosts/session-ops.ts`
- Modify: `lib/api-utils.ts` (`resolveSessionPathOr404` → `resolveSessionHostOr404`), every route in `app/api/sessions/**`, `app/api/agent/[id]/route.ts`, `app/api/projects/route.ts`, `app/api/cwd/validate/route.ts`, `app/api/sessions/route.ts`
- Test: `lib/hosts/session-ops.test.mjs`

**Interfaces:**
- Produces:
  ```ts
  export type OpResult<T> = { ok: true; value: T } | { ok: false; status: number; code: string; error: string };
  export interface SessionOps { // one function per session/project op in HOST_OP_NAMES, args and value JSON-serializable
    listSessions(): Promise<SessionInfo[]>;
    readSession(id: string, options: { deferThinking: boolean; deferMedia: boolean }): Promise<OpResult<SessionReadValue>>;
    readContext(id: string, leafId: string, options: { deferThinking: boolean; deferMedia: boolean }): Promise<OpResult<unknown>>;
    readThinking(id: string, entryId: string, block: number): Promise<OpResult<unknown>>;
    readSessionState(id: string): Promise<OpResult<unknown>>;
    readSubagentHistory(id: string): Promise<OpResult<unknown>>;
    readSubagentTranscript(id: string, subagentId: string, mode: "page" | "completion", cursor: number): Promise<OpResult<unknown>>;
    renameSessionFile(id: string, title: string): Promise<OpResult<null>>;
    deleteSession(id: string): Promise<OpResult<unknown>>;
    archiveSession(id: string): Promise<OpResult<unknown>>;
    exportSession(id: string): Promise<OpResult<{ html: string; fileName: string }>>;
    readMedia(hash: string): Promise<OpResult<Uint8Array>>;
    listProjects(): Promise<ManagedProject[]>;
    addProject(path: string, launchConfig?: ProjectLaunchConfig): Promise<OpResult<ManagedProject>>;
    updateProject(path: string, updates: Record<string, unknown>): Promise<OpResult<null>>;
    hideProject(path: string): Promise<OpResult<null>>;
    validateCwd(path: string): Promise<OpResult<{ cwd: string }>>;
  }
  export const sessionOps: SessionOps; // the local implementation; Host gains `readonly sessionOps: SessionOps`, localHost uses this
  export async function resolveSessionHostOr404(id: string): Promise<{ host: Host } | { response: Response }>; // lib/api-utils.ts
  ```
  Each op holds the file-reading part of its route, moved verbatim with its error handling; the route keeps the live-wrapper parts (`getRpcSession`, `includeState`, `set_session_name`, stopping a running child before delete) and maps `OpResult` errors to `NextResponse.json({error, code}, {status})`. `readSession` returns everything the route returns today except `sessionId` and `agent`.
- [ ] **Step 1: Write failing tests** against a temp agent dir with one fixture session (copy the fixture helper from `session-reader.test.mjs`): `readSession(id)` value has `info.id === id` and `context.messages.length > 0`; `readSession("missing")` is `{ok:false,status:404}`; `readMedia("x")` is `{ok:false,status:400}` (hash must match `^[0-9a-f]{64}$`); `renameSessionFile` then `listSessions()` shows the new name.
- [ ] **Step 2: Run** `node --experimental-strip-types --test lib/hosts/session-ops.test.mjs` → FAIL.
- [ ] **Step 3: Implement** `session-ops.ts`, `resolveSessionHostOr404` (local only for now: `resolveSessionPath(id)` hit → `localHost`), and switch every route to `host.sessionOps`.
- [ ] **Step 4: Run** `npm test` and `node_modules/.bin/tsc --noEmit` → PASS; then `npm run dev`, open an existing session, rename it, open a subagent transcript and export: same results as before.
- [ ] **Step 5: Commit** `refactor(sessions): route session file access through host session ops`.

### Task 6: Daemon and host hub, linked end to end

**Files:**
- Create: `lib/hosts/hub.ts` (main side: links, `RemoteHost`, `RemoteRpcTransport`), `lib/hosts/daemon.ts` (host side), `app/api/hosts/link/route.ts` (GET, POST), `app/api/hosts/link/blob/[reqId]/route.ts` (POST), `bin/omp-web-host.js`
- Modify: `bin/omp-web.js` (`host` subcommand → `omp-web-host.js`), `proxy.ts`, `package.json` `bin` (`ompweb-host`)
- Test: `lib/hosts/hub.test.mjs`, `lib/hosts/link-integration.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces:
  ```ts
  // hub.ts (globalThis registry, like rpc-manager)
  export function handleLinkGet(req: Request): Promise<Response>;   // 401 bad token, 426 version mismatch, else NDJSON stream
  export function handleLinkPost(req: Request): Promise<Response>;  // body: NDJSON UpMessages; response {ack}
  export function handleLinkBlob(req: Request, reqId: string): Promise<Response>;
  export function getHost(id: string): Host | null;                 // "local" → localHost
  export function listHosts(): { id: string; label: string; status: HostStatus; ompVersion: string | null; platform: string | null; lastSeenAt: string | null }[];
  export function onHostsChange(listener: () => void): () => void;
  export function onHostHello(listener: (hostId: string, channels: { ch: string; sessionId: string | null }[]) => void): () => void;
  export function closeHostLink(id: string): void;                 // used by revoke
  // daemon.ts
  export function runHostDaemon(options: { url: string; token: string; allowHttp: boolean; fetch?: typeof fetch }): { stop(): Promise<void> };
  export function loginHost(options: { url: string; token: string }): void; // writes host.json 0600
  ```
  `bin/omp-web-host.js`: `omp-web host login --url <url>` reads the token from stdin; `omp-web host [--allow-http]` reads `host.json` and runs. Refuses `http://` unless the host is loopback or `--allow-http`. Exits with "upgrade omp-web on this host" on 426 and with code 0 on `replaced`. `proxy.ts`: `pathname.startsWith("/api/hosts/link")` with an `authorization: Bearer` header → `NextResponse.next()` before the session check.
- [ ] **Step 1: Write failing unit tests** in `hub.test.mjs` using an in-memory link (call `handleLinkGet`/`handleLinkPost` with `Request` objects): wrong token → 401; `v: 2` → 426 with both versions in the body and `listHosts()` showing that host as `needs-upgrade`; `hello` with `ompVersion: null` → `omp-missing` and `spawnRpc` rejects; a second GET with the same token sends `replaced` on the first stream; `closeHostLink(id)` ends the stream; a `req` with no `res` within `opTimeoutMs` (inject a short timeout) rejects with status 504 and the host label in the message; no `pong` for `offlineMs` → `status() === "offline"` and `onHostsChange` fires; a POST resending seq 1–3 after seq 1–2 were applied applies only seq 3 and answers `{ack: 3}`.
- [ ] **Step 2: Write failing integration test** `link-integration.test.mjs`: serve the two link routes through a `node:http` adapter on `127.0.0.1:0` (load routes with `jiti` and the `@/` alias as `agent-skill-diagnostics-route.test.mjs` does); run `runHostDaemon` with its own temp `HOME`/`PI_CODING_AGENT_DIR` and `OMP_WEB_OMP_BIN` pointing at a fake omp script (answers `ready`, `get_state`, and echoes `prompt` as `agent_start` + `agent_end`). Assert: `getHost(id).sessionOps.listSessions()` returns the fixture session; `startRpcSession(…, getHost(id))` + `send({type:"prompt"})` yields `agent_end`; destroy the uplink socket mid-batch and the downlink once, and the frame sequence seen by the wrapper has no gap and no duplicate; a `readSession` of a 2 MB fixture session arrives through the blob leg.
- [ ] **Step 3: Run** `node --experimental-strip-types --test lib/hosts/hub.test.mjs lib/hosts/link-integration.test.mjs` → FAIL.
- [ ] **Step 4: Implement** hub, routes, daemon, bin wiring, proxy exemption. Daemon op dispatch: name must be in `HOST_OP_NAMES`; `spawn`, `sessionFileExists`, `invalidateSessionLists` reject paths outside `join(getAgentDir(), "sessions")` with 403. Daemon keeps children alive while the uplink is down, buffers per channel up to `channelBufferBytes`, then drops and sends `resync`. A 401 on reconnect (host revoked) kills every child and exits with code 1.
- [ ] **Step 5: Run** the two tests → PASS; `npm test` → PASS.
- [ ] **Step 6: Commit** `feat(hosts): omp-web host daemon and link hub`.

### Task 7: Remote routing, media, offline state, resume

**Files:**
- Create: `lib/hosts/session-index.ts`
- Modify: `lib/api-utils.ts`, `app/api/sessions/route.ts`, `app/api/agent/new/route.ts`, `app/api/agent/[id]/route.ts`, `app/api/media/[hash]/route.ts`, `lib/rpc-manager.ts` (`send` guard, `host_status` frame, resume), `lib/session-resume.ts`, `lib/types.ts` (`SessionInfo.hostId`, `ManagedProject.hostId`), `instrumentation.node.ts`
- Test: `lib/hosts/session-index.test.mjs`, `lib/rpc-manager.test.mjs`, `lib/session-resume.test.mjs` (extend)

**Interfaces:**
- Consumes: `getHost`, `listHosts`, `onHostHello` (Task 6).
- Produces:
  ```ts
  export async function listSessionsAllHosts(): Promise<SessionInfo[]>;   // each with hostId; per-host 30 s cache; offline hosts keep their last list
  export async function hostForSessionId(id: string): Promise<Host | null>; // local hit first, then remote index, one refresh on miss
  export function invalidateHostSessionList(hostId: string): void;
  export async function fetchMediaFromHosts(hash: string): Promise<Uint8Array | null>; // first online host whose bytes sha256 to hash
  ```
  `InterruptibleSession` gains `hostId: string` (missing in old files → `"local"`). `resumeInterruptedSessions` resumes local entries as today and keeps remote entries pending until `onHostHello` for that host, then resumes each one after any orphan channel with that `sessionId` has sent `exit`. `AgentSessionWrapper.send` throws `WebRpcError("<label> is offline…", "host_offline")` while `host.status() !== "online"`; the agent route maps `host_offline` to 503 `{hostOffline: true}`. The wrapper emits `{type:"host_status", hostId, status}` on host status changes and pauses its idle/disconnect timers while offline. `POST /api/agent/new` accepts `hostId` (default `"local"`); 404 for unknown, 503 when offline.
- [ ] **Step 1: Write failing tests**:
  - `session-index`: id on local and remote → one entry with `hostId:"local"`; id on hosts "b-mac" and "a-vm" only → `hostId` of "a-vm"; remote host offline → its last list still returned.
  - `fetchMediaFromHosts`: a host returning bytes whose sha256 ≠ hash is skipped.
  - `rpc-manager`: offline host → `send({type:"prompt"})` rejects with code `host_offline`; a `sendCommand` written before the drop resolves after the link returns.
  - `session-resume`: a list entry without `hostId` reads back as `"local"`; a remote entry resumes only after `onHostHello` and after the orphan's `exit`, and exactly once.
- [ ] **Step 2: Run** the three files → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `node_modules/.bin/tsc --noEmit` → PASS.
- [ ] **Step 5: Commit** `feat(hosts): route sessions, media and resume to their host`.

### Task 8: Hosts API, `hosts` channel, Settings → Hosts

**Files:**
- Create: `app/api/hosts/route.ts`, `components/HostsConfig.tsx`
- Modify: `lib/event-stream-hub.ts`, `lib/event-stream-protocol.ts` (`hosts` channel), `components/SettingsTabs.tsx`, `lib/i18n/locales/*.json`
- Test: `lib/hosts/hosts-route.test.mjs`, `lib/event-stream-hub.test.mjs` (extend)

**Interfaces:**
- Consumes: Task 3 registry, Task 6 `listHosts`/`onHostsChange`/`closeHostLink`.
- Produces: `GET /api/hosts` → `{ hosts: [{id,label,status,ompVersion,platform,lastSeenAt,allowAgentStart}], localAllowAgentStart }` with `local` first; `POST {label}` → `{host, token, command}` where `command` is `omp-web host login --url <origin>`; `PATCH {id, label?, allowAgentStart?}` (`id:"local"` only accepts `allowAgentStart`); `DELETE ?id=` revokes and calls `closeHostLink`. Channel `hosts` sends the `GET` body on subscribe and on every change.
- [ ] **Step 1: Write failing tests**: POST returns a token once and a later GET never contains `token` or `tokenHash`; DELETE then a link GET with that token → 401; PATCH `id:"local", label:"x"` → 400; a `hosts` subscription receives a frame when `onHostsChange` fires.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the route, channel and `HostsConfig` (list with status dot and copy above, Add host dialog that shows token + command once with copy buttons, rename, revoke via `ConfirmDialog`, `allowAgentStart` switch per host and for "This machine").
- [ ] **Step 4: Run** tests → PASS; `npm run dev`: add a host, copy the command, run `omp-web host login` + `omp-web host --allow-http` against `http://127.0.0.1:30178` with a temp `HOME`, and see the host turn online in Settings.
- [ ] **Step 5: Commit** `feat(hosts): manage linked hosts in Settings`.

### Task 9: Sidebar by host, new-session host picker, offline banner

**Files:**
- Modify: `components/SessionSidebar.tsx`, `components/AppShell.tsx`, `hooks/useAgentSession.ts`, `components/ChatWindow.tsx`, `lib/project-ordering.ts`, `lib/i18n/locales/*.json`
- Test: `lib/project-ordering.test.mjs`, `hooks/useAgentSession.rpc.test.mjs` (banner and 503 toast)

**Interfaces:**
- Consumes: `SessionInfo.hostId`, `ManagedProject.hostId` (Task 7), `hosts` channel (Task 8).
- Produces: project identity key `hostId === "local" ? path : \`${hostId}:${path}\`` everywhere the sidebar keys projects (expanded set, pins, sort order, `omp-web:expanded-projects`), so existing local keys stay valid.
- [ ] **Step 1: Write failing tests**: grouping puts "local" first, then hosts by label; the same path on two hosts yields two projects with distinct keys; an existing stored local key still matches its project.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**: per-host collapsible group header (label + status dot) wrapping today's project list; offline groups dimmed with open/new disabled and the reason in a tooltip; host `<select>` on the new-session screen beside the workspace picker (hidden when only `local` exists); the Browse button and the Files/Git/Worktrees tabs show "Not available on remote hosts yet" for a remote session; `useAgentSession` shows the offline banner on `host_status` and a toast on a 503 `hostOffline` send, keeping the draft.
- [ ] **Step 4: Run** tests → PASS; `npm run lint`; with the Task 8 setup, start a session on the linked host from the UI, stop the daemon mid-run and see the banner, restart it and see the run finish.
- [ ] **Step 5: Commit** `feat(hosts): group the sidebar by host`.

### Task 10: `start_session` server host tool

**Files:**
- Create: `lib/hosts/start-session-tool.ts`
- Modify: `lib/rpc-manager.ts` (`set_host_tools` merge at 1787, `host_tool_call` at 810, `extension_ui_response` handling)
- Test: `lib/hosts/start-session-tool.test.mjs`

**Interfaces:**
- Consumes: `startRpcSession`, `getHost`, registry `allowAgentStart`/`localAllowAgentStart`.
- Produces: tool definition `{ name: "start_session", description, parameters: { type:"object", required:["host","cwd","prompt"], properties: { host:{type:"string"}, cwd:{type:"string"}, prompt:{type:"string"}, model:{type:"string", description:"provider/modelId"} } } }`, registered by the wrapper after `ready` and merged into every `set_host_tools` the tab sends. `host` matches a host id or label case-insensitively, or `local`. Result text: `Started session <id> on <label>. Open: /?session=<id>`. When the host's allow flag is off, the wrapper emits a server-owned `extension_ui_request` `{method:"confirm", title:"Start a session on <host> in <cwd>?"}` through the same path omp's requests take (so the input-needed notification fires) and consumes the matching `extension_ui_response` instead of forwarding it to omp.
- [ ] **Step 1: Write failing tests**: allow off + user confirms → session started and result names it; allow off + user declines → error result `"declined"`, no session; allow on → no confirm frame; unknown host → error result listing known host labels; offline host → error result `"<label> is offline"`; a tab's `set_host_tools([open_url])` sent to omp contains both `open_url` and `start_session`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(hosts): let agents start sessions on a host`.

### Task 11: Documentation and acceptance

**Files:**
- Modify: `AGENTS.md` (Remote hosts section + file map rows for `lib/hosts/*`, `app/api/hosts/*`), `DESIGN.md` (Host seam in the porting contract), `README.md` (linking a machine; running `omp-web host` under the existing launchd/systemd helpers), `CHANGELOG.md`

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Run** `npm test`, `npm run lint`, `node_modules/.bin/tsc --noEmit` → all pass.
- [ ] **Step 3: Manual acceptance** (spec → Testing): MacBook linked over `https://ai-web.brait.dev`; start a session there from the VM UI; close the lid mid-run; reopen; the run state is correct and the session finishes.
- [ ] **Step 4: Commit** `docs(hosts): document remote hosts`.

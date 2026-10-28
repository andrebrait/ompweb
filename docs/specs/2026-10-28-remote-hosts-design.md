# Remote hosts: run omp sessions on other machines from one omp-web

## Goal

One omp-web drives omp sessions on several machines. Examples: work that must
run on a MacBook (its hardware, its files), or load spread over machines
without agents using SSH between them. An agent in one session can also start a
session on another machine.

Each machine keeps its own omp install, agent directory (`~/.omp/agent`),
sessions and credentials. Nothing is shared between machines; omp-web only
routes.

## Delivery

Full parity on remote hosts is the target. It ships in three sub-projects, each
with its own spec, plan and PR, merged to `main` when ready:

1. **Sessions (this spec, the MVP).** Daemon, link, host registry, routing,
   session list and history, live chat, notifications, starting sessions.
2. **Files, git and worktrees** on remote hosts.
3. **Config surfaces:** skills, plugins, MCP, `models.yml`, auth/login, usage,
   `omp update`, STT gateway.

The `Host` interface and the host-op channel defined here serve all three:
sub-projects 2 and 3 add ops, not new message shapes. Until a sub-project
lands, the UI labels the features it covers as unavailable on remote hosts
("Not available on remote hosts yet") instead of hiding remote hosts behind a
flag.

## Non-goals

- Correlating the same repository across hosts (merged "group by project"
  sidebar mode); planned for a later version, see Sidebar.
- Moving or syncing sessions between hosts.
- A higher-level session API on the daemon. omp's RPC is the protocol; the
  daemon passes it through unchanged.
- Changes to omp. omp has no remote mode (`omp --help`: `rpc`/`rpc-ui`/`acp`
  over stdio only), and none is needed.

## Architecture

```
Browser ─▶ main omp-web ──┬─ LocalHost ── spawn omp --mode rpc-ui (stdio)
                          │
                          └─ RemoteHost ◀── link (HTTP) ── omp-web host (daemon)
                                                            └─ spawn omp --mode rpc-ui
```

### Daemon: `omp-web host`

A subcommand of the existing `@kahme247/ompweb` package (`bin/omp-web.js`), so
it runs omp-web's own `lib/` server code on the remote machine.

- `omp-web host login --url <url>` reads the host token from stdin and saves
  `<agent dir>/omp-web/host.json` (mode 0600). The token is never an argv
  value, which `ps` would expose.
- `omp-web host` dials the saved URL and keeps the link up, reconnecting with
  exponential backoff (1 s doubling to 60 s, with jitter).
- `https://` is required. `http://` is accepted only for loopback addresses or
  with `--allow-http` (for example on a tailnet).
- It spawns `omp --mode rpc-ui` children on request and forwards their NDJSON
  both ways unchanged, tagged with a channel id.
- It answers host ops (below) by calling the existing `lib/` functions.
  There is no generic exec or file-read op.
- omp children outlive a dropped link; their output is buffered (see Link).
- It owns auto-resume for its own sessions: the existing
  `lib/session-resume.ts` mechanism runs inside the daemon with the daemon's pid,
  following the main omp-web's `autoResumeSessions` setting, which it receives
  in the `hello` response.

### Host hub (main omp-web)

`lib/host-hub.ts` accepts daemon links on `/api/hosts/link` and keeps a
`globalThis` registry `hostId → link`, the same pattern as `lib/rpc-manager.ts`
(survives hot reload).

### `Host` interface

`lib/hosts/host.ts` defines the one seam between omp-web and a machine:

- `spawnRpc(options) → RpcTransport`: what `RpcProcess` writes to and reads
  from.
- One async method per host op.
- `status`: `online | offline | needs-upgrade | omp-missing`.

Two implementations:

- `LocalHost` (`id: "local"`, label "This machine"): today's behavior,
  `child_process.spawn` and direct `fs`.
- `RemoteHost`: the same calls over the link.

`RpcProcess` (`lib/omp/rpc-process.ts`) takes its transport from the host
instead of spawning itself. `AgentSessionWrapper`, the event-stream hub,
notifications, the queue and `/btw` are unchanged: they see frames, wherever
the process runs.

### Host registry

`<agent dir>/omp-web/hosts.json`, mode 0600, written atomically (temp file +
rename, like `lib/project-registry.ts`). Each record: `id`, `label`,
`tokenHash` (`sha256` hex), `createdAt`, `lastSeenAt`,
`allowAgentStart` (bool, default `false`). The built-in `local` host is not
stored.

Settings → Hosts lists hosts with status, omp version and last seen; adds a
host (shows the token once, with the `omp-web host login` command to run);
renames; revokes; toggles `allowAgentStart`.

### Routing

Every `SessionInfo` carries `hostId`. Session ids are UUIDs, so they do not
collide across hosts. `listAllSessions()` merges every host's list;
API routes resolve `id → hostId` from that merged list once and call the
owning host. A session whose host is unknown (revoked) is not listed.

## Link protocol

omp-web runs under `next start` with no custom server (`bin/omp-web.js`), and
Next route handlers cannot accept WebSocket upgrades. The link therefore uses
two HTTP legs, both opened by the daemon (which also works behind NAT):

- **Downlink** `GET /api/hosts/link`: a long-lived NDJSON response, main →
  daemon.
- **Uplink** `POST /api/hosts/link`: batched NDJSON, daemon → main, flushed
  every 16 ms or at 256 KB.
- Both legs carry `Authorization: Bearer <host token>`. `proxy.ts` exempts
  `/api/hosts/link` from the password gate only when that header is present;
  the route itself verifies the token.

### Messages

One JSON object per line.

| Message | Direction | Purpose |
|---|---|---|
| `hello {v, ompVersion, platform, home, channels[]}` | up | Handshake; `channels` lists live omp children from before a reconnect. `ompVersion` is `null` when `omp` is not found. |
| `welcome {v, hostId, settings}` | down | Accepted; `settings` carries `autoResumeSessions`. |
| `open {ch, sessionId?, cwd, args}` | down | Spawn `omp --mode rpc-ui`. |
| `stdin {ch, line}` | down | One raw omp NDJSON line. |
| `stdout {ch, line}` | up | One raw omp NDJSON line. |
| `stderr {ch, chunk}` | up | Child stderr, for the existing logging. |
| `kill {ch, signal}` | down | Stop a child. |
| `exit {ch, code, signal}` | up | Child exited. |
| `resync {ch}` | up | Buffered output for `ch` was dropped. |
| `req {id, op, args}` | down | Host op request. |
| `res {id, ok, result \| error}` | up | Host op result. |
| `replaced` | down | A newer link with this token took over; the daemon exits. |
| `ping` / `pong` | both | Liveness, every 15 s. |

### Rules

- **Version.** `v` is an integer bumped on any incompatible change. On a
  mismatch the link request gets 426 with both versions; the daemon exits with
  "upgrade omp-web on this host"; Settings → Hosts shows
  "needs upgrade (host vN, server vM)".
- **Identity.** The host is the record whose `tokenHash` matches. Nothing the
  daemon sends selects or changes its identity.
- **One link per host.** A new link with the same token replaces the old one,
  which receives `replaced`. Two daemons must never run competing
  `omp --resume` children against one agent directory.
- **Buffering.** While the uplink is down, the daemon buffers each child's
  output up to 8 MB per channel. On overflow it drops that channel's buffer
  and sends `resync {ch}` after reconnecting; main then runs the existing
  `get_state` reconcile for that session.
- **Reattach.** On `hello`, main reattaches every listed `ch` to its
  `AgentSessionWrapper`. A wrapper whose channel is missing from `hello` gets a
  synthesized `process_exit`. A wrapper whose host link is down is in a
  "transport down" state, never "process exited"; its idle
  (`IDLE_DESTROY_MS`) and disconnect (`DISCONNECT_DESTROY_MS`) timers pause
  until the link returns.
- **Binary results.** Op results over 1 MB (blobs, thumbnails) are sent as
  raw bytes to `POST /api/hosts/link/blob/<reqId>`, never as base64 inside
  NDJSON.
- **Limits.** Uplink batches are capped at 16 MB and blob uploads at 64 MB;
  over-limit requests get 413. A single `stdout` line over 8 MB closes that
  channel with `resync`.

## Host ops (this sub-project)

Each op runs the existing `lib/` function on the daemon's machine and returns
what that function returns today.

| Op | Backing code |
|---|---|
| `listSessions` | `listAllSessions()` (`lib/session-reader.ts`) |
| `readSession {id}` | session file load (`lib/session-reader.ts`) |
| `readContext {id, leafId}` | `buildSessionContext` |
| `readSubagentHistory {id}` | `extractSubagentHistory` (`lib/subagent-history.ts`) |
| `readSubagentTranscript {id, subagentId, mode, cursor}` | `/api/sessions/[id]/subagents*` readers |
| `readBlob {hash}` | omp blob store / `lib/media-cache.ts` source lookup |
| `renameSession {id, title}` | existing rename path |
| `deleteSession {id}` | existing delete path |
| `exportSession {id}` | `/api/sessions/[id]/export` renderer |
| `listProjects` / `addProject {path}` / `hideProject {path}` | `lib/project-registry.ts` |
| `validateCwd {path}` | `/api/cwd/validate` logic |

Op timeout: 30 s, then 504 naming the host.

## Data flow

- **Sidebar list.** Main calls `listSessions` on each online host and caches
  each host's list separately (30 s TTL, matching the local list cache). An
  `agent_end`, `session_info_update`, compaction or rename on a host
  invalidates only that host's cache. An offline host keeps its last list.
- **Open a session.** Resolve `id → hostId`, call `host.readSession`.
- **Send a message.** `startRpcSession()` asks the session's host for a
  transport (`host.spawnRpc`); everything above `RpcProcess` is unchanged.
- **Images.** `lib/media-cache.ts` fetches a remote blob through `readBlob`
  and stores the copy in the main omp-web's media directory, so
  `/api/media/<hash>` serves remote and local images the same way.
- **Live events.** Unchanged: the `running`, `session`, `notifications` and
  `host-tools` channels carry wrapper frames regardless of host.

## Sidebar

- **This version:** grouped by host. "This machine" comes first, then each
  remote host in label order. Each group header shows the host label and a
  status dot (online, offline, needs upgrade, omp missing) and collapses.
  Inside a group the sidebar works as today: projects, sessions, sort, pins.
  Project pins and sort order are per host.
- **Offline host:** its group shows the last known list dimmed. Opening its
  sessions and starting new ones there are disabled, with the reason in a
  tooltip.
- **New session:** the new-session screen gets a host picker beside the
  workspace picker; workspaces list from the chosen host.
- **Later version (out of scope):** an optional "group by project" mode that
  merges the same repository across hosts and marks each session with a host
  badge. The `hostId` on every `SessionInfo` is what it needs.

## Security

**Trust model.** The main omp-web can start omp, with full tool access, on
every linked host. Control of the main server or of a host token is a shell on
that machine. That is inherent to the feature and the same exposure the main
machine already has. The rules below limit anything beyond it.

- Host tokens are 32 random bytes (base64url). Only `sha256(token)` is
  stored; the token is shown once. Revoking deletes the record and closes the
  open link immediately.
- The daemon stores its token in a 0600 file, never in argv.
- The daemon requires `https://` except for loopback or `--allow-http`.
- Daemon input to main is untrusted data:
  - Remote paths never reach main's local filesystem. Every path is scoped to
    a `hostId` and resolved only by that host.
  - Blob hashes must match `^[0-9a-f]{64}$`; image bytes pass the existing
    magic-byte check in `/api/media/[hash]`.
  - Size limits from Link → Limits apply.
  - Remote omp output goes through the same sanitizing as local output.
- The daemon checks every path argument against its own allowed roots
  (computed on its machine from its session cwds and project registry); it
  never trusts a path because main sent it. `validateCwd` and `addProject` are
  how a new root becomes allowed, as `allowFileRoot()` does locally.

## Agent-initiated sessions

omp-web already registers host tools with omp (`set_host_tools`,
`lib/rpc-manager.ts`), today supplied by the browser tab. The server also
registers its own tool for every session it runs, merged with the tab's
tools:

- `start_session {host, cwd, prompt, model?}`: starts a session on the named
  host (label or id; `local` for this machine) and sends `prompt`. Returns the
  new session id and its omp-web URL.

The call arrives over a session omp-web already owns, so it needs no new
credential and cannot be reached from outside omp-web.

**Guard:** when the target host's `allowAgentStart` is `false` (the
default), the call shows a `confirm` request through the existing extension-UI
flow ("Start a session on <host> in <cwd>?"), which also raises the existing
input-needed notification. Declining returns an error result to the agent.
`local` follows the same rule through a "This machine" toggle in Settings →
Hosts.

## Error handling

| Failure | Behavior |
|---|---|
| No `pong` for 30 s | Host is offline. Its sessions show a banner: "<host> is offline. The run continues there; it reconnects automatically." Sends return 503 `{hostOffline: true}`; the composer keeps the draft and shows a toast. |
| Link returns, children alive | Wrappers reattach; `get_state` reconcile runs; `resync` channels reconcile too. |
| Daemon restarted, children gone | Synthesized `process_exit` per missing channel, which raises the existing "Run failed" notification. If the daemon's auto-resume restarts the session, the wrapper rebinds by session id. |
| Second daemon with the same token | Newest link wins; the old daemon receives `replaced` and exits. |
| Host op over 30 s | 504 naming the host; the sidebar keeps that host's last list. |
| Version mismatch | 426; host status `needs-upgrade`. |
| `omp` missing on the host | Host status `omp-missing`; new sessions there are disabled. |
| Host revoked while sessions run | Link closed; its wrappers are destroyed; its sessions leave the list. The omp children on that machine are killed by the daemon when it sees the 401 on reconnect. |

## Testing

`node:test` `.mjs` files beside the code, as in the rest of the repository.

- **Unit:**
  - link message encode/decode and size limits
  - token generation, hashing, verification; revoke closes the link
  - host hub: reattach, `replaced`, offline after missed pongs, missing
    channel → `process_exit`
  - `RemoteHost` + `RpcProcess` over an in-memory link
  - buffer overflow → `resync` → reconcile
  - remote path scoping and blob-hash validation
  - `start_session` confirm gate, with `allowAgentStart` on and off
- **Integration:** a real `omp-web host` process with its own `HOME` (a second
  "machine") linked to the dev server on loopback. Start a session, stream a
  reply, cut the link, reconnect, check reattach and that no frame is lost or
  duplicated.
- **Manual acceptance:** a MacBook linked over `https://ai-web.brait.dev`.
  Start a session there from the VM's UI; close the lid during a run; reopen;
  the run state is correct and the session finishes.

## Documentation

- `AGENTS.md`: a "Remote hosts" section (Host interface, link protocol rules,
  one-link-per-host, transport-down vs exited), and new files in the file map.
- `DESIGN.md`: the `Host` seam in the porting contract.
- `README.md`: how to link a machine (`omp-web host login`, `omp-web host`,
  running it as a service).
- `CHANGELOG.md` entry.

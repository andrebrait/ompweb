// Main-server end of the host link (spec "Link protocol"): accepts `omp-web
// host` daemons on /api/hosts/link and exposes each linked machine as a
// `RemoteHost`. Everything a daemon sends is untrusted input.
// No `next/*` or `@/` imports.
import { randomUUID } from "node:crypto";
import { readBodyWithinLimit, RequestBodyTooLargeError } from "../bounded-form-data";
import type { RpcTransport } from "../omp/rpc-transport";
import { isRecord } from "../type-guards";
import type { Host, HostStatus, SpawnRequest, SpawnResult } from "./host";
import {
  decodeUp,
  encodeLine,
  HostOpError,
  LINK_ACK_HEADER,
  LINK_HELLO_HEADER,
  LINK_LIMITS,
  LINK_NONCE_HEADER,
  LINK_PROTOCOL_VERSION,
  LinkLimitError,
  Outbox,
  SeqWindow,
  SESSION_OP_PARAMS,
  type DownMessage,
  type HostOpName,
  type UpMessage,
} from "./link-protocol";
import { localHost } from "./local-host";
import { HostRegistryUnreadableError, hostForToken, loadHosts, touchHost, type HostRecord } from "./registry";
import type { SessionOps } from "./session-ops";

/** Liveness and op timeouts from LINK_LIMITS; tests shorten them. */
export const linkTimings = {
  pingMs: LINK_LIMITS.pingMs,
  offlineMs: LINK_LIMITS.offlineMs,
  opTimeoutMs: LINK_LIMITS.opTimeoutMs,
};

type HelloChannel = { ch: string; sessionId: string | null };
type Hello = Extract<UpMessage, { type: "hello" }>;
type Res = Extract<UpMessage, { type: "res" }>;
/** A sequenced downlink message before the link numbers it. */
type Unsequenced<M> = M extends { seq: number } ? Omit<M, "seq"> : never;

interface PendingOp {
  op: HostOpName;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  /** Result bytes uploaded on the blob leg ahead of their `res`. */
  blob: Uint8Array<ArrayBuffer> | null;
}

interface Link {
  readonly id: string;
  readonly host: RemoteHost;
  status: HostStatus;
  /** Names the current downlink (`welcome.nonce`); null until a daemon says hello.
   * Uplink POSTs and blob uploads from any other link are refused. */
  nonce: string | null;
  /** Link protocol version the daemon last presented (Settings shows it on a 426). */
  hostVersion: number | null;
  ompVersion: string | null;
  platform: string | null;
  lastSeenAt: string | null;
  autoApprove: boolean;
  stream: ReadableStreamDefaultController<Uint8Array> | null;
  /** Last downlink seq handed out. Lines stay in `outbox` until the daemon acks them. */
  downSeq: number;
  outbox: Outbox<{ seq: number; line: string }>;
  up: SeqWindow;
  pending: Map<string, PendingOp>;
  channels: Map<string, RemoteRpcTransport>;
  pingTimer: NodeJS.Timeout | undefined;
  offlineTimer: NodeJS.Timeout | undefined;
  statusListeners: Set<(status: HostStatus) => void>;
}

interface HubState {
  links: Map<string, Link>;
  changeListeners: Set<() => void>;
  helloListeners: Set<(hostId: string, channels: HelloChannel[]) => void>;
}

declare global {
  var __ompHostHub: HubState | undefined;
}

// globalThis, like the rpc-manager registry: survives Next.js hot reload.
function hub(): HubState {
  globalThis.__ompHostHub ??= { links: new Map(), changeListeners: new Set(), helloListeners: new Set() };
  return globalThis.__ompHostHub;
}

function linkFor(id: string): Link {
  const links = hub().links;
  let link = links.get(id);
  if (!link) {
    link = {
      id,
      host: new RemoteHost(id),
      status: "offline",
      nonce: null,
      hostVersion: null,
      ompVersion: null,
      platform: null,
      lastSeenAt: null,
      autoApprove: false,
      stream: null,
      downSeq: 0,
      outbox: new Outbox(),
      up: new SeqWindow(),
      pending: new Map(),
      channels: new Map(),
      pingTimer: undefined,
      offlineTimer: undefined,
      statusListeners: new Set(),
    };
    links.set(id, link);
  }
  return link;
}

function labelOf(id: string): string {
  return loadHosts().find((h) => h.id === id)?.label ?? id;
}

function notify<A extends unknown[]>(listeners: Iterable<(...args: A) => void>, ...args: A): void {
  for (const listener of listeners) {
    try {
      listener(...args);
    } catch {
      // A listener bug must not break the link.
    }
  }
}

function setStatus(link: Link, status: HostStatus): void {
  if (link.status !== status) {
    link.status = status;
    notify(link.statusListeners, status);
  }
  notify(hub().changeListeners);
}

const encoder = new TextEncoder();
const isStatus = (status: unknown): status is number => Number.isInteger(status) && (status as number) >= 400 && (status as number) <= 599;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

function enqueue(link: Link, line: string): void {
  try {
    link.stream?.enqueue(encoder.encode(line));
  } catch {
    // Closed under us; sequenced lines are still in the outbox.
    link.stream = null;
  }
}

/** Number, keep until acked, and send. Throws LinkLimitError before recording anything. */
function sendDown(link: Link, body: Unsequenced<DownMessage>): void {
  const seq = link.downSeq + 1;
  const line = encodeLine({ ...body, seq } as DownMessage);
  link.downSeq = seq;
  link.outbox.push({ seq, line });
  enqueue(link, line);
}

function endStream(link: Link): void {
  const stream = link.stream;
  link.stream = null;
  try {
    stream?.close();
  } catch {
    // Already closed.
  }
}

function stopTimers(link: Link): void {
  clearInterval(link.pingTimer);
  clearTimeout(link.offlineTimer);
  link.pingTimer = undefined;
  link.offlineTimer = undefined;
}

function persistLastSeen(link: Link): void {
  if (!link.lastSeenAt) return;
  try {
    touchHost(link.id, link.lastSeenAt);
  } catch {
    // Last-seen is informational; a failed write must not drop the link.
  }
}

/** Any uplink traffic proves the daemon alive; silence for offlineMs means the link is gone. */
function sawDaemon(link: Link): void {
  link.lastSeenAt = new Date().toISOString();
  clearTimeout(link.offlineTimer);
  link.offlineTimer = setTimeout(() => {
    stopTimers(link);
    // The daemon redials once its downlink ends.
    endStream(link);
    persistLastSeen(link);
    setStatus(link, "offline");
  }, linkTimings.offlineMs);
  link.offlineTimer.unref?.();
}

/** The host the bearer token names, or the refusal to answer with. */
function authenticate(req: Request): HostRecord | Response {
  const header = req.headers.get("authorization");
  const token = typeof header === "string" && header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  try {
    const record = token ? hostForToken(token) : null;
    return record ?? json({ error: "Invalid host token" }, 401);
  } catch (error) {
    if (!(error instanceof HostRegistryUnreadableError)) throw error;
    // Never 401 here: a daemon told its token is unknown stops every omp child.
    console.error(`[omp-web] host link refused: ${error.message}`);
    return json({ error: "The host registry cannot be read" }, 503);
  }
}

/** The authenticated host's link when the request names its current nonce. */
function currentLink(req: Request, record: HostRecord): Link | null {
  const link = hub().links.get(record.id);
  return link?.nonce && req.headers.get(LINK_NONCE_HEADER) === link.nonce ? link : null;
}

const staleLink = () => json({ error: "This link was replaced; wait for the next welcome" }, 409);

/** GET /api/hosts/link: the daemon's downlink, an NDJSON stream. */
export async function handleLinkGet(req: Request): Promise<Response> {
  const record = authenticate(req);
  if (record instanceof Response) return record;
  const header = req.headers.get(LINK_HELLO_HEADER);
  const text = header ? Buffer.from(header, "base64url").toString("utf8") : "";
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json({ error: "Missing or malformed hello" }, 400);
  }
  const link = linkFor(record.id);
  // Compared before decoding: another protocol version may shape its hello differently.
  const version = isRecord(raw) ? raw.v : undefined;
  if (version !== LINK_PROTOCOL_VERSION) {
    // Kept for Settings: "needs upgrade (host vN, server vM)".
    link.hostVersion = typeof version === "number" && Number.isInteger(version) ? version : null;
    setStatus(link, "needs-upgrade");
    return json({
      error: "Link protocol version mismatch",
      hostVersion: link.hostVersion,
      serverVersion: LINK_PROTOCOL_VERSION,
    }, 426);
  }
  let hello: UpMessage;
  try {
    hello = decodeUp(text);
  } catch {
    return json({ error: "Missing or malformed hello" }, 400);
  }
  if (hello.type !== "hello") return json({ error: "Missing or malformed hello" }, 400);
  return openDownlink(link, hello, req.signal);
}

function openDownlink(link: Link, hello: Hello, signal: AbortSignal): Response {
  // One link per host: the newest wins and the previous daemon exits.
  const previous = link.stream;
  link.stream = null;
  if (previous) {
    try {
      previous.enqueue(encoder.encode(encodeLine({ type: "replaced", seq: ++link.downSeq })));
      previous.close();
    } catch {
      // Already gone.
    }
  }
  // Every sequenced uplink message answers a downlink one, so a daemon that
  // has applied none (ack 0) has sent none: it is a fresh process whose
  // uplink numbering starts again at 1.
  if (hello.ack <= 0) link.up = new SeqWindow();
  // After a restart of this server the daemon is ahead: number above its ack.
  link.downSeq = Math.max(link.downSeq, hello.ack);
  link.outbox.ack(hello.ack);

  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      if (link.stream === controller) link.stream = null;
    },
  });
  signal.addEventListener("abort", () => {
    if (link.stream === controller) endStream(link);
  }, { once: true });
  link.stream = controller;
  link.nonce = randomUUID();
  link.hostVersion = LINK_PROTOCOL_VERSION;
  enqueue(link, encodeLine({ type: "welcome", v: LINK_PROTOCOL_VERSION, hostId: link.id, nonce: link.nonce }));
  // Resend what the daemon has not applied, in order, before anything new.
  for (const { line } of link.outbox.pending()) enqueue(link, line);

  link.ompVersion = hello.ompVersion;
  link.platform = hello.platform;
  sawDaemon(link);
  persistLastSeen(link);
  clearInterval(link.pingTimer);
  link.pingTimer = setInterval(() => enqueue(link, encodeLine({ type: "ping" })), linkTimings.pingMs);
  link.pingTimer.unref?.();
  setStatus(link, hello.ompVersion === null ? "omp-missing" : "online");
  notify(hub().helloListeners, link.id, hello.channels);
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson",
      // no-transform keeps Next's compression from buffering the stream.
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

/** POST /api/hosts/link: a batch of uplink NDJSON messages. */
export async function handleLinkPost(req: Request): Promise<Response> {
  const record = authenticate(req);
  if (record instanceof Response) return record;
  // A replaced link's late POST must not reach the current daemon's uplink window.
  const link = currentLink(req, record);
  if (!link) return staleLink();
  const nonce = link.nonce;
  const ack = req.headers.get(LINK_ACK_HEADER);
  if (ack === null || !/^\d+$/.test(ack)) return json({ error: "Missing ack" }, 400);
  let messages: UpMessage[];
  try {
    const bytes = await readBodyWithinLimit(req, LINK_LIMITS.uplinkBytes);
    // Decode the whole batch first: a batch cut mid-line applies nothing.
    messages = new TextDecoder("utf-8", { fatal: true }).decode(bytes).split("\n").filter(Boolean).map((line) => decodeUp(line));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return json({ error: "Uplink batch too large" }, 413);
    return json({ error: "Malformed uplink batch" }, 400);
  }
  // Replaced while the body was arriving.
  if (link.nonce !== nonce) return staleLink();
  sawDaemon(link);
  link.outbox.ack(Number(ack));
  for (const message of messages) applyUp(link, message);
  return json({ ack: link.up.acked });
}

function applyUp(link: Link, message: UpMessage): void {
  if (message.type === "ping") return enqueue(link, encodeLine({ type: "pong" }));
  if (message.type === "pong" || message.type === "hello") return;
  // Already applied before a resend.
  if (!link.up.applied(message.seq)) return;
  switch (message.type) {
    case "stdout":
      return link.channels.get(message.ch)?.deliverLine(message.line);
    case "stderr":
      return link.channels.get(message.ch)?.deliverStderr(message.chunk);
    case "resync":
      return link.channels.get(message.ch)?.deliverResync();
    case "exit": {
      const transport = link.channels.get(message.ch);
      link.channels.delete(message.ch);
      return transport?.deliverExit(message.code, message.signal as NodeJS.Signals | null);
    }
    case "res":
      return settle(link, message);
  }
}

function settle(link: Link, message: Res): void {
  const pending = link.pending.get(message.id);
  // Timed out, or an id this server never issued.
  if (!pending) return;
  link.pending.delete(message.id);
  clearTimeout(pending.timer);
  const label = labelOf(link.id);
  if (!message.ok) {
    const { status, code, message: text } = message.error;
    pending.reject(new HostOpError(isStatus(status) ? status : 502, code, `${label}: ${text}`));
    return;
  }
  if (!message.blob) return pending.resolve(message.result);
  const blob = pending.blob;
  if (!blob || blob.byteLength !== message.blob.bytes) {
    return pending.reject(new HostOpError(502, "host_blob_missing", `${label} did not deliver the ${pending.op} result`));
  }
  if (pending.op === "readMedia") return pending.resolve({ ok: true, value: blob });
  try {
    pending.resolve(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(blob)));
  } catch {
    pending.reject(new HostOpError(502, "host_bad_result", `${label} sent an unreadable ${pending.op} result`));
  }
}

/** POST /api/hosts/link/blob/<reqId>: the bytes of one large op result, sent before its `res`. */
export async function handleLinkBlob(req: Request, reqId: string): Promise<Response> {
  const record = authenticate(req);
  if (record instanceof Response) return record;
  const link = currentLink(req, record);
  if (!link) return staleLink();
  const nonce = link.nonce;
  const pending = link.pending.get(reqId);
  if (!pending) return json({ error: "Unknown request" }, 404);
  // Not 409: the daemon reads a 409 as "link replaced" and retries on the next link.
  if (pending.blob) return json({ error: "Result already uploaded" }, 400);
  let blob: Uint8Array<ArrayBuffer>;
  try {
    blob = await readBodyWithinLimit(req, LINK_LIMITS.blobBytes);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return json({ error: "Result too large" }, 413);
    return json({ error: "Malformed result upload" }, 400);
  }
  if (link.nonce !== nonce) return staleLink();
  pending.blob = blob;
  return json({ ok: true });
}

function request(hostId: string, op: HostOpName, args: Record<string, unknown>): Promise<unknown> {
  const link = linkFor(hostId);
  const label = labelOf(hostId);
  if (!link.nonce || link.status === "offline" || link.status === "needs-upgrade") {
    return Promise.reject(new HostOpError(503, "host_offline", `${label} is offline`));
  }
  const { promise, resolve, reject } = Promise.withResolvers<unknown>();
  const id = randomUUID();
  const timer = setTimeout(() => {
    link.pending.delete(id);
    reject(new HostOpError(504, "host_timeout", `${label} did not answer ${op} in time`));
  }, linkTimings.opTimeoutMs);
  link.pending.set(id, { op, resolve, reject, timer, blob: null });
  try {
    sendDown(link, { type: "req", id, op, args });
  } catch (error) {
    clearTimeout(timer);
    link.pending.delete(id);
    reject(error instanceof LinkLimitError ? new HostOpError(413, "host_request_too_large", `The request is too large for ${label}`) : error);
  }
  return promise;
}

/** Shape check for daemon results: lists are arrays, every other op an OpResult. */
function validResult(op: keyof SessionOps, result: unknown): boolean {
  if (op === "listSessions" || op === "listProjects") return Array.isArray(result);
  if (!isRecord(result)) return false;
  if (result.ok === false) return isStatus(result.status) && typeof result.code === "string" && typeof result.error === "string";
  // Media bytes only ever arrive through the blob leg.
  return result.ok === true && "value" in result && (op !== "readMedia" || result.value instanceof Uint8Array);
}

const MEDIA_HASH_RE = /^[0-9a-f]{64}$/;

function remoteSessionOps(hostId: string): SessionOps {
  const ops: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const [op, params] of Object.entries(SESSION_OP_PARAMS) as [keyof SessionOps, readonly string[]][]) {
    ops[op] = async (...args) => {
      if (op === "readMedia" && !MEDIA_HASH_RE.test(String(args[0]))) {
        return { ok: false, status: 400, code: "invalid_hash", error: "Invalid media hash" };
      }
      const result = await request(hostId, op, Object.fromEntries(params.map((name, i) => [name, args[i]])));
      if (validResult(op, result)) return result;
      throw new HostOpError(502, "host_bad_result", `${labelOf(hostId)} sent an invalid ${op} result`);
    };
  }
  return ops as unknown as SessionOps;
}

/** An omp child on a linked host. Output that arrives before `RpcProcess`
 * subscribes is held for the first listener, as the local transport does. */
export class RemoteRpcTransport implements RpcTransport {
  readonly hostId: string;
  readonly ch: string;
  private readonly lineListeners: Array<(line: string) => void> = [];
  private readonly stderrListeners: Array<(chunk: string) => void> = [];
  private readonly exitListeners: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];
  private readonly resyncListeners: Array<() => void> = [];
  private readonly pendingLines: string[] = [];
  private readonly pendingStderr: string[] = [];
  private exitInfo: [number | null, NodeJS.Signals | null] | null = null;

  constructor(hostId: string, ch: string) {
    this.hostId = hostId;
    this.ch = ch;
  }

  write(line: string, callback: (error?: Error | null) => void): void {
    if (this.exitInfo) return callback(new Error("RPC process is not running"));
    try {
      // Kept in the link outbox until the daemon acks it, across reconnects.
      sendDown(linkFor(this.hostId), { type: "stdin", ch: this.ch, line });
      callback(null);
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  onLine(listener: (line: string) => void): void {
    this.lineListeners.push(listener);
    for (const line of this.pendingLines.splice(0)) listener(line);
  }

  onStderr(listener: (chunk: string) => void): void {
    this.stderrListeners.push(listener);
    for (const chunk of this.pendingStderr.splice(0)) listener(chunk);
  }

  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): void {
    this.exitListeners.push(listener);
    const info = this.exitInfo;
    if (info) queueMicrotask(() => listener(info[0], info[1]));
  }

  /** The host dropped buffered output for this child; the session must reconcile. */
  onResync(listener: () => void): void {
    this.resyncListeners.push(listener);
  }

  /** The link has no stdin EOF: closing input terminates the child. */
  endInput(): void {
    this.killTree(false);
  }

  killTree(force: boolean): void {
    if (this.exitInfo) return;
    sendDown(linkFor(this.hostId), { type: "kill", ch: this.ch, force });
  }

  deliverLine(line: string): void {
    if (this.lineListeners.length === 0) this.pendingLines.push(line);
    notify(this.lineListeners, line);
  }

  deliverStderr(chunk: string): void {
    if (this.stderrListeners.length === 0) this.pendingStderr.push(chunk);
    notify(this.stderrListeners, chunk);
  }

  deliverResync(): void {
    notify(this.resyncListeners);
  }

  deliverExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.exitInfo) return;
    this.exitInfo = [code, signal];
    notify(this.exitListeners, code, signal);
  }
}

function isSpawnResult(value: unknown): value is { cwd: string; fellBack: boolean; launchAdvisor: boolean; autoApproveExtension: boolean } {
  return isRecord(value)
    && typeof value.cwd === "string"
    && typeof value.fellBack === "boolean"
    && typeof value.launchAdvisor === "boolean"
    && typeof value.autoApproveExtension === "boolean";
}

/** A linked machine: the `Host` calls go over its link. */
export class RemoteHost implements Host {
  readonly id: string;
  readonly sessionOps: SessionOps;

  constructor(id: string) {
    this.id = id;
    this.sessionOps = remoteSessionOps(id);
  }

  get label(): string {
    return labelOf(this.id);
  }

  status(): HostStatus {
    return linkFor(this.id).status;
  }

  onStatus(listener: (status: HostStatus) => void): () => void {
    const listeners = linkFor(this.id).statusListeners;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  async spawnRpc(spawnRequest: SpawnRequest): Promise<SpawnResult> {
    const link = linkFor(this.id);
    if (link.status === "omp-missing") throw new HostOpError(503, "host_omp_missing", `omp is not installed on ${this.label}`);
    const ch = randomUUID();
    const transport = new RemoteRpcTransport(this.id, ch);
    // Registered first: the child's output can overtake the spawn result.
    link.channels.set(ch, transport);
    try {
      const result = await request(this.id, "spawn", { ch, ...spawnRequest });
      if (!isSpawnResult(result)) throw new HostOpError(502, "host_bad_result", `${this.label} sent an invalid spawn result`);
      link.autoApprove = result.autoApproveExtension;
      return { transport, cwd: result.cwd, fellBack: result.fellBack, launchAdvisor: result.launchAdvisor };
    } catch (error) {
      link.channels.delete(ch);
      // The daemon may have started it after we gave up: never leave it unread.
      transport.killTree(true);
      throw error;
    }
  }

  async sessionFileExists(path: string): Promise<boolean> {
    const exists = await request(this.id, "sessionFileExists", { path });
    if (typeof exists !== "boolean") throw new HostOpError(502, "host_bad_result", `${this.label} sent an invalid sessionFileExists result`);
    return exists;
  }

  invalidateSessionLists(sessionFile?: string): void {
    // Best effort, like the local cache drop.
    request(this.id, "invalidateSessionLists", { path: sessionFile }).catch(() => {});
  }

  autoApproveExtension(): boolean {
    return linkFor(this.id).autoApprove;
  }
}

/** "local" is this machine; other ids must be registered hosts. */
export function getHost(id: string): Host | null {
  if (id === localHost.id) return localHost;
  return loadHosts().some((h) => h.id === id) ? linkFor(id).host : null;
}

export function listHosts(): {
  id: string;
  label: string;
  status: HostStatus;
  ompVersion: string | null;
  platform: string | null;
  lastSeenAt: string | null;
  /** Link protocol version the daemon last presented; null before it ever dialed. */
  hostVersion: number | null;
  serverVersion: number;
}[] {
  return loadHosts().map((record) => {
    const link = hub().links.get(record.id);
    return {
      id: record.id,
      label: record.label,
      status: link?.status ?? "offline",
      ompVersion: link?.ompVersion ?? null,
      platform: link?.platform ?? null,
      lastSeenAt: link?.lastSeenAt ?? record.lastSeenAt,
      hostVersion: link?.hostVersion ?? null,
      serverVersion: LINK_PROTOCOL_VERSION,
    };
  });
}

export function onHostsChange(listener: () => void): () => void {
  const listeners = hub().changeListeners;
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Fires on every accepted hello with the omp children the daemon still runs. */
export function onHostHello(listener: (hostId: string, channels: HelloChannel[]) => void): () => void {
  const listeners = hub().helloListeners;
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** End a host's link now (revoke). Its daemon gets 401 when it redials and stops its children. */
export function closeHostLink(id: string): void {
  const link = hub().links.get(id);
  if (!link) return;
  hub().links.delete(id);
  stopTimers(link);
  endStream(link);
  for (const pending of link.pending.values()) {
    clearTimeout(pending.timer);
    pending.reject(new HostOpError(503, "host_offline", "The host link was closed"));
  }
  // Nothing will report these children again.
  for (const transport of link.channels.values()) transport.deliverExit(null, null);
  setStatus(link, "offline");
}

// Linked-host registry for the main omp-web server. Pure Node: no Next or `@/` imports.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "../omp/paths";

export interface HostRecord {
  id: string;
  label: string;
  tokenHash: string;
  createdAt: string;
  lastSeenAt: string | null;
  allowAgentStart: boolean;
}

interface HostsFile {
  hosts: HostRecord[];
}

function normalizeLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) throw new Error("Host label is required");
  return trimmed;
}

const sha256Hex = (token: string): string => createHash("sha256").update(token).digest("hex");

export function loadHosts(): HostRecord[] {
  const file = join(getAgentDir(), "omp-web", "hosts.json");
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<HostsFile>;
    return Array.isArray(parsed.hosts) ? parsed.hosts : [];
  } catch {
    return [];
  }
}

function saveHosts(hosts: HostRecord[]): void {
  const file = join(getAgentDir(), "omp-web", "hosts.json");
  mkdirSync(dirname(file), { recursive: true });
  // Atomic write, owner-only: the file holds token hashes for every linked host.
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify({ hosts } satisfies HostsFile, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, file);
  } finally {
    // Best-effort cleanup if the rename never happened.
    if (existsSync(temp)) rmSync(temp, { force: true });
  }
}

/** Register a host. The returned token is the only copy: the registry keeps its sha256. */
export function createHost(label: string): { host: HostRecord; token: string } {
  const token = randomBytes(32).toString("base64url");
  const host: HostRecord = {
    id: randomUUID(),
    label: normalizeLabel(label),
    tokenHash: sha256Hex(token),
    createdAt: new Date().toISOString(),
    lastSeenAt: null,
    allowAgentStart: false,
  };
  saveHosts([...loadHosts(), host]);
  return { host, token };
}

export function updateHost(id: string, updates: { label?: string; allowAgentStart?: boolean }): HostRecord {
  const hosts = loadHosts();
  const host = hosts.find((h) => h.id === id);
  if (!host) throw new Error("Unknown host");
  if (updates.label !== undefined) host.label = normalizeLabel(updates.label);
  if (updates.allowAgentStart !== undefined) host.allowAgentStart = updates.allowAgentStart;
  saveHosts(hosts);
  return host;
}

export function revokeHost(id: string): boolean {
  const hosts = loadHosts();
  const remaining = hosts.filter((h) => h.id !== id);
  if (remaining.length === hosts.length) return false;
  saveHosts(remaining);
  return true;
}

/** Constant-time comparison of the presented token's sha256 against every record. */
export function hostForToken(token: string): HostRecord | null {
  const digest = Buffer.from(sha256Hex(token));
  for (const host of loadHosts()) {
    const stored = Buffer.from(host.tokenHash);
    if (stored.length === digest.length && timingSafeEqual(stored, digest)) return host;
  }
  return null;
}

export function touchHost(id: string, at: string): void {
  const hosts = loadHosts();
  const host = hosts.find((h) => h.id === id);
  if (!host) return;
  host.lastSeenAt = at;
  saveHosts(hosts);
}

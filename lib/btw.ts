// Side questions (omp's `/btw`) over RPC: record shapes and the pure state
// transitions applied to `btw_record`/`btw_delta` frames, `btw` responses and
// `get_btw_history` snapshots. These can arrive in any order relative to each
// other (SSE vs. HTTP), so a snapshot never rolls back what is already shown.

import { isRecord } from "./type-guards";

export type BtwStatus = "running" | "complete" | "cancelled" | "error" | "interrupted";

export interface BtwTurn {
  question: string;
  answer: string;
  status: BtwStatus;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

export interface BtwRecord extends BtwTurn {
  id: string;
  leafId: string | null;
  followUps?: BtwTurn[];
}

export function btwTurns(record: BtwRecord): BtwTurn[] {
  return [record, ...(record.followUps ?? [])];
}

export function latestBtwTurn(record: BtwRecord): BtwTurn {
  return record.followUps?.at(-1) ?? record;
}

export function isBtwRecord(value: unknown): value is BtwRecord {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.question === "string"
    && typeof value.answer === "string"
    && typeof value.status === "string"
    && (value.followUps === undefined || Array.isArray(value.followUps));
}

/** `incoming` is older than `current`: it misses a turn, reports a finished
 * turn as running, or lacks text that deltas already appended. */
function isStaleSnapshot(current: BtwRecord, incoming: BtwRecord): boolean {
  const have = current.followUps?.length ?? 0;
  const got = incoming.followUps?.length ?? 0;
  if (got !== have) return got < have;
  const mine = latestBtwTurn(current);
  const theirs = latestBtwTurn(incoming);
  if (theirs.status !== "running") return false;
  if (mine.status !== "running") return true;
  return mine.answer.length > theirs.answer.length && mine.answer.startsWith(theirs.answer);
}

/** Insert (newest first) or replace a record unless the snapshot is stale. */
export function upsertBtwRecord(records: BtwRecord[], incoming: BtwRecord): BtwRecord[] {
  const index = records.findIndex((record) => record.id === incoming.id);
  if (index === -1) return [incoming, ...records];
  if (isStaleSnapshot(records[index], incoming)) return records;
  const next = records.slice();
  next[index] = incoming;
  return next;
}

/** Append streamed text to the latest turn of a running record. */
export function appendBtwDelta(records: BtwRecord[], recordId: string, delta: string): BtwRecord[] {
  const index = records.findIndex((record) => record.id === recordId);
  if (index === -1 || !delta) return records;
  const record = records[index];
  const latest = latestBtwTurn(record);
  if (latest.status !== "running") return records;
  const answer = latest.answer + delta;
  const next = records.slice();
  next[index] = record.followUps?.length
    ? { ...record, followUps: [...record.followUps.slice(0, -1), { ...latest, answer }] }
    : { ...record, answer };
  return next;
}

/** Apply one SSE frame; unrelated or malformed frames leave `records` as is. */
export function applyBtwEvent(records: BtwRecord[], event: { type: string; [key: string]: unknown }): BtwRecord[] {
  if (event.type === "btw_record") {
    return isBtwRecord(event.record) ? upsertBtwRecord(records, event.record) : records;
  }
  if (event.type === "btw_delta" && typeof event.recordId === "string" && typeof event.delta === "string") {
    return appendBtwDelta(records, event.recordId, event.delta);
  }
  return records;
}

/** Replace local state with a history snapshot, keeping records the snapshot
 * predates (started after it was taken, or with newer streamed text). */
export function mergeBtwHistory(local: BtwRecord[], snapshot: BtwRecord[]): BtwRecord[] {
  const localById = new Map(local.map((record) => [record.id, record]));
  const snapshotIds = new Set(snapshot.map((record) => record.id));
  const merged = snapshot.map((record) => {
    const mine = localById.get(record.id);
    return mine && isStaleSnapshot(mine, record) ? mine : record;
  });
  return [...local.filter((record) => !snapshotIds.has(record.id)), ...merged];
}

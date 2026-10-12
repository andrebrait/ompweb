# Persistent notifications: SQLite store and server-side history

## Goal

Notification state survives page reloads and server restarts, and is shared by
every device and every omp-web instance that uses the same agent directory:

- the Notifications tab history and each entry's read state, which today live
  only in the memory of one browser tab;
- the device list and VAPID key pair, which today live in a JSON file that two
  instances can overwrite concurrently (the documented lost-update race in
  `lib/notification-hub.ts`).

Users keep configuring one thing: omp-web's data directory
(`<agent dir>/omp-web/`, moved with `PI_CODING_AGENT_DIR`). How notification
data is stored inside it is an implementation detail; user-facing docs say
"omp-web's data directory" and never name the file.

## Prerequisite

The minimum Node.js version becomes 24 (current LTS) in a separate, earlier PR:
`engines.node` `>=24`, `.nvmrc` `24`, and the Node version in `CONTRIBUTING.md`
and `DESIGN.md`. This spec relies on the built-in `node:sqlite` module
(`DatabaseSync`), which Node 24 ships unflagged; no new dependency is added.
Lifting the jsdom 29.x pin that exists for the Node 22.19 baseline is out of
scope.

## Storage (`lib/notification-store.ts`)

The only module that touches the database. It is imported from server code
only, so `node:sqlite` never reaches a client bundle.

- One SQLite database in omp-web's data directory, created with mode 0600 (it
  holds the VAPID private key). Opened once per process and cached on
  `globalThis` keyed by its path (survives Next.js hot reload; a changed
  `PI_CODING_AGENT_DIR` opens the new location), with `journal_mode=WAL` and
  `busy_timeout=5000` so instances sharing the directory serialize writes
  instead of failing.
- Tables:
  - `vapid(public_key, private_key)`: at most one row; generated on first use
    inside a write transaction, so two instances cannot generate different
    keys.
  - `devices(device_id PRIMARY KEY, prefs, subscription, updated_at)`: `prefs`
    and `subscription` are JSON text, validated on read with the existing
    `parseNotificationPrefs` and `parsePushSubscription`; invalid rows are
    skipped. Saving a device keeps the current rules in one transaction: a
    push endpoint belongs to one device (saving it removes it from any other),
    and over 50 devices the ones that are neither enabled nor subscribed are
    dropped first, then the oldest.
  - `history(id PRIMARY KEY, event, at, read)`: `id` is the notification tag
    (`<sessionId>:<type>`), `event` the `NotificationEvent` as JSON, `at`
    epoch milliseconds, `read` 0 or 1.
- History rules, matching today's in-memory behavior:
  - Recording an event upserts its row with `read = 0` and `at = now`: a
    reused tag replaces its entry and makes it unread again.
  - After each insert, only the newest 100 rows are kept.
  - Mark read (some ids, or all), remove one, clear all.
- `lib/notification-hub.ts` replaces `loadStore`/`saveStore` with these
  functions; its exported API (`getVapidPublicKey`, `getNotificationDevice`,
  `saveNotificationDevice`, ...) keeps its signatures. Presence and SSE streams
  stay in memory: they describe live tabs and expire by design.

### Migration from the JSON file

On first open, inside one immediate transaction: if the `vapid` and `devices`
tables are empty and the old `notifications.json` exists in the data
directory, import its VAPID keys and valid devices with the existing JSON
parsing rules. After the commit, delete the JSON file (a missing file is not an
error, so two instances migrating at once are harmless). Keeping the VAPID keys
is required: new keys would invalidate every existing push subscription. An
unreadable JSON file is left in place and logged; omp-web then starts with
fresh keys, as it does today for a corrupt file.

## Recording

`publishNotification(event)` records the event in `history` before routing it,
whether or not any tab or push receives it. Notifications sent while no tab was
open therefore appear in the Notifications tab later. A failed history write is
logged and does not block delivery.

## HTTP API (`app/api/notifications/history/route.ts`)

Behind the same authentication as every other `/api` route (`proxy.ts`).

- `GET` returns `{ entries: [{ id, event, at, read }] }`, newest first.
- `PATCH` with `{ ids: string[] }` or `{ all: true }` marks entries read.
- `DELETE` with `{ id }` removes one entry; with no body it clears the history.

Ids are strings of at most 256 characters, at most 100 per request, and the
request body is size-bounded; anything else returns 400. Unknown ids are
ignored. All queries use bound parameters.

## Client (`components/ui/toast.tsx`, `hooks/useNotifications.ts`)

Session notifications are the only producer of history (`history: true` toasts
and `toastHistory.record` calls in `useNotifications`), so the whole history
becomes server-backed.

- `toastHistory` keeps its interface (`subscribe`, `get`, `record`,
  `markRead`, `markAllRead`, `remove`, `clear`) and becomes a local mirror of
  the server list.
- Entries hold the `NotificationEvent` and are rendered with
  `renderNotification` in the viewer's locale when displayed; clicking an entry
  opens `event.sessionId`. The mirror stores no React nodes or closures from
  other devices.
- The mirror loads from `GET` on mount and on `visibilitychange` to visible,
  which is how read marks and removals made on another device arrive.
- Events arriving over the notification SSE stream, and pushes the service
  worker reports while the tab is open, are inserted locally without a refetch
  (the server has already recorded them).
- Mark read, remove, and clear update the mirror at once and then send the
  request. A failed request triggers a reload from the server, so the mirror
  never stays out of sync.
- Toasts without `history: true` are unchanged and never stored.

## Removed or replaced

- `notifications.json` and the JSON load/save code in `notification-hub.ts`,
  including the lost-update comment.
- The in-memory-only history in `toast.tsx`.

## Docs

- `AGENTS.md`: the notification storage paragraph and file map
  (`lib/notification-store.ts`, `app/api/notifications/history`); the
  NotificationCenter description says the history is persisted.
- `README.md`: describe the device list and history as stored in omp-web's
  data directory, without naming the file.
- `docs/specs/2026-10-06-notifications-design.md`: point its storage section to
  this spec.
- `CHANGELOG.md`: one entry.

## Testing

Follow the existing `node --test` patterns (`lib/notification-hub.test.mjs`,
temp `PI_CODING_AGENT_DIR`).

- Store: device save/replace, endpoint uniqueness, the 50-device cap and its
  eviction order; history upsert making an entry unread again, the 100-row
  trim, mark read (ids and all), remove, clear.
- Migration: keys and devices imported from a JSON file and the file deleted;
  an existing database is not overwritten by a leftover JSON file; a corrupt
  JSON file is left in place.
- Persistence: a second store instance opened on the same directory sees the
  first one's writes (stands in for a restart and for a second omp-web).
- Route: `GET`/`PATCH`/`DELETE` behavior and 400 on invalid ids.
- Existing tests that write `notifications.json` directly
  (`notification-hub.test.mjs`, `rpc-manager.test.mjs`) move to the store API.

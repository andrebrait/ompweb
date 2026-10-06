# Notifications: Web Push, in-page fallback, and settings

Status: approved design, 2026-10-06.

## Goal

omp-web notifies the user about session events on desktop browsers and on the
installed PWA (Android, and iOS 16.4+ when added to the Home Screen). A new
Notifications tab in Settings lets each device choose which events notify and
how. Tapping a notification opens the session that produced it. No
notification is shown for a session the user is currently viewing.

## Notification types

| Type | Trigger frame (rpc-ui) | Title | Body |
|---|---|---|---|
| `completed` | `prompt_result` with `status: "completed"` and `agentInvoked: true` | session name | "Task finished" |
| `input` | new `extension_ui_request` whose `method` is in `PENDING_UI_METHODS` (`select`, `confirm`, `input`, `editor`, `ask`, `open_url`) and that omp-web does not auto-answer | session name | "Waiting for your answer: <title or first question>" |
| `error` | `prompt_result` with `status: "error"`, or omp child exit while the session was running | session name | "Run failed: <error.message>" |
| `modelSwitch` | `retry_fallback_applied {from, to, reason?}`, or `notice` with `source` `prewalk` or `plan-yolo` | session name | "Switched <from> → <to>: <reason>" |

Rules:

- Subagent activity never notifies. Subagent frames arrive as
  `subagent_lifecycle` / `subagent_progress` / `subagent_event`; the detector
  only inspects top-level frame types and never recurses into
  `subagent_event.payload`.
- `prompt_result` with `status: "aborted"` never notifies.
- `auto_retry_start` and `auto_retry_end {success: true}` never notify.
- The `modelSwitch` reason comes from `retry_fallback_applied.reason` when
  present (usage-aware fallback). Otherwise it is the `errorMessage` of the
  most recent `auto_retry_start` in the same session, which covers classifier
  refusals (for example Fable refusing and falling back to Opus) and
  rate-limit or provider failures. With neither, the body omits the reason.
- A notification closes itself when it no longer applies only where cheap:
  an `input` notification uses tag `<sessionId>:input`, and the in-app toast
  for it is dismissed when the request is answered or cancelled. OS
  notifications are not retracted.

## Architecture

```
omp child ──frames──▶ AgentSessionWrapper.handleFrame (lib/rpc-manager.ts)
                          │
                          ▼
                 lib/notifications/detect.ts   (frame → NotificationEvent | null)
                          │
                          ▼
                 lib/notifications/hub.ts      (presence-aware routing)
                    │              │                    │
          in-app toast SSE    in-page OS SSE       Web Push (web-push)
                    └──────┬───────┘                    │
                           ▼                            ▼
        /api/notifications/events (per client)    public/sw.js
```

Detection and routing run on the server, so sessions that are not open in any
tab still notify.

### `NotificationEvent`

```ts
interface NotificationEvent {
  type: "completed" | "input" | "error" | "modelSwitch";
  sessionId: string;
  title: string;
  body: string;
  url: string; // "/?session=<encoded id>"
  tag: string; // "<sessionId>:<type>"
}
```

### Detection (`lib/notifications/detect.ts`)

A pure function `detectNotification(frame, state)` returns a
`NotificationEvent` or `null`. `state` holds per-session memory the detector
needs (last `auto_retry_start.errorMessage`, session display name). The
wrapper calls it from `handleFrame` after its own state updates, and also from
`handleProcessExit` when a running session's child dies. Auto-answered tool
approval requests (`tools.approval.extension === "allow"`) do not produce an
`input` event.

### Presence (`lib/notifications/presence.ts`)

Each tab generates a `clientId` (stored in `sessionStorage`) and keeps one
`EventSource` to `/api/notifications/events?clientId=<id>`. It reports
presence with `POST /api/notifications/presence`:

```ts
{ clientId: string; visible: boolean; focused: boolean; sessionId: string | null }
```

The tab sends it on `visibilitychange`, `focus`, `blur`, session switch, and
every 30 seconds while visible. The server drops an entry 60 seconds after the
last report and also when the client's SSE stream closes. "Active" means
`visible === true`.

### Routing (`lib/notifications/hub.ts`)

For each event, per device preferences decide whether the type is enabled at
all; then:

1. If any active client is viewing `event.sessionId`, drop the event. This
   rule holds in every mode.
2. If any client is active and that client's device has
   `whenActive: "toast"`, send `{kind: "toast", event}` over that client's SSE
   stream. Only active clients receive toasts.
3. Otherwise deliver an OS notification:
   - to every push subscription whose preferences enable the type, via Web
     Push;
   - over SSE as `{kind: "os", event}` to every connected client of a device
     with no push subscription. The client shows it with
     `registration.showNotification`.

With `whenActive: "system"`, rule 2 is skipped for that device and it
receives the OS notification even while the user is active in another tab.
Rule 1 still applies.

A device is identified by a `deviceId` in `localStorage`, sent with presence
reports and with the push subscription. Several tabs of the same browser share
one device.

The server decides before pushing. A push is only sent when it must display,
because iOS Safari revokes push permission for pushes that show nothing.

### Web Push (`lib/notifications/push.ts`)

- Dependency: `web-push`.
- VAPID keys are generated on first use and stored at
  `~/.omp/agent/omp-web/vapid.json` with mode `0600`. The subject is
  `mailto:omp-web@localhost` unless `OMP_WEB_VAPID_SUBJECT` is set.
- Subscriptions are stored at `~/.omp/agent/omp-web/push-subscriptions.json`
  as `{deviceId, subscription, prefs, updatedAt}[]`. Writes are atomic
  (temp file + rename), matching `lib/project-registry.ts`.
- A send that fails with HTTP 404 or 410 deletes that subscription. Other
  failures are logged and ignored.
- Payload: the `NotificationEvent` JSON. Urgency `high` for `input` and
  `error`, `normal` otherwise. TTL 1 hour.

### Service worker (`public/sw.js`)

- Registered from the client at `/sw.js` with scope `/`. Served same-origin,
  which the current CSP allows. `proxy.ts` must let `/sw.js` through without
  the auth cookie, like the manifest and icons.
- `push`: `self.registration.showNotification(title, {body, icon:
  "/icon-192.png", badge: "/badge-96.png", tag, renotify: true, data: {url}})`.
- `notificationclick`: close the notification. Focus an existing window
  client of the app and `navigate` it to `data.url`; if none exists,
  `clients.openWindow(data.url)`.
- In-page `{kind: "os"}` events use the same `showNotification` call, so the
  look and the click behaviour match push notifications.

`/badge-96.png` is a new monochrome icon, required for Android's status bar.

### HTTP API

| Route | Method | Purpose |
|---|---|---|
| `/api/notifications/events` | GET | SSE stream of `{kind: "toast" \| "os", event}` for one client |
| `/api/notifications/presence` | POST | presence report |
| `/api/notifications/subscription` | GET | VAPID public key and this device's stored prefs |
| `/api/notifications/subscription` | PUT | store or update `{deviceId, subscription?, prefs}` |
| `/api/notifications/subscription` | DELETE | remove this device's subscription |
| `/api/notifications/test` | POST | send a test notification to this device through its configured path |

All routes sit behind the existing password gate.

## Settings: Notifications tab

A new `SettingsTabs` category `notifications` (icon `Bell` from
`lucide-react`). Contents:

- **Enable notifications** (master switch). Turning it on requests
  permission, registers the service worker, and subscribes to push when
  `PushManager` exists and the page is a secure context.
- **Status line**, one of:
  - "Push notifications active"
  - "In-page only: push needs HTTPS"
  - "In-page only: this browser does not support push"
  - "Blocked by the browser"
  - "On iPhone, add omp-web to the Home Screen first"
- **Toggles**, one per type: Task finished (on), Waiting for input (on),
  Run failed (on), Model switched automatically (off).
- **When I'm using omp-web in another tab**: "Show an in-app toast" (default)
  or "Always send a system notification".
- **Send test notification** button.

Preferences are per device:

```ts
interface NotificationPrefs {
  enabled: boolean;
  types: Record<"completed" | "input" | "error" | "modelSwitch", boolean>;
  whenActive: "toast" | "system";
}
```

They are kept in `localStorage` and sent to the server with every
subscription `PUT`, so the server can filter pushes when no tab is open.

All new strings go through `lib/i18n` with English fallbacks, like the other
settings rows.

## In-app toast

`{kind: "toast"}` events show through the existing `toast` helper with an
"Open" action that selects the session, like a notification click.

## Removed or replaced

- `handleAgentEnd`'s notification block in `components/AppShell.tsx` and
  `lib/browser-notifications.ts` (with its test) are removed; the new
  pipeline covers completion.
- The `notify` host tool in `hooks/useAgentSession-stream.ts` switches from
  `new Notification` to `registration.showNotification`, falling back to
  `new Notification` only when no service worker registration exists. Chrome
  on Android throws on `new Notification`.

## Platform notes

- Desktop: Web Push notifications appear as native OS notifications
  (Windows notification center, macOS Notification Center, Linux
  notification daemon). Push delivery needs the browser process running; no
  tab needs to be open.
- Android: works in Chrome and the installed PWA.
- iOS/iPadOS 16.4+: push works only for the PWA added to the Home Screen.
- Push and service workers need a secure context: `localhost`, or HTTPS
  through the reverse proxy for any other host. Without it, the in-page path
  still works while a tab is open.
- The server needs outbound HTTPS to the browser push services.

## Testing

Unit tests (node test runner, existing `.test.mjs` conventions):

- `detect`: subagent frames ignored; `prompt_result` completed / aborted /
  error mapping; `agentInvoked: false` ignored; `input` from a pending UI
  request and not from an auto-answered approval; `modelSwitch` reason from
  `reason`, then from the last `auto_retry_start`, then omitted.
- `hub` routing: viewing the session drops the event in both modes; active
  elsewhere with `toast` sends a toast only to active clients; `system` mode
  sends an OS notification; nobody active sends push to subscribed devices
  and in-page OS events to unsubscribed ones; disabled type sends nothing.
- `push`: a 410 response removes the subscription.

Manual verification: desktop Chrome on `localhost` (push, toast, click opens
the session), Android PWA over HTTPS.

## Documentation

- `AGENTS.md`: a "Notifications" section under Key Design Decisions, and the
  new files in the File Map.
- `README.md`: notifications setup, HTTPS requirement, iOS Home Screen
  requirement.
- `CHANGELOG.md` entry.

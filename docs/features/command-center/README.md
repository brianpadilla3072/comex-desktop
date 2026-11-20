# Command center (`commandCenter`)

One screen, like the Codex app's task list, that shows everything in flight on this OpenWork
server: chat turns that are running or waiting for an approval or an answer, and specialist
scheduled tasks that are running or finished or failed in the last 24 hours. It works on the
desktop, on the web UI and on a phone (390 px), and updates live.

## Where it lives

A new route, `/command-center` ("Centro de control" / "Command center"), with an entry in the
sidebar (standard layout) and in the compact rail (Comex layout).

It is **not** an extension of `/activity`. That route is the Den member-access feed: models,
skills, plugins and connections an organization shares with the member, kept per Den scope in
`kernel/activity-store.ts`, and gated on the shell's `notifications` setting and a Den sign-in.
The command center is about local work in flight, needs no Den account, and has its own
actions. Mixing both would make one page mean two unrelated things and tie local work to cloud
state. It is also not the automations page: that page edits one application's tasks, while the
command center reads every application and workspace at once.

## Server

`apps/server/src/command-center.ts`:

- `GET /command-center/snapshot` (not `/command-center`, which is the app page: in the web app both share one origin) (`host` auth: the desktop's host token or a paired device's owner
  token, see `remote-device-pairing`). Returns a zod-validated snapshot:
  `{ enabled, generatedAt, engine, complete, items, problems, counts }`.
  - **Chats**: for every local workspace it asks the engine that chat runs on (v2 when engine v2
    routing is on, otherwise v1) through the server's own `/workspace/:id/opencode2/api` or
    `/workspace/:id/opencode` proxy, exactly like the scheduler and task recovery do, so session
    homes and directory scoping apply. v2: `/session/active`, then per running session
    `/permission` and `/form`. v1: `/session/status`, `/permission`, `/question`. Titles, models
    and times come from `/session/:id` (best effort; a missing title never hides running work).
    Sub-agent sessions are folded into their parent's row (`subtasks`).
  - **Scheduled tasks**: `listTasks` / `listRuns` of every specialist application. A running task
    claim becomes a row (and absorbs its conversation, so the same work is not listed twice; a
    pending question or approval on that conversation shows as `waiting`). Otherwise the last
    outcome within 24 hours (`ok`, `failed`, `blocked`, `skipped`) becomes a row with its error.
  - **Truthful failures**: a workspace whose engine does not answer, or a tasks store that cannot
    be read, is listed in `problems` and sets `complete: false`. It is never read as idle.
  - Nothing is stored: each call is a fresh observation.
- `POST /command-center/sessions/:workspaceId/:sessionId/stop` (`host`): v2
  `POST /session/:id/interrupt`, v1 `POST /session/:id/abort`. Answers `{ stopped }`; `false`
  means nothing was running anymore, and the UI says so instead of claiming it stopped.
- Retry and "run now" reuse the existing
  `POST /specialist-applications/:id/tasks/:taskId/run-now`; no parallel task logic.
- Flag off: both routes answer `404 command_center_disabled`, and `/comex/features` reports
  `commandCenter: false` so the app hides the entry.

## App

`apps/app/src/react-app/domains/command-center/`:

- `command-center-model.ts`: client copy of the contract (zod), status to section/tone/label
  mapping, the actions each row offers, and elapsed-time formatting.
- `use-command-center.ts`: TanStack Query on `/command-center/snapshot`, polled every 4 s while the page
  is open and on window focus. It does not keep a second copy of session state: it subscribes to
  the existing `useSessionActivityStore` (fed by the event stream) and re-reads the aggregate as
  soon as any session status or waiting request changes, so synced workspaces update at once and
  the rest within the poll interval.
- `command-center-page.tsx`: sections "Needs you", "Running", "Finished in the last 24 hours".
  Each row shows kind, title, status (text, not only color), workspace, application, model,
  elapsed time, sub-agents and the last error, with buttons to open the conversation, stop, retry
  or run now. Everything is native buttons with descriptive `aria-label`s, the summary line is an
  `aria-live` region, and rows stack their actions under the text on narrow screens.

States (DESIGN.md "States"): skeleton while loading; an error panel with "Try again" when the
first read fails (never the empty state); the last answer plus a warning with its time when a
later refresh fails; a warning listing each unreadable workspace when `complete` is false (the
empty message then says "nothing found in the places that answered"); and a true empty state
only for a complete answer with no items.

## Flag

`commandCenter` (self-hosted, on by default). Server reads it with `commandCenterEnabled()` in
`apps/server/src/comex/features.ts`; the app reads it from `/comex/features`. Off: the routes
answer 404, the sidebar entry disappears, and `/command-center` redirects home once the server
has answered (a slow or failed read never redirects).
While the read is pending (right after startup) the entry already shows and opens the page, which
shows its own loading state (`flaggedDestinationHandler` in `apps/app/src/react-app/shell/flagged-destination.ts`).

## Tests

- `apps/server/test/command-center.test.ts`: v2 and v1 aggregation (waiting first, sub-agents
  folded, model, application, timestamps), an unreadable workspace reported as a problem,
  scheduled runs (running task absorbs its conversation, recent failure keeps its error, old
  outcomes drop out), owner-only routes, the flag, and stop on each engine. Every environment
  location points into a scratch folder.
- `apps/app/tests/command-center.test.tsx`: status mapping, actions per row, rendering, actions
  calling `stopCommandCenterSession`, `runSpecialistTaskNow` and the open handler, and error vs
  empty vs incomplete states.

## Limits

- Only `local` workspaces are probed; remote workspaces belong to another server.
- On v2 the start time of a turn is shown only when the engine reports it; otherwise the row
  shows the conversation's last activity.
- Chat turns that already finished are not listed; the conversation itself keeps that history.

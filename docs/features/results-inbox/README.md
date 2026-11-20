# Results inbox (`resultsInbox`)

Feature: `resultsInbox`. Deployment: `self_hosted`. Author: `brianpadilla3072`. On by default.
Needs `specialistApplications` and `scheduledTasks` to have anything to show.

Scheduled specialist tasks often run at night. The inbox is the one place, like the Codex
app's automation inbox, where the person sees what came out: every finished run with its
outcome, what to look at (the conversation, the outputs it wrote, the isolated changes waiting
for review) and an explicit seen state that every device shares.

## How it relates to what already exists

- **Command center** (`commandCenter`) shows work *in flight* and outcomes from the last 24 hours,
  one row per task (its latest outcome). It stores nothing. The inbox is the history of
  *results*: one row per finished run, 30 days back, with a seen mark. Both read the same task
  run logs (`specialists/tasks.ts`); neither keeps a copy of them.
- **Task isolation review** (`taskIsolationReview`) owns the review. The inbox only reads each
  run's `isolationId` and the record status (`active` is "pending", anything else "reviewed",
  exactly like `GET …/tasks/:taskId/runs`) and opens the existing `TaskIsolationReviewDialog`.
- **Outputs and artifacts** (`studioOutputs`, `comexArtifacts`) are read with `listOutputs` /
  `listArtifacts` and opened read-only from the inbox.
- **Web notifications** still tell the person a run finished; the inbox is where they go next.

## Server

`apps/server/src/results-inbox.ts` (I/O) and `apps/server/src/results-inbox-core.ts` (pure
rules, pinned by `contracts/results-inbox/v1/vectors.json`). All routes are `host` (desktop
host token or a paired device's owner token), answer `404 results_inbox_disabled` when the flag
is off, and are zod-validated.

| Route | Purpose |
| --- | --- |
| `GET /results-inbox` | Snapshot `{ enabled, generatedAt, complete, items, problems, counts }` |
| `GET /results-inbox/summary` | `{ enabled, generatedAt, complete, counts }` for the badge (skips outputs) |
| `POST /results-inbox/seen` `{ ids, seen }` | Mark 1–200 results seen (`true`) or unread (`false`) |
| `POST /results-inbox/seen-all` `{ upTo? }` | Mark every result that ended at or before `upTo` seen |

- **Items.** Every run log entry whose status is `ok`, `failed`, `blocked`, `skipped_overlap` or
  `skipped_missed` (mapped to `skipped`) and that ended in the last 30 days, newest first, at most
  200. `dispatched` runs are still in flight and are not results. Each item carries application,
  task, project (workspace) names, mode, start, finish (`finishedAt`, null when not recorded),
  `endedAt` (finish, else start), the session to open, the error detail for non-ok outcomes,
  `isolation: { id, review }`, linked `outputs` and `seen`/`seenAt`.
- **Item id.** `run:<applicationId>:<taskId>:<runStartMs>`; only generated application and task
  ids match, so an id can never carry a path.
- **Finish time.** The run log gained `finishedAt` (`runSchema`, default `null`), written by
  `finishRun` when the scheduler observes the run end. Older entries keep `null`.
- **Output linking.** An output or artifact is linked to a run when it lives in the run's project
  and its `updatedAt` falls inside the run (`at` … `finishedAt`, or 15 minutes, the scheduler's
  timeout, when the finish is unknown). Blocked and skipped runs never ran, so they link nothing.
  This is a time match, not provenance: a chat writing in the same project at the same moment
  would also be linked. Outputs a run wrote inside an isolated copy only appear once accepted
  into the project. At most 10 per item.
- **Seen marks.** `<runtime>/specialists/results-inbox.json`, `{ version: 1, seen: [{ id, seenAt }] }`
  (`seenStoreSchema`), written atomically (temporary file and rename) through one in-process
  write queue, so marks from the phone and the desktop never overwrite each other. Retention:
  marks for runs older than 30 days are dropped on every read and write, and at most 2,000 marks
  are kept (newest first). Mark-all takes the snapshot's `generatedAt`, so a run that finished
  after the person looked stays unread.
- **Truthful failures.** An unreadable applications store, tasks file or project outputs index is
  listed in `problems` and sets `complete: false`. A damaged seen file is reported too (every
  result then shows unread, never "all read"); the next mark replaces it.

`/comex/features` reports `resultsInbox`.

## App

`apps/app/src/react-app/domains/results-inbox/`:

- `results-inbox-model.ts`: client copy of the contract (zod), filters (all / needs review /
  failed, where failed includes blocked), grouping by local day, status labels, the action each
  result offers first (pending review, then conversation, then output) and the badge text.
- `use-results-inbox.ts`: TanStack Query on `/results-inbox` (every 30 s while open and on focus)
  and `/results-inbox/summary` (every 60 s, for the badge). Seen changes update the cached list at
  once, roll back if the server refuses, and re-read both.
- `results-inbox-page.tsx`: route `/inbox`. Header with "Mark all as seen" and "Refresh"; filter
  chips with counts; days ("Today", "Yesterday", then the date); each row shows an unread dot
  (plus screen reader text), task, status badge, review badge, application · project · mode ·
  time, the error, the linked outputs and the actions "Review changes", "Open conversation" and
  "Mark as seen / unread". Clicking the title runs the first action. Opening anything marks the
  result seen. Outputs open in a read-only dialog (Markdown for reports, maps and documents).
- `results-inbox-badge.tsx`: the unread count next to the entry (`99+` cap). The entry's
  accessible name says the count ("Inbox, 3 unread").

Entry: in the sidebar next to the command center (standard layout) and in the compact rail
(Comex layout). Flag off: the entry disappears and `/inbox` redirects home once the server has
answered (a slow or failed read never redirects).

States (DESIGN.md "States"): skeleton while loading; an error panel with "Try again" when the
first read fails (never the empty state); the last answer plus a warning with its time when a
later refresh fails; a list of unreadable places when `complete` is false (the empty text then
says "no results in the places that answered"); "No results match this filter" for an empty
filter; and "No results yet" only for a complete, empty answer. At 390 px the actions stack
under the text and button labels collapse to icons with accessible names.

Design rules applied: P1 (state shown by badges and dot, not prose), P5 (reuses the review
dialog, output store and owner connection), P8 (seen is undoable per result), S1, S5, C1, V1,
I9 (quiet unseen markers).

## Tests

- `apps/server/test/results-inbox.test.ts`: contract vectors; seen mark cap; aggregation over real
  stores in a scratch folder (outcomes, ordering, in-flight and expired runs left out, output
  linking, isolation pending then reviewed, `finishedAt` recorded); seen persistence, undo,
  mark-all with `upTo`, concurrent marks, damaged file; unreadable tasks as a problem; routes
  (`host` auth, `no-store`, input validation, flag off on every route).
- `apps/app/tests/results-inbox.test.tsx`: model (filters, status, actions, badge, day groups),
  rendering, filters, opening a conversation / review / output marks seen, unread toggle,
  mark-all with the snapshot instant, rollback on a failed mark, error vs empty vs incomplete,
  badge and nav label, compact rail entry.

```sh
node --conditions=development --import ./apps/server/node_modules/tsx/dist/loader.mjs --import ./apps/server/test/setup/isolate-home.mjs --test apps/server/test/results-inbox.test.ts
cd apps/app && bun test tests/results-inbox.test.tsx
```

## Limits

- Results come from the task run logs, which keep the last 20 runs per task; a task that runs
  more often than that in 30 days shows only its last 20. Deleting a task deletes its results.
- Output linking is by time and project, as described above.
- Problem descriptions are translated in the app by source; the server's English `message` is
  for logs and other clients.

# Isolated task copies and review

Feature: `taskIsolationReview`. Deployment: `self_hosted`. Author: `brianpadilla3072`.
Off by default (`DEN_FEATURE_TASK_ISOLATION_REVIEW=true` turns it on), because it changes
where scheduled runs write. It also needs `specialistApplications`.

## What it does

A scheduled specialist task run, or a conversation the person moves on purpose, works in an
isolated copy of the project. Nothing reaches the project until the person reviews the changed
files and accepts or discards each one (Codex "worktree per task + review diff", adapted to
document projects that are not necessarily git repositories).

- **Copy.** A git repository root with a commit and no pending changes gets a detached git
  worktree of `HEAD` (reusing `createGitWorktree` from `comex/git.ts`). Any other folder gets a
  snapshot copy: regular files only, reflinked where the file system supports it
  (`COPYFILE_FICLONE`), plain copy elsewhere. Links are never copied or followed. Excluded:
  `.git`, `node_modules` (including `.opencode/node_modules`), caches (`.cache`, `__pycache__`,
  `.venv`, `.next`, …), OS clutter and OpenCode's own install bookkeeping in `.opencode/`.
  Limits: 20,000 files, 1 GiB in total, 256 MiB per file (413 `task_isolation_too_large`),
  20 active copies per application.
- **Change set.** Each file is compared with the base manifest taken when the copy was made
  (sha256 and size) and with the project as it is now: added, modified or deleted; text
  (UTF-8, no NUL, up to 512 KB) gets a line diff, anything else shows size and type. A file
  conflicts when the project moved away from the base and does not already hold the task's
  version.
- **Accept.** Per file or all at once. A request that contains a conflicting file writes
  nothing (409 `task_isolation_conflict` with `details.conflicts`); overwriting is a separate,
  explicit choice (`overwrite: true`). Each file is written to a temporary file next to its
  target, hash-checked, the project state re-checked, then renamed over the target. Folders
  on the way are walked without following links; a link in the project is never written
  through (409 `task_isolation_unsafe_path`).
- **Discard / finish.** Discarded files leave the list. When a finished task run has nothing
  left, the review closes itself: the worktree is removed (`git worktree remove --force`, only
  for a worktree this feature created) or the snapshot is deleted, and the record stays as
  history. A conversation's copy closes when the person finishes; its chat is first moved back
  to the project (native `session.move`, verified) and the copy is kept if that fails.

## Why a sibling of `taskContinuity`

`taskContinuity` + `comexGitWorkspace` already move a conversation into a git worktree and
show a whole-repository, code-only diff. They do not fit document projects: they require git
and a commit, exclude reports and spreadsheets on purpose, have no per-file decision, no
conflict check and no way back into the project other than git itself. This feature reuses
their pieces (`createGitWorktree`, the session home index that keeps a moved chat anchored to
its project, native `session.move` with verification) and adds what was missing, scoped to
specialist applications, under its own flag so either can be turned off independently.

## Where it shows up

- **Task runs.** With the flag on, `scheduler.ts` creates the copy right after the run's
  session, moves the session into it and confirms the move before sending the prompt (the run
  fails with `task_isolation_move_unverified` instead of writing to the project). The run log
  entry and the task's `running` claim carry `isolationId`; `GET …/tasks/:taskId/runs` adds
  `review: "pending" | "reviewed" | null`. The run history in the tasks view offers
  "Review changes"; accepting or discarding is refused while the run is still in flight
  (`task_isolation_busy`).
- **Conversations.** Project panel → "Isolated copy" → "Continue in an isolated copy". The
  same review panel appears inline.

## Server surface

All routes are `"host"` (desktop or paired device), zod-validated, and 404
`task_isolation_disabled` when the flag is off.

| Route | Purpose |
| --- | --- |
| `GET /specialist-applications/:id/isolations[?status=all]` | Active (or all) copies |
| `GET /specialist-applications/:id/isolations/:isoId` | Summary, `busy`, change list |
| `GET /specialist-applications/:id/isolations/:isoId/diff?path=` | One file's diff |
| `POST …/:isoId/accept` `{ paths, overwrite? }` | Apply files to the project |
| `POST …/:isoId/discard` `{ paths }` | Drop files from the review |
| `DELETE …/:isoId` | Discard the rest and remove the copy |
| `GET/POST /workspace/:id/task-isolation/sessions/:sessionId` | A chat's copy / isolate a chat |

On disk, per application: `<specialists>/<appId>/isolations/<isoId>/record.json`
(`isolationRecordSchema`, version 1), `base.json` (`baseManifestSchema`), and `copy/` or
`comex-worktrees/<hash>/<uuid>/`. Paths in formats are forward-slash and project-relative.
Path rules, change classification, text detection and the line diff are pure functions in
`apps/server/src/specialists/isolation/core.ts`, pinned by `contracts/task-isolation/v1/`.

## Limits and known gaps

- A git worktree holds only committed, tracked files; ignored documents are not visible to the
  task (projects with pending changes use a snapshot instead).
- Unchanged size plus modification time is trusted as "unchanged" when scanning the copy.
- Links and empty folders are not reviewed. The diff is line-based; binaries show size only.
- The engine must accept `session.move` into a folder outside the project; verified against
  fakes here, to be confirmed live with OpenCode v2.

## Verification

```sh
node --conditions=development --import ./apps/server/test/setup/isolate-home.mjs --import ./apps/server/node_modules/tsx/dist/loader.mjs --test apps/server/test/task-isolation-core.test.ts apps/server/test/task-isolation.test.ts
cd apps/app && bun test tests/task-isolation-review.test.tsx
```

Design rules applied: P1, P3, P8 (accept/discard are reversible per file until finishing;
overwrite is explicit), S1, S5, C1, C5, C6.

# Projects experience (`projectsExperience`)

A **project** is an existing workspace (a folder) bound to a specialist application
(`specialist_projects` in `profiles.sqlite`), not the application itself. This feature adds a
registry over every project of every application and, per project: description and pin,
instructions that reach every session, a context file area with a capacity, project memory, and
scheduled tasks that run in the project with an automatic or manual permission mode.

Phase 1 (this document) is the server API and the typed client. The UI (Projects page, project
page, Contexto dialog, Nueva tarea programada dialog, sidebar) builds on it.

## Flag

- Registry: `packages/features/src/registry.ts` → `projectsExperience` (default on, self-hosted).
  Operators turn it off with `DEN_FEATURE_PROJECTS_EXPERIENCE=false`.
- Server accessor: `projectsExperienceEnabled()` in `apps/server/src/comex/features.ts`.
- `GET /comex/features` reports `projectsExperience` (true only while specialist applications are
  on too). Client type: `getComexFeatures()` in `apps/app/src/app/lib/openwork-server.ts`.
- While off, every `/specialist-projects*` route answers `404 projects_disabled`, the scheduler
  answers no permission request, no project instructions are sent to the agent, and the
  application task routes ignore `workspaceId`, `permissionMode` and `advanced`.

## Where things live (and why)

| Piece | Storage | Why |
| --- | --- | --- |
| Description, pin | `specialist_project_meta` (same SQLite as applications), `ON DELETE CASCADE` with the binding | Registry metadata, like names. One server, so phone and desktop always agree. |
| Last activity | same table, `last_activity_at` | Bumped when a prompt reaches a session of the project (at engine admission) and when the person edits the project (name, description, instructions, context, memory). Pinning does not count. `lastActivityAt` is `max(last_activity_at, createdAt)`. |
| Created at | the project folder's birth time (ctime where the filesystem has none) | No migration needed for existing projects. |
| Name | the workspace display name | `PATCH name` reuses the workspace rename path (`renameWorkspaceOnHost`, same as `PATCH /workspaces/:id/display-name`). |
| Instructions | `<data folder>/instrucciones.md` (`proyecto/instrucciones.md`, or `comex/…` in older projects) | Travels with the application export (the data folder is exported whole), visible and auditable. |
| Context files | `<data folder>/contexto/` | Plain files inside the project, so the agent reads them with its normal file tools; they travel with the export; they are not sources (no 300-source limit, no snapshots, no citation index). A file can still be registered as a citable source later through the existing `POST /specialist-applications/:id/sources/local`. |
| Memory | the existing scoped memory, scope `project` (`comex_scoped_memory`, keyed by the folder's real path) | Reused as is: the same notes the agent already receives and `/recordar` writes. |
| Task project and settings | `tasks.json` of the application: new fields `workspaceId`, `permissionMode`, `isolation` | Tasks stay one store per application (20 per application across its projects). |

### How instructions and context reach the agent

At prompt admission (`server.ts`, v2 proxy, the same place the application's own instructions are
written), when the workspace belongs to a specialist application and the flag is on, the server
writes one more engine instruction entry, `project`, built by `projectAgentInstructions()`
(`apps/server/src/specialists/projects/instructions.ts`): the project name, the instructions text
(quoted, framed as the person's instructions that never override permissions or safety rules) and
the list of context files (up to 40 paths, plus a count) with the folder to read them from.

Nothing of the person's is edited: no `opencode.json(c)` `instructions`, no `AGENTS.md` block, no
library file. So the application's library/context sync (`sync.ts`, `.nuevo` copies) never sees
these files, and removing the instructions is deleting one file. Like the application's
instructions, this channel exists on the OpenCode v2 engine (the default); a v1 engine does not
receive them.

## API

Reads are `client` (collaborator token is enough); writes are `host` (owner: the host token or a
paired device). The web app only holds the collaborator token: it can read everything and must
show writes as unavailable (`writable: false` in the responses).

All schemas are in `packages/types/src/projects.ts` (`@openwork/types/projects`); the app
re-exports them from `apps/app/src/app/lib/projects.ts`.

**Why `/specialist-projects` and not `/projects`:** in the web app, pages and API share one origin,
and an API `GET` at a page path answers JSON when the person reloads the page (it happened with
`/command-center`; `apps/server/test/web-app-routes-vs-api.test.ts` guards it). The UI can use
`/projects` and `/projects/:workspaceId` as page paths.

| Method | Path | Auth | Request | Response (schema) |
| --- | --- | --- | --- | --- |
| GET | `/specialist-projects` | client | — | `projectListSchema`: `{ projects: ProjectSummary[], writable }`, default order: pinned first (most recently pinned on top), then `lastActivityAt` desc, then name |
| GET | `/specialist-projects/:workspaceId` | client | — | `projectDetailSchema`: summary + `instructions { set, updatedAt }`, `context` (usage), `memory { entries, enabled }`, `scheduled { tasks }`, `recentSessions [{ id, title, updatedAt }]` (10, newest first, roots only, archived left out), `recentSessionsComplete`, `writable` |
| PATCH | `/specialist-projects/:workspaceId` | host | `projectPatchInputSchema`: `{ name?, description?, pinned? }` (at least one) | `{ project: ProjectSummary }` |
| GET | `/specialist-projects/:workspaceId/instructions` | client | — | `projectInstructionsSchema`: `{ text, updatedAt, maxChars }` |
| PUT | `/specialist-projects/:workspaceId/instructions` | host | `{ text }` (≤ 8,000 chars; empty removes them) | `projectInstructionsSchema` |
| GET | `/specialist-projects/:workspaceId/context?path=<folder>` | client | `path` optional (root) | `projectContextListingSchema`: `{ path, entries [{ kind, name, path, size, items, updatedAt }], usage, agentPath }` — folders first, then files, by name; folder `size` is the total below it, `items` its direct children |
| POST | `/specialist-projects/:workspaceId/context/files?path=<folder>&name=<file>[&replace=true]` | host | raw body (the file; `application/octet-stream`) | `201` `projectContextChangeSchema`: `{ entry, usage }` |
| POST | `/specialist-projects/:workspaceId/context/folders` | host | `{ path }` (the new folder; its parent must exist) | `201` `projectContextChangeSchema` |
| DELETE | `/specialist-projects/:workspaceId/context?path=<file or folder>` | host | — (a folder goes with everything in it) | `projectContextChangeSchema` (`entry: null`) |
| GET | `/specialist-projects/:workspaceId/memory` | client | — | `projectMemorySchema`: `{ revision, notes [{ id, text, updatedAt }], writable, maxNotes, maxChars }` |
| POST | `/specialist-projects/:workspaceId/memory` | host | `{ expectedRevision, text, id? }` (no `id` adds, `id` replaces) | `projectMemorySchema` |
| DELETE | `/specialist-projects/:workspaceId/memory/:noteId?expectedRevision=N` | host | — | `projectMemorySchema` |
| GET | `/specialist-projects/:workspaceId/tasks` | client | — | `projectTaskListSchema`: `{ applicationId, tasks: ProjectTask[], capabilities { dryRun, isolation }, limit, writable }` |
| POST | `/specialist-applications/:applicationId/tasks` (existing) | host | existing body + `workspaceId`, `permissionMode`, `advanced { catchUp?, isolation? }` | existing `{ task, tasks, budget }` |
| PUT | `/specialist-applications/:applicationId/tasks/:taskId` (existing) | host | any of the above, plus `enabled` | existing `{ task, tasks, budget }` |
| POST | `/specialist-applications/:applicationId/tasks/:taskId/dry-run` (existing) | host | `{}` | existing; only when `capabilities.dryRun` |
| POST | `/specialist-applications/:applicationId/tasks/:taskId/run-now` (existing) | host | `{}` | existing |
| DELETE | `/specialist-applications/:applicationId/tasks/:taskId` (existing) | host | — | existing |

Client methods (`createOpenworkServerClient`, all parse with the schemas): `listProjects`,
`getProject`, `updateProject`, `getProjectInstructions`, `setProjectInstructions`,
`listProjectContext`, `uploadProjectContextFile`, `createProjectContextFolder`,
`deleteProjectContextEntry`, `getProjectMemory`, `saveProjectMemoryNote`, `deleteProjectMemoryNote`,
`listProjectTasks`, `createProjectTask(applicationId, workspaceId, input)`,
`updateProjectTask(applicationId, taskId, patch)`. Run now, dry run and delete keep their existing
methods (`runSpecialistTaskNow`, `dryRunSpecialistTask`, `deleteSpecialistTask`).

### Errors

`{ code, message }` with a stable `code` (list in `PROJECT_ERROR_CODES`, `apps/app/src/app/lib/projects.ts`).
Messages are Spanish and meant for people; map codes to `projects_ui.*` texts in the UI.
`projects_disabled` and `project_not_found` (404), `invalid_project` (422), context path codes
`context_path_required|invalid|hidden|too_deep`, `context_name_too_long` (422),
`context_not_found` (404), `context_exists`, `context_unsafe_folder`, `context_unsafe_path`,
`context_capacity_folders` (409), `context_file_too_large`, `context_capacity_bytes`,
`context_capacity_files` (413), `insufficient_storage` (507), `instructions_too_long` (422),
memory codes from scoped memory (`memory_conflict` 409: reload and retry with the new revision),
task codes from the task routes plus `workspace_not_bound` (403).

## Limits (`PROJECT_LIMITS`, one place)

| Limit | Value |
| --- | --- |
| Name | 80 visible characters |
| Description | 2,000 characters (new lines allowed) |
| Instructions | 8,000 characters |
| Context capacity | 50 MB and 500 files per project |
| One context file | 25 MB |
| Context folders | 100, nested up to 6 levels |
| Recent sessions | 10 |
| Context files named to the agent | 40 (the rest are counted) |
| Memory | 24 notes of up to 800 characters (scoped memory) |
| Scheduled tasks | 20 per application (all its projects) |

`usage.usedPercent` is the fuller of bytes and files, floored, 0–100 (the "N archivos · X % de la
capacidad del proyecto utilizada" bar).

## Context safety

- Paths are normalized by `normalizeContextPath` (pure, vectors in `contracts/projects/v1`):
  `/` or `\`, no `.`/`..`, no hidden names (leading dot), no colons, control or bidirectional
  characters, Windows device names, trailing dot/space, components over 255 bytes, depth over 6.
- The context folder and the data folder must be real folders (not links) inside the project's
  real path; every existing step of a path is checked with `lstat` and a link is refused
  (`context_unsafe_path`); the files routes' `resolveSafeChildPath` is the final guard. Links and
  hidden files are never listed or counted.
- Uploads stream to a hidden temporary file in the target folder and are renamed into place only
  when complete. The declared `Content-Length` is checked first; while streaming, the upload is cut
  at the remaining budget (`uploadByteBudget`) so the project never goes over capacity. Uploads,
  folder creation and deletion of one project are serialized.

## Scheduled tasks per project

- `workspaceId`: the project the task runs in. Older tasks (null) run in the application's first
  live project, as before, and are listed under that project. A task whose project is gone is
  `blocked` ("El proyecto de esta tarea ya no está disponible"), never run elsewhere.
- `permissionMode`:
  - `auto`: while a run is in flight, each scheduler tick (10 s) lists the pending permission
    requests of the run's session and of the sessions it delegated to, and answers each with
    `once`. A `deny` rule never reaches the ask stage, so it still denies. Requests of any other
    session are never touched. This is what the "Automático" notice promises.
  - `manual`: nothing is answered. The run's requests wait for the person; the command center
    already marks the task `waiting` and the chat shows the request. A run waiting for an approval
    is kept for up to 24 hours instead of being retired at 15 minutes.
  - **Default.** A task the person did not set explicitly is `manual`. That is today's behavior
    (before this feature nobody answered a run's requests), and it keeps agent tools
    (`specialist_task_create`), accepted proposals and imported bundles from ever creating a task
    that approves itself: those inputs go through `taskInputSchema`, which has no owner fields.
    **The UI must send `permissionMode` explicitly** (its selector may start on Automático).
  - Which actions ask at all still comes from the project's permission mode (Solicitar
    aprobación, Aprobar automáticamente, Acceso completo); `manual` does not add asks.
  - Dry runs are not observed by the scheduler, so their requests always wait for the person.
- `advanced.catchUp`: the existing "recover missed runs" (stored as `catchUp`).
- `advanced.isolation`: with `taskIsolationReview` on, whether this task's runs work in an isolated
  copy (default true, as before). `capabilities.isolation` says whether it has any effect.
- Contract: `taskPermissionReplies` and `runsInProject` vectors in `contracts/projects/v1`.

## For the UI

- Feature check: `getComexFeatures().projectsExperience`.
- `writable` on every read tells whether to offer edits (false in the web app).
- Sorting/search on the Projects page can be client side; the server order is the default.
- After any context change use the returned `usage` for the capacity bar instead of re-listing.
- Memory edits need the last `revision`; on `memory_conflict` re-read and retry.
- "Recientes": when `recentSessionsComplete` is false, say the list could not be read instead of
  "no sessions".
- Instructions "Agregar/Editar": `instructions.set` on the detail.
- Programado: create with `createProjectTask(applicationId, workspaceId, { name, prompt, schedule,
  model?, permissionMode, advanced })`; `applicationId` comes from the detail or the task list.

## Tests

- `apps/server/test/projects-experience.test.ts`: contract vectors, auth modes, registry, pin and
  description, rename, instructions, context (upload, folders, capacity, traversal, links),
  memory, per-project tasks, owner-only task settings, flag off.
- `apps/server/test/projects-task-permission-mode.test.ts`: `auto` answers the run's requests
  (and its delegated sessions') once, in the task's project; `manual` answers nothing and is not
  retired at 15 minutes; a task whose project is gone is blocked.
- `apps/app/tests/projects-client.test.ts`: client methods and schemas.

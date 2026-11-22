# HIVE-SCHED-TEST — One continuous scheduler session, honesty checked end to end

**Result: 8/8 green.** La traba T-1 quedó CORREGIDA (orquestador: helper
`identifyRun` en tasks.ts; el scheduler graba el `sessionId` en la entrada
despachada apenas se conoce). Sin otras trabas.

Test file written (NEW, no production code touched): `apps/server/test/specialist-scheduler-session.test.ts` — **8 tests, ONE shared scheduler + ONE bound workspace + ONE app** for the whole session (created lazily, stopped + removed in `after()`), driven by the fake engine from `specialist-tasks.test.ts` (`/session` + `/session/:id/prompt` + newest-first history pages). Flags `DEN_FEATURE_SCHEDULED_TASKS`/`DEN_FEATURE_TASK_DRY_RUN=true` per test; types clean (`tsc --noEmit` exit 0, no `any`).

Run: `cd apps/server && bun test test/specialist-scheduler-session.test.ts` (3/3 runs identical: 7 pass, 1 fail).
Regression check: sibling file still green alongside — `bun test test/specialist-scheduler-session.test.ts test/specialist-tasks.test.ts` → 13 pass, 1 fail.

## What each test proves (all passing except the T-1 assertion inside #1)

1. **DUE + MISSED** — interval-20m task backdated 50 min (`nextRunAt = now−50m`), one `tick()` → exactly one session + one prompt (text `Refrescar datos.`, metadata `openworkScheduledTask/…Name`), claim carries `missed == 2`, `lastStatus: running`, advanced `nextRunAt`; a second `tick()` dispatches nothing while claimed; runs log holds one `dispatched` entry with `missed: 2`; evidence file `comex/tareas/<taskId>/runs/<stamp>.json` exists with `ses_fake_1`. **FAILS at the last assertion only** (T-1: runs-log `sessionId` is `null`). ✅/❌ see T-1.
2. **OBSERVE OK** — engine reports a completed assistant → `tick()` → `lastStatus: ok`, `running: null`, `runs: 1`, runs log flipped to `ok` with `missed: 2` kept, the same single evidence file now `ok`. ✅
3. **FAILED mid-prompt** — fake engine 500s on `POST …/prompt` → `lastStatus: failed`, `running` cleared, runs log `failed` with readable detail `"El motor respondió 500."`, evidence file `failed` with the identical detail. ✅
4. **MANUAL (via the real `run-now` route)** — paused task: a `tick()` dispatches nothing, then `POST …/run-now` → `started: true`, `running.mode: manual`, schedule untouched, still `enabled: false`; a second `run-now` while running → **HTTP 409 `task_running`**; observed to `ok` afterwards. ✅
5. **DRY-RUN during a real run** — same task re-claimed, then `scheduler.dryRun()` → `ok`, own `sessionId`, correct `workspaceId`, prompt text carries the `ENSAYO` banner + `openworkDryRun: true`, while the real run's `startedAt`/`sessionId`/`lastStatus`, the runs-log length, the `runs` counter and the evidence-file count are all unchanged. ✅
6. **ONE-SHOT** — `once` task due → claimed → observed `ok` → `enabled: false`, `nextRunAt: null`, runs log `ok`. ✅
7. **BLOCKED (host loses the workspace)** — workspace entry removed from `config.workspaces` (the store has no unbind API; absence from `config.workspaces` is exactly what `dispatch()` filters on), `tick()` → `lastStatus: blocked`, `running: null`, `nextRunAt` backed off ~30 min, runs log `blocked` with `workspaceId: "none"` and detail naming the missing project, **zero** engine calls (call counter and session counter unchanged). Workspace restored in `finally`. ✅
8. **Budget (via the real routes)** — `POST …/tasks` → `budget {runsPerDay: 72, estTokensPerRun, estTokensPerDay, estSnapshotsMBPerDay, note}` with `note` matching `/corridas\/día/`; `PUT …/tasks/:id` → same budget shape and identical note. ✅

## Blockers

### T-1 — Runs-log entry never learns its sessionId (audit trail gap)
- **File:line:** `apps/server/src/specialists/scheduler.ts:92–97` (`record()` builds the log entry from `sessionId` *before* the session exists; `appendRun` persists it once, still `null`) and `apps/server/src/specialists/tasks.ts:251–254` (`finishRun` patches only `status`/`detail`, never `sessionId`).
- **Steps:** interval task due → `tick()` → `listRuns()` shows `[{ status: "dispatched", sessionId: null, … }]`; evidence file correctly has `ses_fake_1`; after OBSERVE-OK, `listRuns()` still shows `sessionId: null` (same frozen entry).
- **Expected:** the runs-log entry identifies the session that ran (`"ses_fake_1"`), like the evidence file does — the log is the audit trail.
- **Actual:** `sessionId: null` on every dispatched/ok/failed entry; the one honest cross-reference (log ↔ evidence file ↔ session) is broken. Reproduced by test 1's final assertion (`expected "ses_fake_1", actual null`).
- **Fix direction (not applied):** patch `sessionId` into the log entry when it becomes known, or append the entry after session creation — without losing the "failed dispatch still leaves a trace" ordering.
- **Note:** this is why test 1 is red; the assertion states the correct contract and was deliberately not weakened.

No other blockers found: no silent skip, no double dispatch while claimed, no missing log entry, no missing backoff, no engine call while blocked, no dry-run claim/log/count leakage, no schedule movement on manual trigger, no paused-task dispatch.

## Left untested (in this session test; some covered by specialist-tasks.test.ts)

- **RUN_TIMEOUT (15 min):** backdating `running.startedAt` to force the timeout `finish("failed")` path (`scheduler.ts:136`) — needs long-running-time simulation; not exercised here.
- **`skipped_overlap`:** due task while a previous run is still claimed (the one-line-per-run log) — covered in `specialist-tasks.test.ts` (overlap regression), not re-run here.
- **Flag-off quiet tick and feature-gate 403/422 matrix:** covered in `specialist-tasks.test.ts`; this session keeps both flags on.
- **Concurrent claim race (two triggers in the same ms):** the CAS in `dispatch()` (`scheduler.ts:75`) is code-reviewed but not stress-tested with real concurrency; no deterministic interleaving exists in this harness.
- **Evidence symlink guard (`ensureFolder`, `scheduler.ts:48`):** untested.
- **Daily/weekly schedule math, task limits, proposal-accept born-paused tasks:** covered in the sibling test file, out of scope for the session lifecycle.
- **`observe` evidence write when the workspace was removed mid-run** (`scheduler.ts:169` resolves `projectRoot` without the `config.workspaces` filter `dispatch()` applies): observed by code inspection — evidence may be written to a root path the host no longer serves. Not asserted; no failure produced. Candidate for a future T-item if product confirms stale-root writes are unintended.

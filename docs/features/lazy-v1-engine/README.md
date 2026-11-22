# On-demand OpenCode v1 engine (`lazyV1Engine`)

While OpenCode v2 serves chats, the desktop app no longer keeps an idle OpenCode v1 process
running. v1 starts the first time something really needs it and stops again after 10 idle
minutes. Feature flag `lazyV1Engine`, self-hosted, on by default.

## Why

The memory baseline (`docs/performance/memory-baseline.md`) measured the v1 engine at about
**438 MB PSS and ~1% CPU for the whole session**, while every chat went through v2. It was the
biggest single fixed cost of the app. v1 still answers a few things (older chats it created,
the provider settings, some MCP and library reads), so it cannot simply be removed.

## How it works

- **A gate keeps v1's address.** `apps/server/src/lazy-v1-engine.ts` listens on a loopback port
  and that URL becomes `config.opencodeBaseUrl` / `workspace.baseUrl`, exactly where the v1 URL
  used to be. The credentials are fixed for the life of the server (`credentials` option of
  `createManagedOpencodeServer`), so every client built earlier still authenticates. No v1
  consumer had to change how it reaches v1.
- **Start on the first connection.** The first TCP connection to the gate spawns the engine on
  an internal port and pipes bytes both ways (HTTP, keep-alive and SSE all work unchanged).
  Concurrent first requests share one in-flight start. A failed start drops the waiting
  connections; the next one tries again.
- **Each start** (`createOnDemandV1Engine` in `apps/server/src/embedded.ts`):
  - seeds the managed provider credentials at the process's own URL before it serves traffic
    (`seedOnDemandV1Process`);
  - records the process in the engine registry, so a crash of the app leaves no orphan (the
    next boot reaps it);
  - registers a new trusted-engine identity, which drops the "MCPs already registered"
    evidence, then pushes every workspace's runtime MCPs (`syncAllWorkspacesRuntimeMcpToEngine`).
- **Idle stop.** A sweep (every minute) stops the process when all of these hold:
  - v2 serves chats (`enabled && chatRouting`);
  - no byte crossed the gate for the idle period (`OPENWORK_V1_ENGINE_IDLE_MS`, default
    600000 = 10 min, `0` disables idle stop), and no open connection was active in that period;
  - the engine itself reports no non-idle session and no pending permission or question, in the
    default folder and every folder that saw v1 traffic. The probe goes to the process directly,
    so it never counts as traffic. An unknown answer keeps v1 running.

  Stopping closes the gate's open connections, then SIGTERM, then SIGKILL
  (`createManagedProcessClose`), and removes the registry record and the trusted identity.
- **v1 as the chat engine.** If v1 serves chats at boot, it starts during boot as before. Switching
  chats back to v1 (`PUT /experimental/engine-v2-preview` with `chatRouting: false`) starts it
  before the response, and while v1 serves chats the sweep never stops it and restarts it if it
  died. Switching is unchanged otherwise: the history-adoption and `opencodeV2Only` guards still
  apply.
- **Rollover and recovery.** The engine pool's replacement engines (`spawn` hook of
  `createEnginePoolForConfig`) are on-demand engines too. A rollover requested while v1 is
  stopped is answered `updated_live` without starting it: the next start reads the current
  runtime config file (`engine-pool.ts`, `dormant()`).
- **Shutdown.** The pool disposes its engines; each on-demand engine closes its gate and stops
  its process. Covered by tests that check the PID is gone.

## Consumer inventory

What still talks to v1, and what happens now while v2 serves chats and v1 is stopped.

### Background work (would defeat the saving): skipped while v1 is stopped

| Consumer | Where | Now |
|---|---|---|
| Startup and retried managed provider credentials, the ~5 min cloud provider sync, `/config` provider writes | `managed-provider-auth.ts` (`resolveManagedProviderAuthTarget`) | Skipped; seeded at the next start |
| Startup folder warm-up | `server.ts` `warmActiveEngineFolder` | Skipped |
| Startup and later runtime MCP pushes, MCP disconnects, the deferred MCP sync timer | `server.ts` `runRuntimeMcpSyncToOpencodeEngine`, `disconnectMcpFromOpencodeEngine` | Skipped (`status: "skipped"`); all pushed at the next start |
| In-place reloads (workspace bootstrap repair, provider save, `/engine/reload`) | `server.ts` `reloadOpencodeEngineInPlace` | No-op: the next start reads current config |
| Pool rollovers | `engine-pool.ts` `runRollover` | `updated_live` without a spawn |
| Busy probes for reloads and provider sync | `server.ts` `engineHasActiveSessions` | Idle |
| Activity probes: switch check, `/experimental/engine-v2-preview/activity`, `/runtime/activity`, run-mode checks, automatic upgrade | `server.ts` `probeWorkspaceActivity` | v1 contributes "idle" (nothing runs without a process) |
| Thread-approval replay (a permanent `/global/event` stream) | `thread-approvals.ts` via `createEnginePoolForConfig` | Follows the process's own URL while it runs; nothing while stopped |
| Idle instance reaper | `engine-instance-reaper.ts` hook in `startServer` | No sweep while stopped |

### Real v1 users: start v1 on demand

| Consumer | Where |
|---|---|
| `/workspace/:id/opencode/*` and bare `/opencode/*` proxy (old v1 chats, Stop, provider list and sign-in, `/opencode/mcp` status) | `server.ts` `proxyOpencodeRequest` |
| Settings: provider list and sign-in, library lists (commands, agents), MCP status of the Connections page | `apps/app/src/react-app/shell/settings-route.tsx`, `domains/connections/store.ts` (v1 client) |
| Effective permissions and agent diagnostics reads | `server.ts` `createWorkspaceOpencodeClient` callers |
| Task recovery of journaled v1 runs after a crash | `task-recovery.ts` (`engine: "v1"` records) |
| Desktop with no workspace yet (provider auth on the bare `/opencode` mount) | `shell/session-route.tsx` |
| Chat-first workspace creation and onboarding still call `session.create` on the v1 mount | `shell/session-route.tsx`, `shell/welcome-route.tsx` |
| Den-managed worker heartbeat (`session.list`) | `worker-activity-heartbeat.ts`, CLI only, not the desktop |

### Already v2 or not v1: unchanged

Chat traffic and the session routes (`/opencode2`), the command center (picks the engine from
`chatRouting`), task continuity, the specialist scheduler, cloud MCP health when v2 routes chats,
and history selection (`opencode-history.ts` reads the v1 database file, never the process). The
`/health` and `/status` routes do not contact v1.

## Status surfaces

- `GET /experimental/engine-v2-preview/status` and `/activity` add
  `v1Engine: { onDemand: true, state, starts, idleStopMs, lastStartedAt, lastStoppedAt, lastError }`
  (`{ onDemand: false }` with the flag off). `state: "stopped"` is the normal resting state, not
  an error.
- The desktop's `managedOpencode` handle reports `isAlive: true` while the gate is up and
  `pid: null` while v1 is stopped, so the shell stays "healthy" and diagnostics show no PID.

## Turning it off

`DEN_FEATURE_LAZY_V1_ENGINE=false` (or the `lazyV1Engine` operator lock) restores the old
behavior: v1 is spawned at boot and runs for the whole session. Only the embedded server (the
desktop) uses the gate; `openwork-server` started from the CLI is unchanged.

## Limits

- The first v1 request after a stop waits for the engine to start (a few seconds on a cold
  machine), for example opening Settings › AI providers.
- Opening Settings, the Connections page or creating a workspace from the first chat starts v1
  (see the inventory above); it then stops 10 minutes after the last use. Moving those reads to
  v2 would avoid the start.
- An idle connection that stays open but silent for the whole idle period does not hold v1; the
  stop closes it and the client reconnects, which starts v1 again.

## Tests

- `apps/server/test/engine-lazy-v1.test.ts`: the gate (no start before a request, one start for
  concurrent requests, idle stop and restart, busy or unknown probe keeps it, v1 as chat engine
  never stops and restarts, failed start, close).
- `apps/server/test/engine-lazy-v1-boot.test.ts`: `startEmbeddedServer` with a stand-in v1
  binary: boot with v2 does not spawn v1, a v1 request spawns it once, idle stop leaves no
  process and a later request restarts it, switching to v1 starts it, v1 at boot, flag off keeps
  today's behavior, shutdown kills the process.

Both run in the serial engine lane: `pnpm --filter openwork-server test:engines`.

## Live verification (pending)

On the desktop dev build, with v2 as the chat engine:

1. After boot, the session's process tree has no OpenCode v1 `serve` process
   (`scripts/dev-agent/perf-sample.mjs` labels it), and `/experimental/engine-v2-preview/status`
   reports `v1Engine.state: "stopped"`. Chats work.
2. Open Settings › AI providers: v1 starts once, the list loads.
3. After 10 idle minutes (or `OPENWORK_V1_ENGINE_IDLE_MS=60000`), v1 is gone again.
4. Switch chats to v1 in Settings: v1 starts immediately and a v1 chat works; switch back to v2.

# Memory and CPU baseline: parallel chats in the desktop app

Measured 2026-11-20 on the development desktop app (`pnpm dev:agent up electron`),
with the local Fault Lab fake model only. This page gives the method, the numbers
for each scenario and process, the one leak found and its fix, and how many tasks
can safely run in parallel on this kind of machine.

## Summary

- **Leak (fixed): the development renderer grew without limit.** React 19 development
  builds log every component render to the browser's User Timing buffer
  (`performance.measure`, with a props diff attached). Nothing ever cleared that buffer.
  With 10 chats taking turns, the renderer grew by **about 250 MB per minute: 416 MB to
  2.9 GB in 10 minutes**, and closing the chats freed none of it. The buffer held 631k
  entries, and clearing it took the renderer from 1.79 GB to 417 MB. With the fix
  (`apps/app/src/react-app/infra/react-dev-measure-trim.ts`, development only), the same
  10 minutes level off at **about 1.0–1.2 GB** and fall back to **about 570 MB** once
  the chats close. Production builds never record these entries. This is the most
  likely cause of the earlier out-of-memory kill, when several `pnpm dev` and agent
  Electron sessions ran at once.
- **The JS heap does not leak.** It stays at 85–160 MB used. Event listeners and DOM
  nodes rise and fall with what is on screen and do not trend up.
- **Server side, nothing grows per chat.** The OpenCode v2 engine stays at 340–400 MB
  from 0 to 10 parallel chats, peaking at 463 MB. The Electron main process (which
  embeds `openwork-server`) stays at 150–255 MB.
- **Fixed overhead worth removing (recommendation):** the OpenCode **v1 engine runs the
  whole time (438 MB)** even though every chat goes through v2. It serves no traffic
  and uses about 1% CPU. Now started on demand behind `lazyV1Engine` (see
  recommendation 2; saving pending live verification).
- **Dev tooling costs about 1 GB per dev session.** Vite takes 340–840 MB, and the
  pnpm/node launcher chain about 430–610 MB. A packaged app does not have it.
- **Bug seen once under load (defensive fix):** at 6 parallel chats the renderer crashed
  with "Maximum update depth exceeded" in the virtualized thread, right after React
  warned about two rows with the same key (`group:msg_<client id>`). We could not
  reproduce it on demand. The row keys are now unique (see "Fixes").

## Machine and method

| | |
|---|---|
| CPU | Intel Pentium Gold G5420, 2 cores / 4 threads (CPU % below is per thread; 400% = all) |
| RAM | 15 GB, 4 GB swap. The person's own apps were open, with 5–8.5 GB `MemAvailable` throughout. |
| OS | Linux 7.0, Wayland session; Electron 43.8.1 under XWayland |
| App | Dev build: `pnpm dev:agent up electron --session perf` (Vite renderer, embedded server, isolated profile `agent-perf`) |
| Engines | OpenCode v2 2.2.0 serves the chats. OpenCode v1 1.18.33 starts first and keeps running. |
| Model | `devtool fake-model on`: Fault Lab `ok` (instant short reply) and `stall` (never answers) |

- **Sampler.** `scripts/dev-agent/perf-sample.mjs record` read `/proc` every 2 s for
  every process the session started: the launcher tree under the session PID, plus the
  fake model and the event watcher. For each process it recorded PSS (from
  `smaps_rollup`; it avoids counting Electron's shared pages twice), RSS and CPU.
  Each process is labelled by its command line.
- **Watchdog.** The same sampler would have run `devtool down` if `MemAvailable`
  dropped under 3 GB. It never fired; the lowest reading was 5.0 GB.
- **Renderer internals.** A CDP probe read the JS heap, DOM nodes and listeners every 10 s.
- **Driving.** Real UI input over CDP, the same calls as `devtool click`, `fill` and
  `press`: "Nuevo chat", pick the Fault Lab model, type, Enter. Each scenario opens N
  chats, then takes 3 rounds of one turn per chat. The 10-minute runs loop over the 10
  `ok` chats with no pause. The 10 `stall` chats stayed in flight from the stall
  scenarios to the end, so every later phase has 10 running tasks.
- "App" totals leave out the dev tooling (Vite, esbuild, pnpm/node launchers, watcher),
  which is listed separately.

## Results

### Totals per scenario (app processes only)

| Scenario | Duration (s) | App PSS mean / peak (MB) | App CPU mean / peak (% thread) | Dev tooling PSS (MB) | MemAvailable min (MB) |
|---|---:|---:|---:|---:|---:|
| Idle after boot | 127 | 1382 / 1401 | 8 / 37 | 1265 | 6398 |
| 1 chat, `ok` | 143 | 1494 / 1597 | 38 / 143 | 931 | 7011 |
| 3 chats, `ok` | 156 | 1561 / 1780 | 38 / 162 | 936 | 7479 |
| 6 chats, `ok` | 171 | 1700 / 1924 | 62 / 197 | 936 | 7113 |
| 10 chats, `ok` | 125 | 2024 / 2367 | 87 / 154 | 937 | 7429 |
| + 1 chat `stall` | 64 | 2101 / 2133 | 43 / 123 | 1061 | 7491 |
| + 3 chats `stall` | 62 | 2124 / 2181 | 55 / 149 | 1077 | 7415 |
| + 6 chats `stall` ¹ | 66 | 2482 / 2732 | 73 / 174 | 1066 | 6081 |
| + 10 chats `stall` ¹ | 82 | 2818 / 2869 | 69 / 158 | 1031 | 5497 |
| Command center open, 10 running ¹ | 88 | 2871 / 2895 | 53 / 120 | 1016 | 6734 |
| Results inbox open, 10 running ¹ | 103 | 2836 / 2929 | 46 / 125 | 1001 | 6786 |
| **10 min of turns, before fix** | 626 | 2891 / **4126** | 138 / 171 | 998 | 5157 |
| Chats closed, before fix (2 min + forced GC) | 125 | **3993** / 4117 | 50 / 115 | 993 | 5089 |
| **10 min of turns, with fix** | 611 | 2220 / **2540** | 118 / 161 | 998 | 7105 |
| Chats closed, with fix (2 min + forced GC) | 136 | **1769** / 2423 | 20 / 245 | 1001 | 7728 |

¹ Includes about 400 MB in the renderer created by our own diagnostic probe. Reading the
631k-entry buffer once (`performance.getEntriesByType`) built a JS wrapper for every
entry, and the JS heap went from 99 to 506 MB. The rows without a mark are unaffected.

### Per process (PSS mean / peak MB, CPU mean % of one thread)

| Scenario | Renderer | OpenCode v1 | OpenCode v2 | Electron main + server | GPU | Network | Zygotes | Fake model | Vite (dev) | Launchers (dev) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Idle | 301 / 309 (3) | 477 / 490 (2) | 340 / 346 (1) | 159 / 161 (2) | 37 (1) | 36 (1) | 33 | – | 558 / 839 (3) | 613 / 641 |
| 1 `ok` | 422 / 503 (25) | 438 (2) | 358 / 379 (3) | 159 / 161 (4) | 34 (4) | 33 (1) | 27 | 23 | 341 (4) | 500 |
| 3 `ok` | 491 / 686 (25) | 438 (2) | 355 / 390 (3) | 158 / 169 (5) | 34 (3) | 33 (2) | 27 | 25 | 342 (5) | 503 |
| 6 `ok` | 614 / 809 (41) | 438 (2) | 362 / 389 (4) | 162 / 172 (6) | 36 (6) | 35 (3) | 27 | 27 | 342 (4) | 503 |
| 10 `ok` | 904 / 1253 (60) | 438 (2) | 377 / 417 (6) | 177 / 187 (8) | 39 (10) | 35 (2) | 27 | 28 | 342 (4) | 502 |
| 10 `ok` + 10 `stall` ¹ | 1678 / 1733 (32) | 438 (1) | 369 / 383 (6) | 212 / 215 (9) | 36 (18) | 33 (2) | 27 | 24 | 479 (3) | 463 |
| Command center ¹ | 1733 / 1753 (19) | 438 (1) | 368 / 373 (6) | 216 / 222 (10) | 34 (16) | 32 (2) | 26 | 25 | 479 (3) | 447 |
| Results inbox ¹ | 1750 / 1811 (16) | 438 (1) | 368 / 371 (4) | 175 / 215 (9) | 31 (14) | 30 (2) | 19 | 25 | 479 (3) | 432 |
| 10 min, before fix | 1733 / 2923 (91) | 438 (1) | 392 / 463 (10) | 212 / 255 (11) | 38 (23) | 31 (3) | 19 | 30 | 479 (3) | 429 |
| Closed, before fix | 2869 / 2940 (17) | 437 (1) | 380 / 388 (4) | 190 / 253 (9) | 32 (16) | 30 (2) | 19 | 36 | 477 (3) | 427 |
| 10 min, with fix | 1033 / 1330 (81) | 426 / 437 (1) | 389 / 450 (11) | 214 / 222 (12) | 38 (10) | 32 (4) | 19 | 69 | 475 (3) | 431 |
| Closed, with fix | 618 → 570 (9) | 424 (3) | 371 / 381 (1) | 174 / 209 (4) | 32 (0) | 32 (3) | 18 | 101 | 477 (7) | 430 |

The fake model is the Fault Lab test server; it grows only because the stalled requests
stay open. esbuild (55–63 MB) and the event watcher (36–39 MB) are dev tooling and are
not shown.

### Growth over time (10 chats taking turns non-stop, 10 stalled tasks in flight)

| Elapsed | Renderer before fix | Renderer with fix | v2 engine (both runs) | Main + server (both runs) |
|---:|---:|---:|---:|---:|
| 0 s | 416 MB | 335 MB | 378–380 MB | 208–210 MB |
| ~1 min | 767 MB | 839 MB | 380–390 MB | 215–218 MB |
| ~3 min | 1296 MB | 906 MB | 375–378 MB | 213–216 MB |
| ~5 min | 1694 MB | 1154 MB | 380–385 MB | 213–214 MB |
| ~7 min | 2143 MB | 1104 MB | 386–393 MB | 171–215 MB |
| ~9 min | 2640 MB | 1090 MB | 377–379 MB | 213–215 MB |
| ~10 min | 2921 MB | 1216 MB | 380–389 MB | 209–254 MB |
| 2 min after closing + GC | 2747 MB (stays) | 566–588 MB | 370–379 MB | 151–154 MB |

Before the fix the renderer grows in a straight line. With the fix it levels off. The
engine and the main process level off in both runs.

### Where the renderer memory was

`smaps` for the renderer at 1.03 GB PSS, before the fix:

- 650 MB `partition_alloc`: Blink's native heap, which holds the User Timing entries and
  their `detail` objects.
- 148 MB V8 sandbox and 134 MB V8.
- JS heap used: 105–115 MB. DOM: 700–1900 nodes.

The buffer held 571k–631k `measure` entries, almost all named after React components
(U+200B prefix, e.g. `Button` 85k, `TooltipTrigger` 34k, `FloatingTree` 24k). The rest
were React's track entries ("Update", "Mount", "Cascading Update", …). Each carried
about 300 bytes of props diff.

## Fixes in this change

1. **`startReactDevMeasureTrim`** (`apps/app/src/react-app/infra/react-dev-measure-trim.ts`).
   It runs only in development, started from `src/index.react.tsx` behind
   `import.meta.env.DEV`. A `PerformanceObserver` collects the measure names (about
   250), and every 15 s the trim clears them. Our own `openwork.*` measures stay.
   Production does not change, and Vite drops the code from production builds.
   Test: `apps/app/tests/react-dev-measure-trim.test.ts`. Live check: after a reload
   the buffer held 758 entries instead of growing into the hundreds of thousands, and
   the 10-minute run above levels off.
2. **Unique row keys in the virtualized thread** (`uniqueGroupIdentities` in
   `apps/app/src/components/chat/progressive-message-list.tsx`).
   - When the server acknowledges an optimistic send, the server's message keeps the
     optimistic ID as its row identity, so the row does not remount.
   - If two rows ever resolve to the same identity (for example, two identical prompts
     acknowledged by text in turn), the second row now keeps its own key. If even that
     repeats, it gets a `#n` suffix.
   - Duplicate keys make TanStack Virtual measure two rows under one key forever, which
     is the "Maximum update depth exceeded" crash we saw.
   - Test: `apps/app/tests/progressive-message-list-identities.test.ts`; 3 of its 4
     cases fail on the old mapping.
   - The crash happened once, at 6 chats, after a double send while a new chat was
     being created. Two scripted attempts to trigger it again did not crash, with or
     without the fix. So it is a defensive fix for a confirmed failure mode, not a
     reproduced one.

## Recommendations

1. **Safe parallelism on a 15 GB machine** (the person's own apps take 6–9 GB here):
   - **Packaged app:** about 1.3–1.5 GB plus about 10–20 MB per running chat. 10
     parallel tasks are fine in one window. This is an estimate from the dev numbers
     without the dev tooling and the measure buffer; a packaged build was not measured.
   - **Dev session, with this fix:** about 2.4 GB idle (app 1.4 GB + dev tooling 1 GB),
     rising to about 3.3–3.5 GB with 10 busy chats. **Run at most 2 dev or agent
     Electron sessions at once**, and keep the person's own app outside that budget.
   - **Dev session, without this fix:** each session grew by about 250 MB per active
     minute until it was restarted. Any dev session older than this change should be
     restarted before parallel runs.
2. **Stop the idle OpenCode v1 engine once v2 serves the chats** (438 MB and about 1%
   CPU per app, all the time). It stayed up because v1 still answers reads and Stop for
   history it created (`docs/opencode-engine-migration.md`), the provider settings and
   some MCP reads. **Done behind `lazyV1Engine`** (on by default,
   `docs/features/lazy-v1-engine/README.md`): while v2 serves chats, v1 starts on the
   first request that needs it and stops after 10 idle minutes. **Expected saving about
   440 MB of PSS and ~1% CPU for as long as nothing uses v1, pending live verification**
   (re-measure the idle and 10-chat scenarios with `perf-sample.mjs`). Opening Settings,
   the Connections page or creating a workspace from the first chat still starts v1
   for 10 minutes.
3. **Renderer CPU in dev is high**: 60–90% of a thread with 10 chats. React's
   development profiling builds a props diff on every render, so much of this
   disappears in production. Still, with 10 stalled tasks and no turns, the renderer
   sat at 20–40% CPU. Worth a profile of what re-renders while tasks only show a
   working state, such as timers that tick every second in each running chat.
4. **Command center and results inbox** use TanStack Query intervals (15–60 s,
   `refetchInterval`), so the polls do not stack. Opening them with 10 tasks running
   changed neither memory nor CPU.
5. **Small unbounded maps in the server:** the per-key promise chains in
   `specialists/{tasks,datasets,panels,proposals}.ts`, `engine-registry.ts` and
   `openwork-runtime-config.ts` keep one settled promise per key and never delete it.
   They are bounded by the number of applications or paths, so they are not a leak
   today; delete settled entries if those keys ever become per-chat.
6. **Re-measure** with `scripts/dev-agent/perf-sample.mjs` (see the dev-agent toolkit
   skill) after engine or renderer changes, and keep the watchdog on
   (`--stop-below-mb 3072`).

---
name: dev-agent-toolkit
description: Launch an isolated OpenWork (Electron window or headless web) and drive it like a person over CDP - snapshot, real clicks, typing, keys, file uploads and downloads without native dialogs, page errors, background event log and host-level server API calls. Use to test, debug or reproduce anything in dev mode, by hand or as an AI agent.
---

# Dev agent toolkit

`pnpm dev:agent <command>` (source: `scripts/dev-agent/`). Every session is isolated
and owned: `down` stops only what that session started. Nothing touches your real
profile, your real history or another agent's processes.

## Start and stop

```bash
pnpm dev:agent up electron            # isolated Electron window: own profile (agent-<session>), mock keychain, free ports, CDP
pnpm dev:agent up web                 # headless web app in Chrome (world dev-app-web)
pnpm dev:agent status                 # sessions, CDP, PIDs, logs
pnpm dev:agent down --purge           # stop, delete the agent profile and session state
pnpm dev:agent up electron --session b   # several sessions side by side
```

What `up` fixes for you:

- **Wayland:** the window runs under XWayland
  (`OPENWORK_ELECTRON_OZONE_PLATFORM=x11`), so it is visible without enabling the
  desktop companion. Pass `--wayland` to keep native Wayland.
- **Engine v1 binary:** the server boots engine v1 first. When the `opencode` on
  PATH is v2, `up web` picks the desktop sidecar automatically.
- **Database:** when `tmp/dev-headless-opencode.db` is already a v2 database, the
  web session gets its own database instead of failing (or touching yours).
- **Event log:** a background watcher records console errors and warnings,
  exceptions and failed requests to `tmp/dev-agent/<session>/events.jsonl`.

## Look

```bash
pnpm dev:agent snapshot               # visible buttons, fields, tabs, menu items with role and label; route; open dialogs
pnpm dev:agent text "[role=dialog]"   # visible text of the page or an element
pnpm dev:agent shot tmp/dev-agent/x.png
pnpm dev:agent errors [--clear]       # JS errors, console errors/warnings, 5xx and network failures seen by the page
pnpm dev:agent events --tail 50       # background log since "up"
pnpm dev:agent logs                   # app log, event log and watcher log tails
```

## Act like a person

```bash
pnpm dev:agent click "Nueva aplicación"            # by visible text or aria-label: exact, then prefix, then substring
pnpm dev:agent click "Comex" --nth 1               # pick among several matches (see snapshot)
pnpm dev:agent fill "#specialist-user" "Ana"       # #id, CSS, or the field's label/placeholder; React-safe typing
pnpm dev:agent press Escape                        # Enter, Tab, ArrowDown, Control+K, Shift+a ...
pnpm dev:agent wait-text "Aplicación importada" --timeout 60
pnpm dev:agent go /workspace/<id>/session
pnpm dev:agent eval 'document.title'
```

Clicks and keys are real input events (CDP `Input.*`). Base UI menus open on
pointer events, so `element.click()` from `eval` is not reliable; use `click`.

## Files without native dialogs

```bash
pnpm dev:agent upload ./fixtures/app.openwork-app.json   # the next file picker the app opens receives this file
pnpm dev:agent click "Importar aplicación"
pnpm dev:agent download tmp/dev-agent/export.json -- "Exportar aplicación"   # click, then save what the app downloads
```

## Server API as the desktop host

```bash
pnpm dev:agent api GET /health
pnpm dev:agent api GET /specialist-applications
pnpm dev:agent api POST /specialist-applications/import '{"bundle":{...}}'
```

The Electron session reads the server address and tokens from the desktop bridge;
the web session reads them from `tmp/dev-headless-web.json`. Tokens are never printed.
Host routes work here, unlike the web UI, which only holds a collaborator token.

## Rules

- Never drive the person's own app window (`pnpm dev` on CDP 9823); start your own session.
- Anything sent to a model is real and leaves the machine. Prefer UI and API checks;
  send prompts only when the task needs them.
- Close what you open: `pnpm dev:agent down --purge` and check `pnpm dev:agent status`.
- For verdicts that CI keeps, write an `evals/` spec (`write-a-spec`); this toolkit is for
  exploring, debugging and reproducing.

## Develop the toolkit

`pnpm test:dev-agent` runs its unit tests (target choice, element matching, keys, banners,
engine and database detection, Electron platform flags). Add a command in
`scripts/dev-agent/devtool.mjs`; keep pure logic in `lib/` with a test.

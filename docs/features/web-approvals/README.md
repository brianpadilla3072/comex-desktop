# Approvals in the web app (`webApprovals`)

`openwork-server web` used to force `approvalMode: "auto"` because nothing in the web UI answered
approvals. Once remote devices can pair and get owner access, auto-approving every gated write
from any browser is the biggest gap. With this feature the web server keeps manual approvals and
the web app answers them.

## What was there

- `apps/server/src/approvals.ts` (`ApprovalService`) holds gated writes in memory. In `auto` mode
  it approves at once. In `manual` mode it waits for `respond()` or the timeout (default 30 s),
  then denies with reason `timeout`.
- `requireApproval` in `apps/server/src/server.ts` wraps about 20 write routes (skills, plugins,
  MCP, commands, permission mode, authorized folders, cloud plugins and so on). A denial throws
  `403 write_denied`.
- `GET /approvals` and `POST /approvals/:id` (`{ reply: "allow" | "deny" }`) live in
  `routes/operations.ts` with `"host"` auth: the host token or an **owner** bearer token. Paired
  devices get owner tokens (`remoteDevicePairing`), so they reach these routes without changes to
  pairing. Collaborator tokens get 401.
- There is no event stream for these approvals; a responder polls `GET /approvals`.
- The desktop app does **not** answer these approvals: Electron starts its embedded server with
  `approvalMode: "auto"` (`apps/desktop/electron/runtime.mjs`). The approval cards the desktop
  shows (`PermissionApprovalPanel`) are OpenCode tool permissions, a different system that already
  works in the web app because it goes through sessions.

## How it works now

- **Server default.** With `webApprovals` on, `openwork-server web` no longer forces auto, so the
  usual precedence applies: `--approval`, then `OPENWORK_APPROVAL_MODE`, then `server.json`, then
  `manual`. In web mode with manual approvals the timeout defaults to 120 s (a person reads the
  change) unless `--approval-timeout`, `OPENWORK_APPROVAL_TIMEOUT_MS` or `server.json` says
  otherwise. `--approval auto` and `OPENWORK_APPROVAL_MODE=auto` still approve everything. The
  logic lives in `applyWebApprovalDefault` and `resolveServerConfig` (`apps/server/src/config.ts`).
- **Responder presence.** Every owner `GET /approvals` marks a live responder. In web mode
  (`approval.responderWindowMs`, 15 s) a gated write with no responder seen in that window is
  rejected immediately with `403 approval_unavailable` and a message telling the person to open
  OpenWork with owner access or use `--approval auto`. Writes never sit until the timeout when
  nobody can answer. Other servers (no window set) behave as before.
- **Web app.** `WebApprovalsResponder` (`apps/app/src/react-app/domains/connections/web-approvals.tsx`)
  mounts on every route outside the desktop runtime. Every 3 s it reads `GET /status`; when the
  approval mode is `manual` it polls `GET /approvals`:
  - Owner access (host token or paired device): each pending write appears as a card at the bottom
    right with its summary, action and paths, and **Aprobar / Denegar**. An approval that already
    expired (404) just disappears; other failures keep the card and show an error.
  - Collaborator or read-only access (401/403): a dismissible notice says this connection cannot
    approve changes and suggests pairing the device. The connection's own gated writes get the
    clear `approval_unavailable` error unless an owner device is open.
  - Auto mode: nothing is shown.
- Text uses `t()` with `web_approvals.*` keys in English and Spanish.

## Flag

`webApprovals` (self-hosted, on by default; `DEN_FEATURE_WEB_APPROVALS=false` turns it off). Off,
`openwork-server web` returns to the old behavior: auto approvals unless
`OPENWORK_APPROVAL_MODE=manual` or `--approval manual`, and no responder window. The app's
responder needs no flag of its own: it only acts when the server reports manual mode.

## Tests

- `apps/server/test/web-approvals.test.ts`: web default with and without the flag, `auto`
  overrides, fail-fast without a responder, collaborator cannot list or answer, a paired device
  (owner bearer) approves and denies, the host token answers.
- `apps/app/tests/web-approvals.test.tsx`: the panel renders the change with approve/deny, nothing
  in auto mode, the read-only notice; the responder sends `allow` and `deny`, keeps the card on
  failure, and shows the notice to a collaborator connection.

## Limits

- Polling, not push: an answer can take up to one poll (3 s) to show up.
- A browser tab in the background may be throttled; after 15 s without a poll, new gated writes
  fail fast until the tab polls again.

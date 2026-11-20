# Web folder browser (`webFolderBrowser`)

Create local workspaces from the web app by browsing folders on the computer that runs the
OpenWork server.

## Why

The desktop app opens the operating system's folder picker. A browser cannot: it runs on another
device (a phone, a laptop over Tailscale) and has no access to the server's disk. Until now the
"Crear espacio de trabajo" dialog in the web app showed the local workspace card disabled, so a
paired device (owner access, see `docs/features/remote-device-pairing/README.md`) could not do
what the desktop does.

## How it works

- **Server** (`apps/server/src/folder-browser.ts`), both routes are `host` (owner) routes: the
  desktop host token or any owner token, including paired devices. The collaborator token the web
  page receives gets `401`.
  - `GET /folders/browse?path=<absolute>&hidden=1` lists the subfolders of `path` (the first root
    when omitted): `{ path, parent, root, roots, entries: [{ name, path, isGitRepo, hasOpencode }],
    truncated }`. Files, symlinks and (unless `hidden=1`) dot folders are left out. At most 500
    folders are returned, sorted by name; `truncated` says there were more. Reading stops after
    20,000 directory entries.
  - `POST /folders/browse` `{ parent, name }` creates one folder (`201 { path }`). The name must be
    a single segment without slashes, control characters, `.` or `..` (at most 255 bytes).
    Creation is limited to 30 folders per minute per server and respects `--read-only`.
- **Roots.** By default the server user's home directory plus every authorized root (the
  workspace folders already known to the server), so a workspace outside home stays reachable.
  `OPENWORK_FOLDER_BROWSER_ROOTS` (paths separated by `:`, or `;` on Windows) replaces that list.
  Nested roots collapse into their parent.
- **Containment.** Every path is resolved with `realpath` and must be a root or inside one. A
  symlink inside home that points elsewhere resolves outside and is refused (`403
  folder_outside_roots`), the same rule as `resolveWithinRoot` in `apps/server/src/paths.ts`.
  `..` segments are normalized before the check.
- **App.** `useWebFolderPicker` (`apps/app/src/react-app/domains/workspace/folder-browser-dialog.tsx`)
  probes `GET /folders/browse` once in the web runtime. When it answers, the local workspace card
  is enabled and "Elegir carpeta" opens the folder browser dialog (breadcrumbs, folder list,
  "Mostrar carpetas ocultas", "Crear carpeta", "Elegir esta carpeta") instead of the native
  picker. A collaborator connection keeps the card disabled with "Vincula este dispositivo…".
  The desktop keeps its native picker; nothing changes there. It is wired into the session
  route and the welcome route; the dialog renders inside the create-workspace dialog so the two
  nest.
- Specialist "Nuevo proyecto" already creates its folder on the server by name and needs no
  picker.

## Flag

`webFolderBrowser` (self-hosted, on by default). Off: both routes answer `404
web_folder_browser_disabled`, the probe fails and the web app shows the card disabled as before.

## Errors (stable codes)

`folder_path_invalid` (400, not absolute), `folder_not_directory` (400), `folder_outside_roots`
(403), `folder_unreadable` (403), `folder_not_found` (404), `folder_roots_unavailable` (404),
`folder_name_invalid` / `folder_name_too_long` (400), `folder_exists` (409),
`folder_create_failed` (403), `folder_create_rate_limited` (429).

## Tests

- `apps/server/test/folder-browser.test.ts`: default home root and authorized roots, hidden
  filtering, `..` traversal, symlink escapes (listing and creating), name validation, auth
  (collaborator 401, host token and paired device OK), flag off, `OPENWORK_FOLDER_BROWSER_ROOTS`,
  rate limiting, and the vectors in `contracts/folder-browser/v1/vectors.json`.
- `apps/app/tests/web-folder-browser.test.tsx`: breadcrumbs, navigating in and back, hidden
  folders, creating a folder, choosing, cancel, and the owner-access probe.

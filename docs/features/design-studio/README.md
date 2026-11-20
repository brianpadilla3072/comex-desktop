# Design studio (`designStudio`)

Create slides, screen mockups, design systems and whiteboards with the agent, as plain local files
inside the project. Nothing leaves the computer: no external design service, no external image
generation (illustrations are SVG written by the agent), no downloads.

## Format (shared contract)

`packages/types/src/designs.ts` (imported as `@openwork/types/designs`) defines the kinds
(`slides`, `mockup`, `system`, `board`), the folder layout, `design.json`, `tokens.json`,
`board.json`, limits and page sizes. A design is `<project>/proyecto/diseno/<designId>/`.

## Parts (each documented in its own section below by the agent that built it)

1. Base: server API, gallery, sandboxed viewer, thumbnails, HTML export.
2. Slides editor: thumbnails, add/reorder, present, export PDF / PPTX / PNG.
3. Comment and edit on the design.
4. Design system viewer and brand context for the agent.
5. Mockups and whiteboard (own SVG canvas).

## Base: API, gallery, design page, viewer and chat (part 1)

### Server (`apps/server/src/designs/`)

Reads are `"client"`, writes are `"host"`; everything answers `404 design_studio_disabled` while
`designStudio` (or specialist applications) is off. A design belongs to a project of a specialist
application, resolved like the Projects API (a live workspace bound to an application), and lives
in `<project>/<data>/diseno/<id>/` (`<data>` is `proyecto/`, or `comex/` in older projects).

| Route | Answer |
| --- | --- |
| `GET /designs[?workspaceId=]` | `{ designs: DesignSummary[], writable }`, newest first |
| `POST /designs` `{ workspaceId, kind, title }` | `201 { design }`: folder, manifest and the kind's template |
| `GET /designs/:ws/:id` | `{ design, writable, revision }` |
| `PATCH /designs/:ws/:id` `{ title?, systemId? }` | `{ design }`; `systemId` must be a `system` design of the same project |
| `DELETE /designs/:ws/:id` | `{ ok: true }` (folder and its chat bindings) |
| `GET /designs/:ws/:id/files?path=` | raw file, typed by extension, with the strict CSP and `nosniff` |
| `PUT /designs/:ws/:id/files?path=` raw body | `{ ok, design }` |
| `POST /designs/:ws/:id/pages` `{ title?, afterPageId?, html? }` | `201 { design }` |
| `PATCH /designs/:ws/:id/pages/:pageId` `{ title?, notes? }` | `{ design }` (`notes: null` removes them) |
| `PUT /designs/:ws/:id/pages/order` `{ pageIds }` | `{ design }` (the same set, each once) |
| `DELETE /designs/:ws/:id/pages/:pageId` | `{ design }` (the page file goes too; the last page stays) |
| `PUT /designs/:ws/:id/thumbnail` PNG body | `{ ok, design }` (`thumbnail.png`) |
| `GET /designs/:ws/:id/export?format=html` | zip: the folder under `<id>/` plus `index.html` |
| `GET` and `POST /designs/:ws/:id/chats` `{ sessionId }` | `{ sessions }`: chats bound to the design, newest first |

- Ids: the title as a slug (`plan-de-lanzamiento`, then `-2`, `-3`…); pages are `p-<n>`. Pure rules
  in `core.ts`, pinned by `contracts/designs/v1/vectors.json`.
- Templates (`templates.ts`): slides start with a clean 1920×1080 cover, mockups with a
  1440×900 screen, a system with `tokens.json` and an overview page, a board with `board.json`
  (one frame) and its backdrop page.
- Safety (`store.ts`): paths pass `designRelativePathSchema`, `resolveSafeChildPath` and a check
  that no existing segment is a link; a design folder that is a link (or leaves the project after
  `realpath`) is refused. `DESIGN_LIMITS` caps page, asset, folder, page count and designs per
  project. `board.json` and `tokens.json` are validated with their schemas before they land.
  `design.json` written as a file must be a valid manifest of the same design (same `id` and
  `kind`); `createdAt` is kept. Every manifest read goes through `designManifestSchema`; writes are
  serialized per design (`withFileLock`) and atomic; `updatedAt` always moves forward.
- `revision` is the newest modification time of the design's pages and assets (not `design.json`
  nor `thumbnail.png`), so an open page notices the agent's edits without re-rendering for a new
  preview.
- `registerDesignRoutes` returns `{ loadDesign, resolveDesign }` for the export routes.

### Agent guidance (`guidance.ts`)

When the design page starts a chat it binds the session to the design (`POST …/chats`; bindings
in `<data>/diseno/chats.json`). On every prompt of a bound session the server adds a `design`
instruction entry (v2 engine, next to the project's own entry): folder, `design.json` format, one
self-contained HTML per page, `styles.css` and `assets/` with relative references only, no network,
SVG illustrations, the kind's page size, board and token file rules, and the design system it
follows. The brand context comes from `system-context.ts` (design-system part); this branch ships
a stub with the same signature that returns null.

### App

- Client methods in `openwork-server.ts` (`listDesigns`, `createDesign`, `getDesign`,
  `updateDesign`, `deleteDesign`, `readDesignFile`, `writeDesignFile`, `addDesignPage`,
  `updateDesignPage`, `reorderDesignPages`, `deleteDesignPage`, `putDesignThumbnail`,
  `exportDesignHtml`, `listDesignChats`, `bindDesignChat`); response schemas and helpers in
  `app/lib/designs.ts`.
- Routes `/design` (gallery) and `/design/:workspaceId/:designId` (design page), registered like
  `/projects`; reachable while the flag is unknown, sent home once the server says it is off. The
  sidebar and the compact rail show "Diseño" after Proyectos.
- Gallery: "Crea algo nuevo" tiles (project and title in a small dialog), Todos / Este proyecto,
  search (accents ignored), grid or list, cards with the captured preview or the kind's mark,
  honest loading, error, empty and read-only states (with the pairing hint).
- Design page: title (click to rename), "Presentar" for slides (increments the editor's
  `presentSignal`), export menu (HTML now; other formats arrive as `DesignExportSlot`s),
  "Mostrar chat" / "Ocultar chat", and the kind's editor from `editors/index.ts`. Every kind uses
  the placeholder editor (page list and page) until its own editor is wired in. Editors get
  `{ workspaceId, design, writable, client, onChanged, chatOpen, onAskAgent, revision, reloadKey,
  onToggleChat?, presentSignal? }`.
- `DesignFrame` renders a page in an iframe with `sandbox="allow-same-origin"` and **no**
  `allow-scripts`: nothing in the page runs, and the app can still read the frame's DOM (the
  comment/edit picker needs it). `buildFrameDocument` reads the page through the server, inlines
  linked stylesheets, turns relative images into blob URLs and fonts into data URLs, drops
  absolute references and event handler attributes, and adds the same CSP as a `<meta>` in
  `<head>`; the body keeps its structure. It reloads on `reloadKey`, calls `onFrameReady` after
  every load and scales to fit unless `scale` is given.
- Chat: the design page hosts a side chat. The route (`session-route.tsx`) gives it the app's own
  new-session composer for the first message and the side pane's session surface
  (`EmbeddedSessionSurface`) for the conversation; while a design page is open the route's surface
  props use that chat's session. Editors call `onAskAgent(text, context)`: it opens the chat,
  starts (and binds) one when there is none, or sends to the current one.
- Thumbnails: `setDesignThumbnailCapturer` (desktop renderer) captures the first page after the
  design settled (2.5 s after a `revision` change) and stores it with `putDesignThumbnail`. On the
  web nothing is registered and the gallery shows the kind's mark.
### A new design when there is no project yet

A design lives in a project, and a project in a specialist application. The "Nuevo diseño" dialog
never sends the person away to find one:

- **An application exists, no project:** the dialog shows "Proyecto nuevo" (default "Diseños") and
  creates the project and the design in one step. If the design then fails, a retry reuses that
  project instead of making another.
- **No application yet:** the dialog says what is missing and offers "Crear aplicación". The
  application form opens with `returnTo` (`SpecialistApplicationsProvider.create({ returnTo })`).
  After saving, it comes back to `/design?new=<kind>` instead of the new workspace's chat. The new
  application brings its "Principal" project, and the dialog reopens for the chosen kind.
  "Configurar después" just closes the form.

![No application yet](new-design-needs-application.png)

## Design system viewer and brand context (part 4)

### Editor (`apps/app/src/react-app/domains/design/editors/system-*`)

`SystemEditor` (`system-editor.tsx`) is the editor of kind `system`. It takes the registry props
(`workspaceId`, `design`, `writable`, `client`, `onChanged`, `chatOpen`, `onAskAgent`) plus an optional
`frame`, the sandboxed page viewer (`DesignFrame`) used for component previews; without it a preview
shows the component's file. The client only needs `readDesignFile` and `writeDesignFile`.

- Left navigation with search: Overview, Colores, Tipografía, Espaciado, Radios, Sombras, Degradados,
  Layout, Componentes, Recursos, Archivos, each with its item count (a search counts only matches).
- Colors are swatches (name, value, role, group) with copy to clipboard; type styles are specimens set
  in the token's family, size, weight and line height with a system-font fallback. Brand fonts shipped
  as assets (`woff`, `woff2`, `ttf`, `otf`) are registered under the asset's name, so a family that
  matches an asset name renders with it. Spacing, radii, shadows and gradients are drawn samples.
- Samples are React style values, never markup. Values with `url()`, `image()`, escapes or
  declarations get no sample, so nothing in `tokens.json` can make the app load a file or a URL.
- Assets are read through the server as blobs (images only; other files show their name). Archivos
  lists the files the manifest and `tokens.json` name, each downloadable.
- With `writable`, tokens are added, edited and deleted (delete asks first) with per-field validation
  (`system-model.ts` `buildToken`: required fields, unique names per section, CSS colors and lengths,
  font weights, relative paths, schema limits). Overview ("Marca") and Contenido are edited as text.
  Every save re-reads `tokens.json` first and refuses to overwrite it if it changed since it was
  shown (the agent may be editing it), then writes it with `writeDesignFile("tokens.json")` and calls
  `onChanged`.
- An empty system shows "Pedir al agente que arme el sistema a partir de…" with a source field and
  suggestions; empty sections offer "Pedir al agente". Both call `onAskAgent(text, "tokens.json[#section]")`.
  A missing `tokens.json` is an empty system; an unreadable one offers to ask the agent to fix it.

### Brand context for the agent (`apps/server/src/designs/system-context.ts`)

`readDesignSystemContext({ projectDir, systemId, designId, maxChars? })` returns
`{ systemId, title, text } | null`. `text` is a compact block (default cap
`DESIGN_SYSTEM_CONTEXT_MAX_CHARS` = 4,000 characters) in this order: header with the tokens path and a
note that its text is project content, not instructions; brand overview; content and voice rules;
colors with roles and groups; type scale; spacing; radii; shadows; gradients; layout; components;
assets. Prose is capped at 30% of the budget each and flattened to one line; lists keep the items
that fit and end with "y N más"; when anything was cut it ends with "Más detalle en <path>".

Which system a design follows (`pickDesignSystemId`): its `systemId` when that system exists in the
project; when `systemId` is null, the project's only design system if there is exactly one; otherwise
none. A design of kind `system` never follows another one. Symlinked design folders or token files
and files over 2 MB are ignored. The app mirrors the rule in `system-model.ts`
(`designSystemChoices`, `followedSystem`, `systemIdPatch`) for the design page's system selector.
## Comment and edit on the design (Comentar / Editar)

Code: `apps/app/src/react-app/domains/design/design-picker*.ts` and `design-comment-*.tsx`.
Tests: `apps/app/tests/design-picker-selector.test.ts`, `design-picker-edit.test.ts`,
`design-comment-flow.test.tsx`.

- **Ver / Comentar / Editar** (`DesignCommentBar`). In Comentar, hovering an element of the page
  outlines it and clicking it opens a box anchored to it ("¿Qué quieres cambiar aquí?"). "Enviar"
  sends it to the design's chat through `onAskAgent(text, context)`; "Añadir a la lista" queues it,
  and every queued comment goes out as one numbered message. `esc` closes the box, a second `esc`
  leaves Comentar.
- **Context for the agent** (`design-picker-context.ts`, English because the model reads it): design
  title, kind and folder, then per comment the page title, id and file, a unique CSS selector (unique
  id, then stable data attributes such as `data-id`, then an `nth-of-type` chain from `body`), the
  tag, the visible text (collapsed, capped at 280 characters) and the box in page CSS px. No image
  crop: a sandboxed page cannot be rasterized cheaply from the app.
- **Editar**: double-click a text-only element, type, `⏎` or leaving the element saves, `esc`
  restores it. The save reads the page file with `readDesignFile`, splices the escaped text into the
  source (every other byte unchanged, checked by re-parsing; full re-serialization only if the check
  fails) and writes it with `writeDesignFile`. The live frame document is never serialized, so the
  picker's outline styles and `contenteditable` never reach disk. Text only: typed or pasted markup
  is stored as characters; paste and drop insert plain text. Undo (button or `Ctrl/⌘+Z` in Editar)
  writes the previous file back, and refuses if the file changed since the edit (the agent may have
  rewritten it). Elements with child elements are not editable in place: the bar suggests Comentar.
  Read-only designs keep Editar visible and locked.
- **Frame transports** (`design-picker-transport.ts`), picked from the iframe's `sandbox`:
  - `same-origin` (recommended): `sandbox="allow-same-origin"` without `allow-scripts`. The page
    runs no script; the app attaches the picker to `iframe.contentDocument` and re-attaches on every
    `load`. Nothing is injected into the page.
  - `post-message`: `sandbox="allow-scripts"` without `allow-same-origin`. The frame must run
    `DESIGN_PICKER_SCRIPT` (`withDesignPickerScript(html)` adds it before `</body>`), and a page CSP
    must allow it with the hash from `designPickerScriptHash()`. Messages carry
    `channel: "openwork-design-picker"`; the app accepts only messages whose `source` is that frame
    and that pass the zod schema.
  - Never both `allow-scripts` and `allow-same-origin`: the page could lift its own sandbox.
  The picker runtime (`design-picker-runtime.ts`) is one self-contained function used by both: the
  script is that function's source, so it must keep no imports and no outer references.

Editors mount it like this:

```tsx
const picker = useDesignPicker({ workspaceId, design, client, writable, onAskAgent, onChanged });
<DesignCommentBar picker={picker} />
<DesignFrame workspaceId={workspaceId} designId={design.id} page={page} interactive
  onFrameReady={picker.bindFrame(page)} reloadKey={reloadKey} />
```

`bindFrame(page)` is stable per page id, so several frames (screens of a mockup) can be bound at
once. `onChanged` must make the frame reload from disk after a save or an undo.
## Slides editor and exports (PDF, PPTX, PNG)

Files: `apps/app/src/react-app/domains/design/editors/slides-*`, `apps/server/src/designs/export-pptx.ts`,
`apps/server/src/designs/export-routes.ts`, `apps/desktop/electron/design-render.mjs`.

**Editor** (`SlidesEditor`, registry props plus optional `onToggleChat` and `presentSignal`):
thumbnails on the left (a scaled, non-interactive `DesignFrame` each), the selected slide at
16:9 with zoom (fit or 25–200 %), speaker notes under it, and a toolbar.

- Add: a slide from a template (blank, title, title and content, two columns) through
  `addDesignPage` with the template HTML, or "Pedir al agente" (`onAskAgent` with the position).
- Duplicate (reads the page, adds it after, copies the notes), delete (confirmation; the last
  slide stays), reorder by drag and drop or `Alt+↑/↓` on a focused thumbnail (`reorderDesignPages`,
  optimistic, restored on failure). `↑/↓`, `Home/End` move the selection; `Delete` deletes.
- Speaker notes are `pages[].notes` in `design.json`: the editor re-reads `design.json`, changes
  only that page's notes (validated with `designManifestSchema`) and writes it back with
  `writeDesignFile`, 800 ms after typing stops and on blur.
- Text, table and shapes (rectangle, ellipse, arrow) insert a small absolutely positioned block
  marked `data-ow-element` right before `</body>` of the selected page. Images are uploaded to
  `assets/<name>-<suffix>.<ext>` (PNG, JPG, GIF, WebP, SVG, up to 20 MB) and inserted as `<img>`.
- Presentation mode: full screen, `→ ↓ space PageDown` next, `← ↑ PageUp` previous, `Home/End`,
  `Esc` exits; slide counter; a click advances.

**Exports** (`slides-export.ts`: `exportPdf`, `exportPng`, `exportPptx`). Every page is first
made self-contained (`slides-inline.ts`): the shared stylesheet and every asset inside the design
folder are inlined as `data:` URLs and a strict CSP (`default-src 'none'`) is added.

- PDF, desktop: `designRender` IPC → `design-render.mjs` loads one wrapper document (a sandboxed
  `srcdoc` iframe per page) in a hidden offscreen `BrowserWindow` (sandbox, context isolation, no
  Node, no preload, no devtools, in-memory partition whose request filter cancels everything but
  the page file and `data:`/`blob:`/`about:`; permissions denied; popups and navigation refused)
  and calls `printToPDF` at the exact page size (1920×1080 px = 20×11.25 in, no margins). Renders
  run one at a time, each load has a 30 s timeout, and the temporary page file is removed
  afterwards. Only the app window's main frame may call it.
  Web: a print document (same iframes, `@page` at the slide size) and the browser's print dialog.
- PNG, desktop: the same renderer, one page at a time, `capturePage` (the offscreen paint event as
  fallback). Web: the page as SVG `foreignObject` drawn on a canvas. Limits of the web path:
  scripts in the page do not run, and only inlined assets show.
- PPTX: the app renders the PNGs (as above) and sends them to `POST /designs/:ws/:id/export`
  as JSON `{ format: "pptx", slides: [{ pageId, png }] }` (base64, no `data:` prefix, in slide
  order). JSON instead of multipart keeps the route simple; the caps keep it bounded: up to 200
  slides, 8 MiB per decoded PNG, 160 MiB per request (checked on `content-length` and while
  reading). Titles and notes come from `design.json`, never from the request. The route is a
  `client` route (it writes nothing) behind `designStudio` (404 `design_studio_disabled`); `pdf`
  and `png` answer 422 `design_export_client_side`. Other errors: `design_export_invalid`,
  `design_export_unknown_page`, `design_export_not_slides`, `design_export_invalid_png`,
  `design_export_too_large` (413).
  `export-pptx.ts` builds a 16:9 OOXML package with `fflate`: content types, package and part
  relationships, core/app properties, presentation, one master and one "title only" layout, a
  notes master, two themes, presentation/view properties and table styles. Per slide: a title
  placeholder with the page title (outline, search and screen readers; the picture covers it),
  the PNG as a full-bleed picture (contained and centered when it is not 16:9; alt text = title)
  and a notes page with the speaker notes.
## Screens and whiteboard editors (part 5)

Both editors live in `apps/app/src/react-app/domains/design/editors/` and take the registry props
(`workspaceId`, `design`, `writable`, `client`, `onChanged`, `chatOpen`, `onAskAgent`) plus an
optional `reloadKey` that changes when the design's files changed outside the editor.

### Screens (`mockup-editor.tsx`, kind `mockup`)

- Screen list (`mockup-screens.tsx`): add from a template (`mockup-templates.ts`: blank, landing,
  form, dashboard, list; self-contained responsive HTML with neutral sample text) or ask the agent
  for one; rename (double-click or menu), move up/down (menu or Alt+↑/↓), duplicate, delete
  (confirmed). Adds go through `addDesignPage`, order through `reorderDesignPages`, deletes through
  `deleteDesignPage`. Renaming uses `updateDesignPage` when the client has it; otherwise it writes a
  `designManifestSchema`-validated `design.json` with `writeDesignFile`.
- Canvas: the screen in `DesignFrame` with zoom steps or "Ajustar", and a width toggle (Escritorio
  1440, Tableta 834, Celular 390) that passes the page at that width, so the document re-lays out
  at the new viewport (`mockup-model.ts` `pageAtWidth`).
- "Presentar" (`mockup-present.tsx`): full screen at the chosen width; ←/→ (also PageUp/PageDown,
  space, Home/End) move, Esc leaves.
- The comment/edit bar (part 3) mounts in the toolbar and binds to the main screen's frame; its
  edits bump the frame's reload key.

### Whiteboard (`board-editor.tsx`, kind `board`)

An own SVG canvas over `board.json` (`boardSchema`); no drawing library.

- Model (`board-model.ts`, pure): create, move, resize (paths scale their points), rotate,
  duplicate (frames with their children), delete (a frame takes its children), arrange, style,
  marquee, hit testing, Ramer–Douglas–Peucker pen simplification, viewport math, deterministic text
  wrapping and an undo history of 100 steps. Frames are not nested; an element belongs to the frame
  that contains its center (`frameId`) and moves with it.
- Tools (`board-toolbar.tsx`, `role="toolbar"` with arrow-key focus): Seleccionar V, Mano H, Marco
  F, Texto T, Nota N, Lápiz P, Rectángulo R, Elipse O, Imagen I. Shift+click and marquee
  multi-select; space+drag, middle button or wheel/trackpad pan; Ctrl/⌘+wheel, Ctrl/⌘ +/−/0,
  Shift+1 (fit) and Shift+2 (selection) zoom; Ctrl/⌘+Z, Shift+Z or Y undo/redo; Ctrl/⌘+D
  duplicate; Supr/Backspace delete; arrows nudge (Shift ×10); `]`/`[` (Shift: to front/back);
  Enter edits text. Tooltips show each shortcut.
- Images come from the design folder (`assets/`) as blob URLs; uploads are written to
  `assets/<name>-<suffix>.<ext>` with `writeDesignFile` (PNG, JPG, GIF, WebP, SVG; asset size cap).
- Per frame: "Ampliar" fits the view to it; "Descargar PNG" serializes the frame's SVG
  (`board-svg.ts`, the same drawing description the canvas renders), inlines its images as data
  URLs, rasterizes it in a canvas at 2× and downloads it. Nothing is loaded from the network.
- Saving: 600 ms after the last change, validated by `boardSchema` and capped at
  `DESIGN_LIMITS.boardElements`. When `reloadKey` or the design's `updatedAt` changes, board.json is
  read again: an outside change (the agent) replaces the board, keeps the selection and can be
  undone; our own save coming back is ignored. A board.json without a `viewport` opens fitted to
  its content. Large boards (over 300 elements) render only what is in view.
- "Pedir al agente" sends the request with a context (`board-agent.ts`): the board path, the
  numbered frames with ids and bounds, and the selection.

#### What the agent must do with a board (for the design guidance)

- Edit `board.json` as a whole valid document (`format: "openwork.board"`, `version: 1`); keep
  existing elements and ids, give new elements new unique ids (up to 64 characters), at most 5000
  elements.
- Types: `frame` (`title`, "<n> · <name>"), `rect`, `ellipse`, `text` and `sticky` (`text`),
  `path` (`points` relative to `x`, `y`), `image` (`src`).
- Illustrations are self-contained SVG files written to `assets/<name>.svg` (no external
  references, no scripts, no web fonts) and placed with
  `{ "type": "image", "src": "assets/<name>.svg", x, y, width, height, frameId }`.
- An element inside a frame has `frameId` set to the frame's id and its center inside the frame.

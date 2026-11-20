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

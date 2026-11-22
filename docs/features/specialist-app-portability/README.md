# Specialist application portability (export, import, delete)

Feature key: `specialistAppPortability` (self-hosted, on by default). Turn it
off with `DEN_FEATURE_SPECIALIST_APP_PORTABILITY=false`; the routes answer 404
and the menu entries disappear.

## Why

- A person moves to another computer and wants the same application: its
  identity, agents and skills, context, project memory and session summaries.
- Comercio Exterior was preselected for the first application, so people chose
  it without meaning to, and nothing could remove it afterwards.

## Model

An application owns:

| Part | Where it lives | Exported |
| --- | --- | --- |
| Profile (name, specialty, personality, template) | `profiles.sqlite` | yes |
| Library (agents, skills, scripts, references) | `specialists/<app>/pack/` | yes |
| Context | `specialists/<app>/context.md` | yes |
| Scheduled tasks | `specialists/<app>/tasks.json` | yes, imported **paused** |
| Projects (workspaces) | `specialist_projects` + project folders | yes, see below |
| Project data folder (`comex/` or `proyecto/`) | inside each project | yes, whole folder |
| Project work files (documents, spreadsheets, drafts) | inside each project | yes in `.owapp` archives (`specialistAppZipBundle`) |
| Task run logs, proposals, tool plugins | `specialists/<app>/` | no (machine state) |
| Provider keys and integration logins | per-provider credential stores | **never** |
| Engine chat history | OpenCode database | no; session summaries travel instead |

The project data folder holds `estado.md` (project memory), `sesiones/<id>.md`
(session summaries), datasets, sources, outputs and artifacts. Exporting the
whole folder means any family that stores its data there travels without
changes to the exporter.

## Bundle format

With `specialistAppZipBundle` on (the default), export writes a `.owapp` ZIP
archive (version 2): `manifest.json` plus real file entries under `library/`,
`projects/<i>/` and `work/<i>/`, with no base64. It is streamed, size-capped and
checksum-verified, and it also carries the project's work files. See
`../specialist-app-zip-bundle/README.md`. Import accepts both versions. The v1
JSON bundle below is still what export writes with the flag off, and what
`?format=json` returns.

```json
{
  "format": "openwork.specialist-application",
  "version": 1,
  "exportedAt": "2026-11-19T12:00:00.000Z",
  "application": { "name": "...", "specialty": "...", "personality": "...", "template": "custom" },
  "sections": {
    "library": { "files": [{ "path": "agents/x.md", "encoding": "utf8", "content": "..." }] },
    "context": { "content": "..." },
    "tasks": { "tasks": [] },
    "projects": { "projects": [{ "name": "Principal", "dataDir": "proyecto", "files": [] }] }
  }
}
```

- Every section is produced and consumed by one entry of a section registry
  (`apps/server/src/specialists/portability/sections.ts`). A new family adds
  one entry; the bundle core does not change.
- Unknown sections are skipped and reported back, so an older app can open a
  newer file. A bundle `version` above the supported one is rejected.
- Files are `utf8` text or `base64` binary, with relative paths only: no
  absolute paths, `..`, hidden files or symlinks. v1 limits: 2,000 files and
  50 MB per bundle, 5 MB per file. `.owapp` limits: 10,000 files, 200 MB and
  50 MB per file. Every limit lives in `LIMITS` (`portability/bundle.ts`).

## Import

1. Validate the whole bundle before writing anything.
2. Create a new application with a fresh id. A name clash gets a suffix
   (`Comex (importada)`, `Comex (importada 2)`).
3. Library files go through the same checks as importing a pack folder.
4. Each project becomes a new folder under the application
   (`specialists/<app>/projects/<uuid>`) and a new workspace; its data folder
   is restored on top of the fresh project, and the work files of a `.owapp`
   archive go into the project folder.
5. Tasks are created paused, so nothing runs before the person reviews it.

If any step fails, the half-imported application is deleted.

## Delete

- Removes the profile, its bindings and `specialists/<app>/`, including the
  projects that live inside it, and removes those workspaces from the sidebar.
- Projects that live elsewhere (an adopted folder) keep every file; only the
  binding marker `.opencode/specialist-application.json` is removed, and the
  workspace stays as an ordinary one.
- If it was the active application, another one becomes active, or none.
- The UI asks for confirmation and offers to export first.

## First application

With the flag on, the first-application form starts empty with "Otra
especialidad" selected. Comercio Exterior stays one click away, and
"Importar aplicación" loads a bundle instead.

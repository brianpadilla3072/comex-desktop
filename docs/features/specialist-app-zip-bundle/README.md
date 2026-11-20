# Specialist application archives (`.owapp`)

Feature key: `specialistAppZipBundle` (self-hosted, on by default). It extends
`specialistAppPortability` (see `../specialist-app-portability/README.md`).
Turn it off with `DEN_FEATURE_SPECIALIST_APP_ZIP_BUNDLE=false`: export goes
back to the v1 JSON bundle, and the server refuses archive uploads with
`415 application_archive_disabled`. v1 JSON bundles import either way.

## Why

- The v1 JSON bundle inlined every file as text or base64 and was capped at
  50 MB. That is too small for real documents, and the whole bundle had to be
  held in memory on both ends.
- Only the project's data folder travelled. The work itself (spreadsheets,
  PDFs and drafts in the project folder) stayed behind when a person moved to
  another computer.

## Format

A ZIP file with the `.owapp` extension (`<Application name>.owapp`):

```
manifest.json            format, version 2, exportedAt, application, sections, files[]
library/<path>           agents, skills, scripts
projects/<i>/<path>      data folder of project i (proyecto/ or comex/)
work/<i>/<path>          work files of project i, relative to the project root
```

`manifest.files` lists every other entry with its `size` and `sha256`.
Section metadata (`context`, `tasks`, project names, work files that were too
large to travel) lives in `manifest.sections`. Schema: `manifestSchema` in
`apps/server/src/specialists/portability/index.ts`; vectors in
`contracts/specialist-app-bundle/v2/vectors.json`.

## Work files

Work files are everything in each project folder except:

- hidden entries (`.opencode`, `.git`, `.venv`, `.openwork`, caches) and
  symlinks;
- `node_modules` and `__pycache__`;
- the data folder, which already travels in `projects/`.

A single file over the per-file limit does not block the export. It is listed
in `sections.workFiles.skipped`, and the import adds a warning naming it.
After an import, every source whose evidence file did not travel (for example
one kept in a hidden file) also produces a warning.

## Security and limits

All limits live in `LIMITS` (`portability/bundle.ts`): 10,000 files, 200 MB
uncompressed, 50 MB per file, a 220 MB upload, an 8 MB manifest, and a 100:1
compression ratio for entries over 1 MB.

Before any application data is written, the import:

1. Streams the upload to a scratch folder on disk with a byte cap. The scratch
   folder is `specialists/.portability/`, not the RAM-backed temp folder.
2. Parses the central directory. It rejects ZIP64, encryption, methods other
   than stored or deflate, non-UTF-8 names, parent, absolute, drive-letter or
   backslash paths, hidden segments, symlinks and other special entries,
   duplicates, and entries over the size, total or ratio limits.
3. Validates `manifest.json` with zod and checks that the index matches the
   entries exactly.
4. Inflates each entry into a private staging folder. Output past the
   declared size aborts at once, and each entry's CRC-32 and SHA-256 are
   checked.

Only then does the normal flow run: prepare every section, then apply. A
failure removes the half-imported application, and the scratch folder is
always removed.

Export writes the archive to the scratch folder with fflate's streaming `Zip`.
Already-compressed formats (`.pdf`, `.xlsx`, images) are stored, not
deflated. The archive is then streamed to the client and deleted. Nothing
holds the archive in memory. The Rust equivalent is the `zip` crate.

## HTTP

- `GET /specialist-applications/:id/export` returns `application/zip` with
  `Content-Disposition` (`?format=json` returns the v1 bundle).
- `POST /specialist-applications/import` takes `Content-Type: application/zip`,
  the raw archive as the body, and `?userName=` for a first application.
  A JSON body is the v1 path.
- The catalog reports `zipBundleEnabled`.

## UI

Export downloads `<Name>.owapp`. The import picker accepts
`.owapp,.zip,.json` and tells the kinds apart by content. An archive is
uploaded as a `Blob` and never read into memory.

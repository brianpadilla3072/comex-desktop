import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiError } from "../src/errors.js";
import { readCitation } from "../src/specialists/sources.js";
import { registerLocalSource } from "../src/specialists/sources.js";

const longSentence = "La exportación de soja creció un tres por ciento en el último trimestre medido por la Bolsa de Comercio. ";

test("a local text file becomes a citable source with stable anchors", async () => {
  const root = await mkdtemp(join(tmpdir(), "specialists-local-source-"));
  try {
    const content = longSentence.repeat(12);
    await mkdir(join(root, "datos"), { recursive: true });
    await writeFile(join(root, "datos", "informe.md"), content);
    const source = await registerLocalSource(root, { path: "datos/informe.md" });
    assert.equal(source.provider, "file");
    assert.equal(source.title, "informe.md");
    assert.match(source.evidencePath, /^comex\/fuentes\/local\//);
    // Snapshot: changing the original afterwards doesn't move the citation.
    await writeFile(join(root, "datos", "informe.md"), "otro texto");
    const cited = await readCitation(root, source.id, 1);
    assert.equal(cited.ok, true);
    if (cited.ok) assert.match(cited.text, /soja/);
    // Files live in the workspace, citable like research evidence.
    const onDisk = await readFile(join(root, source.evidencePath), "utf8");
    assert.equal(onDisk, content);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("local sources fail loud on traversal, symlinks, formats and size", async () => {
  const root = await mkdtemp(join(tmpdir(), "specialists-local-source-neg-"));
  try {
    await writeFile(join(root, "ok.md"), longSentence.repeat(3));
    const failureStatus = (error: unknown, code: string) => error instanceof ApiError && error.code === code;
    await assert.rejects(registerLocalSource(root, { path: "../secreto.md" }), (e) => failureStatus(e, "invalid_source"));
    await assert.rejects(registerLocalSource(root, { path: "/etc/passwd.md" }), (e) => failureStatus(e, "invalid_source"));
    await assert.rejects(registerLocalSource(root, { path: "comex/fuentes/x.md" }), (e) => failureStatus(e, "invalid_source"));
    await assert.rejects(registerLocalSource(root, { path: "no-existe.md" }), (e) => failureStatus(e, "invalid_source"));
    await writeFile(join(root, "doc.pdf"), "%PDF-falso");
    await assert.rejects(registerLocalSource(root, { path: "doc.pdf" }), (e) => failureStatus(e, "invalid_source"));
    await mkdir(join(root, "dir.md"), { recursive: true });
    await assert.rejects(registerLocalSource(root, { path: "dir.md" }), (e) => failureStatus(e, "invalid_source"));
    const outside = join(root, "..", "fuera");
    await writeFile(join(outside, "x.md"), longSentence.repeat(3)).catch(async () => { await mkdir(outside, { recursive: true }); await writeFile(join(outside, "x.md"), longSentence.repeat(3)); });
    await symlink(join(outside, "x.md"), join(root, "link.md"));
    await assert.rejects(registerLocalSource(root, { path: "link.md" }), (e) => failureStatus(e, "invalid_source"));
    assert.equal((await readdir(join(root, "comex", "fuentes", "local")).catch(() => []) as string[]).length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readArtifact, writeArtifact } from "../src/specialists/artifacts.js";
import { runDocTool } from "../src/specialists/doc-tools.js";
import { docFind, docOutline, docWrite } from "../src/specialists/doc-model.js";

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "doc-tools-"));
  await mkdir(join(root, "proyecto"), { recursive: true });
  return root;
}

const SAMPLE = "# Informe\n\nIntroducción.\n\n## Datos\n\nSoja 2024.\n\n## Conclusiones\n\nCerrar.\n";

async function newDoc(root: string, title = "Informe") {
  const created = await runDocTool(root, "specialist_doc_create", { title, content: SAMPLE }) as { artifactId: string };
  return created.artifactId;
}

async function rejectsCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => Reflect.get(error as object, "code") === code);
}

test("doc tools create, list, read with outline and export a real artifact", async () => {
  const root = await workspace();
  try {
    const id = await newDoc(root);
    const list = await runDocTool(root, "specialist_doc_list", {}) as { docs: Array<{ id: string; format: string }> };
    assert.equal(list.docs.length, 1);
    assert.equal(list.docs[0]!.id, id);
    assert.equal(list.docs[0]!.format, "md");

    const read = await runDocTool(root, "specialist_doc_read", { artifactId: id, start: 5, end: 5 }) as {
      totalLines: number; lines: Array<{ line: number; text: string }>; outline: Array<{ text: string; line: number }>;
    };
    assert.equal(read.totalLines > 5, true);
    assert.deepEqual(read.lines, [{ line: 5, text: "## Datos" }]);
    assert.deepEqual(read.outline.map(entry => entry.text), ["Informe", "Datos", "Conclusiones"]);

    const exported = await runDocTool(root, "specialist_doc_export", { artifactId: id }) as { content: string; format: string };
    assert.equal(exported.content, SAMPLE);
    assert.equal(exported.format, "md");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("doc write modes insert at headings and create versions", async () => {
  const root = await workspace();
  try {
    const id = await newDoc(root);
    const appended = await runDocTool(root, "specialist_doc_write", { artifactId: id, mode: "append", content: "## Anexo\n\nFin." }) as { changed: boolean; version: string };
    assert.equal(appended.changed, true);
    assert.match(appended.version, /^v\d+$/);

    const before = await runDocTool(root, "specialist_doc_write", { artifactId: id, mode: "before", heading: "Datos", content: "Nota previa." }) as { changed: boolean };
    assert.equal(before.changed, true);
    let read = await runDocTool(root, "specialist_doc_read", { artifactId: id, limit: 500 }) as { lines: Array<{ text: string }> };
    const texts = read.lines.map(line => line.text);
    assert.ok(texts.indexOf("Nota previa.") < texts.indexOf("## Datos"));

    const after = await runDocTool(root, "specialist_doc_write", { artifactId: id, mode: "after", heading: "Datos", content: "Dentro de Datos." }) as { changed: boolean };
    assert.equal(after.changed, true);
    read = await runDocTool(root, "specialist_doc_read", { artifactId: id, limit: 500 }) as { lines: Array<{ text: string }> };
    const afterTexts = read.lines.map(line => line.text);
    assert.ok(afterTexts.indexOf("Dentro de Datos.") > afterTexts.indexOf("## Datos"));
    assert.ok(afterTexts.indexOf("Dentro de Datos.") < afterTexts.indexOf("## Conclusiones"));

    const replaced = await runDocTool(root, "specialist_doc_write", { artifactId: id, mode: "replace", content: "# Nuevo\n\nContenido." }) as { changed: boolean };
    assert.equal(replaced.changed, true);
    const exported = await runDocTool(root, "specialist_doc_export", { artifactId: id }) as { content: string };
    assert.equal(exported.content, "# Nuevo\n\nContenido.");

    const versions = await runDocTool(root, "specialist_doc_versions", { artifactId: id, action: "list" }) as { versions: Array<{ id: string }> };
    assert.equal(versions.versions.length, 5);
    await runDocTool(root, "specialist_doc_versions", { artifactId: id, action: "revert", versionId: versions.versions[0]!.id });
    const reverted = await runDocTool(root, "specialist_doc_export", { artifactId: id }) as { content: string };
    assert.equal(reverted.content, SAMPLE);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("doc find supports literal and regex; bad regex is rejected", async () => {
  const root = await workspace();
  try {
    const id = await newDoc(root);
    const literal = await runDocTool(root, "specialist_doc_find", { artifactId: id, query: "soja" }) as { total: number; matches: Array<{ line: number }> };
    assert.equal(literal.total, 1);
    assert.equal(literal.matches[0]!.line, 7);
    const regex = await runDocTool(root, "specialist_doc_find", { artifactId: id, query: "^## ", regex: true }) as { total: number };
    assert.equal(regex.total, 2);
    await rejectsCode(runDocTool(root, "specialist_doc_find", { artifactId: id, query: "[", regex: true }), "invalid_regex");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("doc view persists viewer state without bumping the content version", async () => {
  const root = await workspace();
  try {
    const id = await newDoc(root);
    const before = await readArtifact(root, id);
    const viewed = await runDocTool(root, "specialist_doc_view", { artifactId: id, theme: "dark", zoom: 125, scrollTo: "Datos", outline: false }) as {
      viewer: { theme: string; zoom: number; scrollTo: string; outline: boolean };
    };
    assert.deepEqual(viewed.viewer, { format: "md", theme: "dark", zoom: 125, outline: false, scrollTo: "Datos" });
    const after = await readArtifact(root, id);
    assert.equal(after.content, before.content);
    assert.equal(after.meta.versions.length, before.meta.versions.length);
    assert.equal(after.meta.metadata.viewer?.theme, "dark");
    await rejectsCode(runDocTool(root, "specialist_doc_view", { artifactId: id }), "doc_view_empty");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("doc tools reject non-doc artifacts and missing headings", async () => {
  const root = await workspace();
  try {
    const sheet = await writeArtifact(root, {
      type: "sheet", title: "Hoja", content: '{"sheets":[]}', metadata: { workspaceId: "x", schemaVersion: 1 },
    });
    await rejectsCode(runDocTool(root, "specialist_doc_read", { artifactId: sheet.meta.id }), "not_a_doc");
    const id = await newDoc(root);
    await rejectsCode(runDocTool(root, "specialist_doc_write", { artifactId: id, mode: "before", content: "x" }), "doc_heading_required");
    await rejectsCode(runDocTool(root, "specialist_doc_write", { artifactId: id, mode: "after", heading: "Inexistente", content: "x" }), "doc_heading_not_found");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("pure doc helpers handle outlines, searches and writes without I/O", () => {
  assert.deepEqual(docOutline("# Uno\ntexto\n## Dos").map(entry => entry.level), [1, 2]);
  assert.equal(docFind("hola\nHOLA\nchau", "hola", false, 10).length, 2);
  assert.equal(docFind("a1\na2", "^a", true, 10).length, 2);
  assert.equal(docWrite("# T\n\ntexto", "append", undefined, "extra"), "# T\n\ntexto\n\nextra\n");
  assert.equal(docWrite("# T", "replace", undefined, "otra cosa"), "otra cosa");
  assert.equal(docWrite("# T", "replace", undefined, "# T"), null);
});

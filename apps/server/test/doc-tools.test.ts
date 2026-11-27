import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readArtifact, writeArtifact } from "../src/specialists/artifacts.js";
import { runDocTool } from "../src/specialists/doc-tools.js";
import { docFind, docOutline, docWrite } from "../src/specialists/doc-model.js";
import { writeOutput } from "../src/specialists/outputs.js";
import { registerLocalSource } from "../src/specialists/sources.js";

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

test("document creation adds a missing title and block/format tools edit real content", async () => {
  const root = await workspace();
  try {
    const created = await runDocTool(root, "specialist_doc_create", { title: "Borrador", content: "Texto inicial." }) as { artifactId: string };
    const id = created.artifactId;
    const exported = await runDocTool(root, "specialist_doc_export", { artifactId: id, format: "md" }) as { content: string };
    assert.match(exported.content, /^# Borrador/);

    const blocks = await runDocTool(root, "specialist_doc_blocks", { artifactId: id, action: "list" }) as { blocks: Array<{ id: string; type: string }> };
    assert.deepEqual(blocks.blocks.map(block => block.type), ["heading", "paragraph"]);
    await runDocTool(root, "specialist_doc_blocks", { artifactId: id, action: "insert", position: "end", content: "## Anexo\n\nSoja." });
    await runDocTool(root, "specialist_doc_format", { artifactId: id, query: "Soja", style: "bold" });
    const final = await runDocTool(root, "specialist_doc_export", { artifactId: id, format: "md" }) as { content: string };
    assert.match(final.content, /\*\*Soja\*\*/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rename, comments and viewer controls update metadata without content versions", async () => {
  const root = await workspace();
  try {
    const id = await newDoc(root);
    const before = await readArtifact(root, id);
    await runDocTool(root, "specialist_doc_rename", { artifactId: id, title: "Informe renombrado" });
    const comments = await runDocTool(root, "specialist_doc_comments", { artifactId: id, action: "add", quote: "Soja 2024.", text: "Verificar la cifra." }) as { comments: Array<{ id: string }> };
    const commentId = comments.comments[0]!.id;
    await runDocTool(root, "specialist_doc_comments", { artifactId: id, action: "resolve", commentId, resolved: true });
    await runDocTool(root, "specialist_doc_view", { artifactId: id, mode: "edit", search: "Soja", fullscreen: true });
    const after = await readArtifact(root, id);
    assert.equal(after.meta.title, "Informe renombrado");
    assert.equal(after.meta.versions.length, before.meta.versions.length);
    assert.equal(after.content, before.content);
    assert.equal(after.meta.metadata.comments?.[0]?.resolved, true);
    assert.equal(after.meta.metadata.viewer?.mode, "edit");
    assert.equal(after.meta.metadata.viewer?.fullscreen, true);
    await runDocTool(root, "specialist_doc_view", { artifactId: id, action: "reset" });
    const reset = await readArtifact(root, id);
    assert.equal(reset.meta.metadata.viewer?.mode, "preview");
    assert.equal(reset.meta.metadata.viewer?.search, "");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("citations can be associated, inserted and audited against real sources", async () => {
  const root = await workspace();
  try {
    await writeFile(join(root, "proyecto", "evidencia.txt"), "La soja creció 12% en 2024. Fuente: informe oficial.");
    const source = await registerLocalSource(root, { path: "proyecto/evidencia.txt", title: "Informe oficial" });
    const id = await newDoc(root);
    await runDocTool(root, "specialist_doc_citations", { artifactId: id, action: "add", sourceId: source.id, label: source.title });
    await runDocTool(root, "specialist_doc_citations", { artifactId: id, action: "insert", sourceId: source.id, chunk: 0, query: "Soja 2024." });
    const audit = await runDocTool(root, "specialist_doc_citations", { artifactId: id, action: "audit" }) as { audit: { total: number; valid: number } };
    assert.equal(audit.audit.total, 1);
    assert.equal(audit.audit.valid, 1);
    const exported = await runDocTool(root, "specialist_doc_export", { artifactId: id, format: "md" }) as { content: string };
    assert.match(exported.content, new RegExp(`\\[fuente:${source.id}#0\\]`));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("documents import from project files, public URLs and mini-Studio outputs", async () => {
  const root = await workspace();
  try {
    await writeFile(join(root, "proyecto", "entrada.md"), "# Entrada\n\nContenido local.");
    const local = await runDocTool(root, "specialist_doc_import", { sourceKind: "path", path: "proyecto/entrada.md" }) as { artifactId: string };
    assert.equal((await readArtifact(root, local.artifactId)).meta.title, "entrada");

    const web = await runDocTool(root, "specialist_doc_import", { sourceKind: "url", url: "https://example.com/informe.md", title: "Informe web" }, {
      fetch: (async () => new Response("# Web\n\nTexto público.", { headers: { "content-type": "text/markdown" } })) as typeof fetch,
      lookup: (async () => [{ address: "93.184.216.34", family: 4 }]) as never,
    }) as { artifactId: string };
    assert.match((await readArtifact(root, web.artifactId)).content, /Texto público/);
    await rejectsCode(runDocTool(root, "specialist_doc_import", { sourceKind: "url", url: "https://127.0.0.1/privado" }), "invalid_doc_import_url");

    const output = await writeOutput(root, { kind: "table", title: "Ventas", content: JSON.stringify([{ Producto: "Soja", Valor: 10 }]) });
    const imported = await runDocTool(root, "specialist_doc_import", { sourceKind: "output", outputId: output.output.id }) as { artifactId: string };
    assert.match((await readArtifact(root, imported.artifactId)).content, /\| Producto \| Valor \|/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("PDF and Word exports save real files and delete requires explicit confirmation", async () => {
  const root = await workspace();
  try {
    const id = await newDoc(root);
    const pdf = await runDocTool(root, "specialist_doc_export", { artifactId: id, format: "pdf", path: "proyecto/entregas/informe.pdf" }) as { path: string; bytes: number };
    assert.equal((await readFile(join(root, pdf.path))).subarray(0, 5).toString(), "%PDF-");
    const docx = await runDocTool(root, "specialist_doc_export", { artifactId: id, format: "docx", path: "proyecto/entregas/informe.docx" }) as { path: string };
    assert.equal((await readFile(join(root, docx.path))).subarray(0, 2).toString(), "PK");
    await rejectsCode(runDocTool(root, "specialist_doc_delete", { artifactId: id, mode: "delete" }), "doc_delete_confirm_required");
    await runDocTool(root, "specialist_doc_delete", { artifactId: id, mode: "delete", confirm: true });
    await rejectsCode(readArtifact(root, id), "artifact_not_found");
  } finally { await rm(root, { recursive: true, force: true }); }
});

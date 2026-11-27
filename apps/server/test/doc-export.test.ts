import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { docDocx, docHtml, docPdf, exportDoc, readDocImportFile, safeDocFileName, saveDocExport } from "../src/specialists/doc-export.js";

const CONTENT = "# Informe\n\nPárrafo con **negrita**.\n\n## Ventas\n\n- Soja\n- Trigo\n\n| Producto | Valor |\n| --- | --- |\n| Soja | 10 |\n\n```ts\nconst total = 10;\n```\n";

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "doc-export-"));
  await mkdir(join(root, "proyecto"), { recursive: true });
  return root;
}

test("HTML export escapes raw HTML and includes the document title", () => {
  const html = docHtml("Informe <2026>", `${CONTENT}\n<script>alert(1)</script>`);
  assert.match(html, /Informe &lt;2026&gt;/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

test("Word and PDF exports produce valid binary signatures", async () => {
  const docx = await docDocx("Informe", CONTENT);
  assert.equal(docx.subarray(0, 2).toString(), "PK");
  assert.ok(docx.length > 1_000);
  const pdf = await docPdf("Informe", CONTENT);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 500);
});

test("exports can be saved inside the project but never through symlinks outside it", async () => {
  const root = await workspace();
  const outside = await mkdtemp(join(tmpdir(), "doc-export-outside-"));
  try {
    const bytes = Buffer.from("contenido");
    const path = await saveDocExport(root, "proyecto/entregas/informe.md", bytes);
    assert.equal(path, "proyecto/entregas/informe.md");
    assert.equal((await readFile(join(root, path), "utf8")), "contenido");
    await symlink(outside, join(root, "proyecto", "enlace"));
    await assert.rejects(saveDocExport(root, "proyecto/enlace/escape.md", bytes), /enlace simbólico/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("local import supports Markdown and HTML with a 300 KB ceiling", async () => {
  const root = await workspace();
  try {
    await writeFile(join(root, "proyecto", "nota.md"), "# Nota\n\nTexto.");
    assert.equal((await readDocImportFile(root, "proyecto/nota.md")).content, "# Nota\n\nTexto.");
    await writeFile(join(root, "proyecto", "pagina.html"), "<h1>Web</h1><p>Texto <strong>clave</strong>.</p>");
    const imported = await readDocImportFile(root, "proyecto/pagina.html");
    assert.match(imported.content, /^# Web/);
    assert.match(imported.content, /\*\*clave\*\*/);
    assert.equal(safeDocFileName("Informe 2026", "pdf"), "Informe-2026.pdf");
    const result = await exportDoc(root, "Informe", CONTENT, "md");
    assert.equal(result.extension, "md");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

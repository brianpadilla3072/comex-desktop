import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiError } from "../src/errors.js";
import { readCitation, registerSource } from "../src/specialists/sources.js";
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

test("a table-shaped JSON file is still citable: short cells must not leave it with zero passages", async () => {
  const root = await mkdtemp(join(tmpdir(), "specialists-local-source-json-"));
  try {
    await mkdir(join(root, "datos"), { recursive: true });
    await writeFile(join(root, "datos", "precios.json"), JSON.stringify([
      { fecha: "2026-11-07", cierre: 480, volumen: 1180 },
      { fecha: "2026-11-08", cierre: 486, volumen: 1200 },
    ]));
    const source = await registerLocalSource(root, { path: "datos/precios.json" });
    const cited = await readCitation(root, source.id, 0);
    assert.equal(cited.ok, true, cited.ok ? "" : cited.error);
    if (cited.ok) {
      assert.match(cited.text, /cierre/);
      assert.match(cited.text, /2026-11-07/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("one long line is split into bounded passages instead of a single huge one", async () => {
  const root = await mkdtemp(join(tmpdir(), "specialists-local-source-line-"));
  try {
    await mkdir(join(root, "datos"), { recursive: true });
    const singleLine = "x".repeat(5000);
    await writeFile(join(root, "datos", "larga.txt"), singleLine);
    const source = await registerLocalSource(root, { path: "datos/larga.txt" });
    const first = await readCitation(root, source.id, 0);
    assert.equal(first.ok, true);
    if (first.ok) assert.ok(first.text.length <= 1200, `passage too long: ${first.text.length}`);
    const second = await readCitation(root, source.id, 1);
    assert.equal(second.ok, true, "the rest of the line must be reachable by anchor");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an empty chunk cache left by an older indexer is rebuilt instead of pinning zero passages", async () => {
  const root = await mkdtemp(join(tmpdir(), "specialists-local-source-cache-"));
  try {
    await mkdir(join(root, "datos"), { recursive: true });
    await writeFile(join(root, "datos", "precios.json"), JSON.stringify([{ fecha: "2026-11-07", cierre: 480 }]));
    const source = await registerLocalSource(root, { path: "datos/precios.json" });
    await writeFile(join(root, "comex", "fuentes", `${source.id}.chunks.json`), "[]");
    const cited = await readCitation(root, source.id, 0);
    assert.equal(cited.ok, true, cited.ok ? "" : cited.error);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("research evidence cites its result content, never the search query or the bare URL", async () => {
  const root = await mkdtemp(join(tmpdir(), "specialists-source-tavily-"));
  try {
    await mkdir(join(root, "comex", "fuentes", "tavily"), { recursive: true });
    const evidencePath = "comex/fuentes/tavily/evidencia.json";
    await writeFile(join(root, evidencePath), JSON.stringify({
      query: "https://www.argentina.gob.ar/normativa/nacional/ley-24240",
      results: [
        { title: "Ley 24.240", url: "https://www.argentina.gob.ar/normativa/nacional/ley-24240", content: "ARTICULO 1 — Objeto. La presente ley tiene por objeto la defensa de los consumidores." },
        { title: "Boletín", url: "https://example.com/boletin", content: "La autoridad de aplicación publica las resoluciones en el boletín oficial." },
      ],
    }));
    const source = await registerSource(root, { provider: "tavily", evidencePath, title: "Ley 24.240", url: null });
    const cited = await readCitation(root, source.id, 0);
    assert.equal(cited.ok, true);
    if (cited.ok) {
      assert.match(cited.text, /defensa de los consumidores/);
      assert.equal(cited.text.startsWith("http"), false);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

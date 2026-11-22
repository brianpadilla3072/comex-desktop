import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiError } from "../src/errors.js";
import { ensureChunks, listSources, readCitation, registerSource } from "../src/specialists/sources.js";

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "specialists-sources-"));
  await mkdir(join(root, "comex", "fuentes", "tavily"), { recursive: true });
  return root;
}

const longSentence = "La exportación de soja creció un tres por ciento en el último trimestre medido por la Bolsa de Comercio. ";

test("evidence registers as a citable source, idempotently by path", async () => {
  const root = await workspace();
  try {
    const evidence = "comex/fuentes/tavily/a.json";
    await writeFile(join(root, evidence), JSON.stringify({ results: [{ title: "Soja", content: longSentence.repeat(3), url: "https://ejemplo.cl/soja" }] }));
    const first = await registerSource(root, { provider: "tavily", evidencePath: evidence, title: "Investigación soja", url: "https://ejemplo.cl/soja" });
    assert.match(first.id, /^src_/);
    const again = await registerSource(root, { provider: "tavily", evidencePath: evidence, title: "Investigación soja v2" });
    assert.equal(again.id, first.id);
    assert.equal(again.title, "Investigación soja v2");
    assert.equal((await listSources(root)).length, 1);
    await assert.rejects(registerSource(root, { provider: "tavily", evidencePath: "../secreto.json" }), (error) => error instanceof ApiError && error.code === "invalid_source");
    await assert.rejects(registerSource(root, { provider: "tavily", evidencePath: "comex/fuentes/tavily/no-existe.json" }), (error) => error instanceof ApiError && error.code === "invalid_source");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("citations resolve to exact passages and stale anchors fail loud", async () => {
  const root = await workspace();
  try {
    const evidence = "comex/fuentes/tavily/b.json";
    await writeFile(join(root, evidence), JSON.stringify({ answer: longSentence.repeat(12) }));
    const source = await registerSource(root, { provider: "tavily", evidencePath: evidence });
    const built = await ensureChunks(root, source.id);
    assert.ok(built.chunks.length >= 2, "se esperaban varios pasajes");
    assert.equal((await ensureChunks(root, source.id)).chunks.length, built.chunks.length); // cache estable
    const cited = await readCitation(root, source.id, 1);
    assert.equal(cited.ok, true);
    if (cited.ok) assert.match(cited.text, /soja/);
    const stale = await readCitation(root, source.id, built.chunks.length + 5);
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.match(stale.error, /no existe/); // nunca rellena con memoria del modelo
    await assert.rejects(readCitation(root, "src_inventado", 0), (error) => error instanceof ApiError && error.code === "source_not_found");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the index and chunk cache survive damage without poisoning citations", async () => {
  const root = await workspace();
  try {
    const evidence = "comex/fuentes/tavily/c.json";
    await writeFile(join(root, evidence), JSON.stringify({ results: [{ content: longSentence.repeat(4) }] }));
    const source = await registerSource(root, { provider: "tavily", evidencePath: evidence });
    await ensureChunks(root, source.id);
    // Poison the chunk cache; the next read rebuilds instead of serving garbage.
    await writeFile(join(root, "comex", "fuentes", `${source.id}.chunks.json`), "no-json", "utf8");
    const rebuilt = await ensureChunks(root, source.id);
    assert.ok(rebuilt.chunks.length >= 1);
    // A corrupt index entry drops; the rest stays readable.
    const indexFile = join(root, "comex", "fuentes", "index.json");
    await writeFile(indexFile, JSON.stringify([{ basura: true }, ...JSON.parse(await readFile(indexFile, "utf8"))]), "utf8");
    assert.equal((await listSources(root)).length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

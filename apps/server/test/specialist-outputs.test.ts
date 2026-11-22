import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiError } from "../src/errors.js";
import { auditOutputCitations, deleteOutput, extractCitations, listOutputs, readOutput, validateOutputContent, writeOutput } from "../src/specialists/outputs.js";
import { registerSource } from "../src/specialists/sources.js";

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "specialists-outputs-"));
  await mkdir(join(root, "comex", "fuentes", "tavily"), { recursive: true });
  return root;
}

test("the store validates each kind's shape at write time, not render time", () => {
  assert.equal(validateOutputContent("mindmap", "mindmap\n  root((Soja))\n  China"), null);
  assert.match(validateOutputContent("mindmap", "solo prosa") ?? "", /Mermaid/);
  assert.equal(validateOutputContent("report", "# Conclusión\n\nTexto."), null);
  assert.match(validateOutputContent("report", "sin títulos") ?? "", /título/);
  assert.equal(validateOutputContent("table", "[{a:1}]".replace("a:1", JSON.stringify("a") + ":1")), null);
  assert.match(validateOutputContent("table", "{\"filas\":1}") ?? "", /array de filas/);
  assert.equal(validateOutputContent("flashcards", JSON.stringify([{ front: "f", back: "b" }])), null);
  assert.match(validateOutputContent("flashcards", JSON.stringify([{ front: "f" }])) ?? "", /front,back/);
  assert.equal(validateOutputContent("quiz", JSON.stringify([{ question: "¿?", options: ["a", "b"], answer: 1 }])), null);
  assert.match(validateOutputContent("quiz", JSON.stringify([{ question: "¿?", options: ["a", "b"], answer: 5 }])) ?? "", /índice válido/);
});

test("outputs round-trip: create, read, update in place, delete", async () => {
  const root = await workspace();
  try {
    const created = await writeOutput(root, { kind: "report", title: "Informe soja", content: "# Hallazgos\n\nLa exportación creció [fuente:src_1#0]." });
    assert.equal(created.created, true);
    assert.match(created.output.id, /^out-report-/);
    const read = await readOutput(root, created.output.id);
    assert.match(read.content, /Hallazgos/);
    assert.deepEqual(await readFile(join(root, "comex", "salidas", created.output.id, "output.json"), "utf8").then(JSON.parse), { ...created.output });
    const updated = await writeOutput(root, { kind: "report", title: "Informe soja v2", content: "# v2", id: created.output.id });
    assert.equal(updated.created, false);
    assert.equal((await listOutputs(root)).length, 1);
    await deleteOutput(root, created.output.id);
    assert.equal((await listOutputs(root)).length, 0);
    await assert.rejects(readOutput(root, created.output.id), (error) => error instanceof ApiError && error.code === "output_not_found");
    await assert.rejects(writeOutput(root, { kind: "quiz", title: "x", content: JSON.stringify([{ question: "q", options: ["a"], answer: 0 }]) }),
      (error) => error instanceof ApiError && error.code === "invalid_output");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("citation audit resolves anchors against project sources and never fakes them", async () => {
  const root = await workspace();
  try {
    const evidence = "comex/fuentes/tavily/o.json";
    await writeFile(join(root, evidence), JSON.stringify({ answer: "La exportación de soja creció un tres por ciento en el último trimestre medido por la Bolsa de Comercio. ".repeat(20) }));
    const source = await registerSource(root, { provider: "tavily", evidencePath: evidence });
    const ok = await writeOutput(root, {
      kind: "report", title: "Anclado", fromSources: [source.id],
      content: `# Bien\n\nCita válida [fuente:${source.id}#0] y otra inválida [fuente:${source.id}#999].`,
    });
    const audit = await auditOutputCitations(root, ok.output.id);
    assert.equal(audit.total, 2);
    assert.equal(audit.valid, 1);
    assert.equal(audit.invalid[0]?.chunk, 999);
    assert.match(audit.invalid[0]!.reason, /no existe/);
    const free = await writeOutput(root, { kind: "report", title: "Suelto", content: "# Sin anclas\n\nInvento total." });
    const auditFree = await auditOutputCitations(root, free.output.id);
    assert.equal(auditFree.total, 0);
    assert.match(auditFree.note ?? "", /no está anclada/);
    // Declaró fuentes y no cita: el note más específico.
    const lying = await writeOutput(root, { kind: "report", title: "Miente", fromSources: [source.id], content: "# Titulo solo" });
    assert.match((await auditOutputCitations(root, lying.output.id)).note ?? "", /declaró fuentes/);
    assert.deepEqual(extractCitations("a [fuente:x_1#2] b [fuente:y#0]"), [{ sourceId: "x_1", chunk: 2 }, { sourceId: "y", chunk: 0 }]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a provider's trailing word after the JSON never reaches the saved output", async () => {
  const root = await workspace();
  const project = root;
  try {
    const result = await writeOutput(project, {
      kind: "flashcards", title: "Con cola",
      content: '[{"front":"¿Objeto?","back":"Defensa del consumidor."}]Conformément',
    });
    assert.equal(result.created, true);
    const saved = await readFile(join(project, "comex", "salidas", result.output.id, "content.json"), "utf8");
    assert.deepEqual(JSON.parse(saved), [{ front: "¿Objeto?", back: "Defensa del consumidor." }]);
    // A genuinely broken payload still fails loud.
    await assert.rejects(writeOutput(project, { kind: "flashcards", title: "Rota", content: "[{front:" }), (error) => error instanceof ApiError && error.code === "invalid_output");
  } finally { await rm(root, { recursive: true, force: true }); }
});

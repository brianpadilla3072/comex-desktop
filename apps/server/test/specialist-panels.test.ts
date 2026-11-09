import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiError } from "../src/errors.js";
import { deletePanel, listPanels, panelRows, readPanelSpec, resolvePanel, writePanel } from "../src/specialists/panels.js";
import { recordDatasetRun } from "../src/specialists/datasets.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "specialists-panels-"));
  const config = { configPath: join(root, "server.json") };
  const project = join(root, "project");
  await mkdir(join(project, "comex", "fuentes", "tavily"), { recursive: true });
  return { root, config, project };
}

const spec = {
  title: "Soja — última corrida",
  source: { dataset: "ds-search-soja-china-abcd1234" },
  blocks: [
    { type: "stat", field: "cierre", agg: "last" },
    { type: "line", x: "fecha", y: ["cierre"], title: "Precio" },
    { type: "table", limit: 20 },
  ],
};

test("panels store validates specs, lists entries and deletes on demand", async () => {
  const { root, config } = await fixture();
  try {
    await assert.rejects(writePanel(config, "app_a", "MALO", spec), ApiError);
    await assert.rejects(writePanel(config, "app_a", "ok", { ...spec, blocks: [{ type: "pie" }] }),
      (error) => error instanceof ApiError && error.code === "invalid_panel");
    await assert.rejects(writePanel(config, "app_a", "ok", { ...spec, blocks: [] }),
      (error) => error instanceof ApiError && error.code === "invalid_panel");
    await assert.rejects(writePanel(config, "app_a", "ok", { ...spec, blocks: Array.from({ length: 13 }, () => ({ type: "markdown", text: "x" })) }),
      (error) => error instanceof ApiError && error.code === "invalid_panel");
    const created = await writePanel(config, "app_a", "soja-precio", spec);
    assert.equal(created.created, true);
    assert.equal(created.spec.panel, "soja-precio");
    const listed = await listPanels(config, "app_a");
    assert.deepEqual(listed.map(entry => entry.name), ["soja-precio"]);
    assert.match(listed[0]!.source, /^dataset:/);
    // Overwrite in place, then delete.
    const edited = await writePanel(config, "app_a", "soja-precio", { ...spec, title: "Soja v2" });
    assert.equal(edited.created, false);
    assert.equal((await readPanelSpec(config, "app_a", "soja-precio")).title, "Soja v2");
    assert.equal((await listPanels(config, "app_a")).length, 1);
    await deletePanel(config, "app_a", "soja-precio");
    assert.equal((await listPanels(config, "app_a")).length, 0);
    await assert.rejects(deletePanel(config, "app_a", "soja-precio"), (error) => error instanceof ApiError && error.code === "panel_not_found");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a panel resolves over the project's dataset snapshot or file, failing loudly", async () => {
  const { root, config, project } = await fixture();
  try {
    const query = { provider: "tavily", operation: "search", input: { query: "soja china" } };
    await writeFile(join(project, "comex", "fuentes", "tavily", "e.json"), JSON.stringify([{ fecha: "2026-11-08", cierre: 310 }]));
    const dataset = await recordDatasetRun(project, query, "comex/fuentes/tavily/e.json");
    await writePanel(config, "app_a", "soja-precio", { ...spec, source: { dataset: dataset.dataset.id } });
    const resolved = await resolvePanel(config, "app_a", "soja-precio", project);
    assert.equal(resolved.ok, true);
    if (resolved.ok) assert.deepEqual(resolved.data, [{ fecha: "2026-11-08", cierre: 310 }]);
    // Unknown dataset in ANOTHER project: same panel id, no data there → loud, specific failure.
    const empty = join(root, "otro");
    await mkdir(empty, { recursive: true });
    const missing = await resolvePanel(config, "app_a", "soja-precio", empty);
    assert.equal(missing.ok, false);
    assert.match((missing as { error: string }).error, /no existe en este proyecto/);
    // File source inside the project; traversal is refused.
    await writePanel(config, "app_a", "cotizaciones-file", { ...spec, source: { file: "datos/cotiz.json" } });
    await mkdir(join(project, "datos"), { recursive: true });
    await writeFile(join(project, "datos", "cotiz.json"), JSON.stringify([{ fecha: "1", v: 2 }]));
    const fileResolved = await resolvePanel(config, "app_a", "cotizaciones-file", project);
    assert.equal(fileResolved.ok, true);
    await writePanel(config, "app_a", "malicioso", { ...spec, source: { file: "../../etc/passwd" } });
    const escaped = await resolvePanel(config, "app_a", "malicioso", project);
    assert.equal(escaped.ok, false);
    assert.match((escaped as { error: string }).error, /sale del proyecto/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("panelRows finds the records array in common payload shapes", () => {
  assert.deepEqual(panelRows([{ a: 1 }]).rows, [{ a: 1 }]);
  assert.deepEqual(panelRows({ results: [{ a: 1 }, { a: 2 }] }).rows, [{ a: 1 }, { a: 2 }]);
  assert.deepEqual(panelRows({ deep: { nested: { rows: [{ a: 1 }] } } }).rows, [{ a: 1 }]);
  const bad = panelRows({ total: 3 });
  assert.equal(bad.rows.length, 0);
  assert.match(bad.error ?? "", /forma de tabla/);
});

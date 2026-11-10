import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiError } from "../src/errors.js";
import { deletePanel, listPanels, panelAggregate, panelRows, readPanelSpec, resolvePanel, writePanel } from "../src/specialists/panels.js";
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

test("panels keep refresh, refuse unknown fields, and respect the size and count limits", async () => {
  const { root, config } = await fixture();
  try {
    const created = await writePanel(config, "app_a", "vivo", { ...spec, refresh: { watch: "latest" } });
    assert.deepEqual(created.spec.refresh, { watch: "latest" });
    await assert.rejects(writePanel(config, "app_a", "tipos", { ...spec, refesh: { watch: "latest" } }),
      (error) => error instanceof ApiError && error.code === "invalid_panel"); // typo → loud, nunca ignorado
    await assert.rejects(writePanel(config, "app_a", "enorme", { ...spec, blocks: [{ type: "markdown", text: "x".repeat(70_000) }] }),
      (error) => error instanceof ApiError && error.code === "invalid_panel");
    for (let index = 0; index < 19; index++) await writePanel(config, "app_a", `p-${index}`, spec);
    await assert.rejects(writePanel(config, "app_a", "p-19", spec), (error) => error instanceof ApiError && error.code === "panel_limit");
    // Sobrescribir uno existente no cuenta como nuevo: pasa.
    await writePanel(config, "app_a", "p-0", spec);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("file sources fail loud on broken JSON, respect 2 MB, and raw text passes through; listPanels flags invalid entries", async () => {
  const { root, config, project } = await fixture();
  try {
    await mkdir(join(project, "datos"), { recursive: true });
    await writePanel(config, "app_a", "roto", { ...spec, source: { file: "datos/malo.json" } });
    await writeFile(join(project, "datos", "malo.json"), "{ esto no es json");
    const broken = await resolvePanel(config, "app_a", "roto", project);
    assert.equal(broken.ok, false);
    assert.match((broken as { error: string }).error, /no es JSON válido/);
    await writeFile(join(project, "datos", "enorme.json"), "x".repeat(2 * 1024 * 1024 + 10));
    await writePanel(config, "app_a", "grande", { ...spec, source: { file: "datos/enorme.json" } });
    const big = await resolvePanel(config, "app_a", "grande", project);
    assert.match((big as { error: string }).error, /supera 2 MB/);
    await writeFile(join(project, "datos", "notas.md"), "texto plano para la tabla");
    await writePanel(config, "app_a", "notas", { ...spec, source: { file: "datos/notas.md" } });
    const text = await resolvePanel(config, "app_a", "notas", project);
    assert.equal(text.ok, true);
    if (text.ok) assert.equal(text.data, "texto plano para la tabla");
    // Un spec dañado en disco se muestra "(inválido)" pero se puede borrar y reescribir.
    await writeFile(join(root, "specialists", "app_a", "panels", "basura.panel.json"), "{ roto", "utf8");
    const listed = await listPanels(config, "app_a");
    assert.equal(listed.find(entry => entry.name === "basura")?.title, "(ilegible)");
    await deletePanel(config, "app_a", "basura");
    await writePanel(config, "app_a", "basura", spec); // recuperación: reescribir funciona
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("panels match datasets by name or id and fail loud on damaged pointers", async () => {
  const { root, config, project } = await fixture();
  try {
    await writeFile(join(project, "comex", "fuentes", "tavily", "d.json"), JSON.stringify([{ v: 1 }]));
    const dataset = await recordDatasetRun(project, { provider: "tavily", operation: "search", input: { query: "aranceles automotrices" } }, "comex/fuentes/tavily/d.json");
    await writePanel(config, "app_a", "por-nombre", { ...spec, source: { dataset: dataset.dataset.name } });
    const byName = await resolvePanel(config, "app_a", "por-nombre", project);
    assert.equal(byName.ok, true);
    const dir = join(project, "comex", "datasets", dataset.dataset.id);
    await writeFile(join(dir, "LATEST"), "no-existe.json", "utf8");
    await writePanel(config, "app_a", "por-dano", { ...spec, source: { dataset: dataset.dataset.id } });
    const damaged = await resolvePanel(config, "app_a", "por-dano", project);
    assert.equal(damaged.ok, false);
    assert.match((damaged as { error: string }).error, /dañado/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an intermediate directory symlink cannot smuggle a read outside the project", async () => {
  const { root, config, project } = await fixture();
  try {
    const outside = join(root, "outside");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "secreto.json"), JSON.stringify({ ajeno: true }));
    const { symlink } = await import("node:fs/promises");
    await symlink(outside, join(project, "enlace"));
    await writePanel(config, "app_a", "a-traves-del-enlace", { ...spec, source: { file: "enlace/secreto.json" } });
    const escaped = await resolvePanel(config, "app_a", "a-traves-del-enlace", project);
    assert.equal(escaped.ok, false);
    assert.match((escaped as { error: string }).error, /enlace simbólico intermedio/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("panelAggregate is the single shared semantics for renderers and the future compiler", () => {  const rows = [{ n: 1 }, { n: 2 }, { n: 3 }, { n: "4" }];
  assert.equal(panelAggregate(rows, "n", "sum"), 10);
  assert.equal(panelAggregate(rows, "n", "avg"), 2.5);
  assert.equal(panelAggregate(rows, "n", "min"), 1);
  assert.equal(panelAggregate(rows, "n", "max"), 4);
  assert.equal(panelAggregate(rows, "n", "count"), 4);
  assert.equal(panelAggregate(rows, "n", "last"), "4");
  assert.equal(panelAggregate(rows, "n", "first"), 1);
  assert.equal(panelAggregate([{ s: "a" }, { s: "b" }], "s", "sum"), null); // nada inventado: null → "—"
});

test("a CSV in the project draws a table panel: headers, quoted commas, numbers and dialects", async () => {
  const { root, config, project } = await fixture();
  try {
    await writeFile(join(project, "mediciones-obra.csv"), [
      "partida,m2,precio_unitario,avance_pct",
      "mamposteria,120,1500,75",
      'revoque,"80,5",900,60',
      "pisos,100,2200,40",
    ].join("\r\n"));
    await writePanel(config, "app_a", "avance-obra", {
      title: "Avance de obra",
      source: { file: "mediciones-obra.csv" },
      blocks: [{ type: "table", limit: 10 }, { type: "stat", field: "m2", agg: "sum" }],
    });
    const resolved = await resolvePanel(config, "app_a", "avance-obra", project);
    assert.equal(resolved.ok, true);
    const rows = panelRows(resolved.data);
    assert.equal(rows.error, undefined);
    assert.deepEqual(rows.rows[0], { partida: "mamposteria", m2: 120, precio_unitario: 1500, avance_pct: 75 });
    assert.equal(rows.rows[1]!.partida, "revoque");
    assert.equal(rows.rows[1]!.m2, "80,5");
    assert.equal(panelAggregate(rows.rows, "avance_pct", "avg"), 175 / 3);

    // Semicolon exports from spreadsheets work too, and a leading-zero code stays an id.
    await writeFile(join(project, "calendario.csv"), "semana;tema;codigo\n1;Reels;007\n2;Newsletter;010\n");
    await writePanel(config, "app_a", "calendario", { title: "Calendario", source: { file: "calendario.csv" }, blocks: [{ type: "table", limit: 10 }] });
    const calendar = await resolvePanel(config, "app_a", "calendario", project);
    assert.equal(calendar.ok, true);
    const calendarRows = panelRows(calendar.data).rows;
    assert.deepEqual(calendarRows[0], { semana: 1, tema: "Reels", codigo: "007" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a bad spec names the failing field, not just 'revisá el esquema'", async () => {
  const { root, config } = await fixture();
  try {
    await assert.rejects(
      writePanel(config, "app_a", "roto", { title: "T", source: { file: "x.csv" }, type: { blocks: { item: [] } } } as never),
      (error) => error instanceof ApiError && error.code === "invalid_panel"
        && /la raíz tiene campos que no van \(type\)/.test(error.message),
    );
    await assert.rejects(
      writePanel(config, "app_a", "roto", { title: "T", source: { file: "x.csv" }, blocks: "tabla" } as never),
      (error) => error instanceof ApiError && /blocks debería ser array/.test(error.message),
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

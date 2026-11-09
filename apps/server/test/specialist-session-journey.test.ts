import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiError } from "../src/errors.js";
import { workspaceIdForPath } from "../src/workspaces.js";
import { specialistStore, applicationInput } from "../src/specialists/store.js";
import { listProposals } from "../src/specialists/proposals.js";
import { listTasks, updateTask } from "../src/specialists/tasks.js";
import { listDatasets } from "../src/specialists/datasets.js";
import { runLibraryTool, syncLibraryToolPlugin } from "../src/specialists/library-tool-api.js";
import { registerSpecialistRoutes } from "../src/specialists/routes.js";
import { matchRoute, type RequestContext, type Route } from "../src/routes/registry.js";
import type { ServerConfig } from "../src/types.js";

const input = (name: string) => applicationInput.parse({ userName: "Usuario de prueba", name, specialty: `Especialidad ${name}`, personality: `PERSONA_${name}`, template: "custom" });

type Flags = {
  library?: "true" | "false";
  tasks?: "true" | "false";
  datasets?: "true" | "false";
  sources?: "true" | "false";
  panels?: "true" | "false";
  outputs?: "true" | "false";
  localFiles?: "true" | "false";
  dryRun?: "true" | "false";
  applications?: "true" | "false";
};

function withFlags(flags: Flags, run: () => Promise<void>) {
  const pairs: Array<[string, "true" | "false" | undefined]> = [
    ["DEN_FEATURE_SPECIALIST_LIBRARY", flags.library],
    ["DEN_FEATURE_SCHEDULED_TASKS", flags.tasks],
    ["DEN_FEATURE_SPECIALIST_DATASETS", flags.datasets],
    ["DEN_FEATURE_SPECIALIST_SOURCES", flags.sources],
    ["DEN_FEATURE_SPECIALIST_PANELS", flags.panels],
    ["DEN_FEATURE_STUDIO_OUTPUTS", flags.outputs],
    ["DEN_FEATURE_SOURCES_LOCAL_FILES", flags.localFiles],
    ["DEN_FEATURE_TASK_DRY_RUN", flags.dryRun],
    ["DEN_FEATURE_SPECIALIST_APPLICATIONS", flags.applications],
  ];
  const before = new Map(pairs.map(([name]) => [name, process.env[name]]));
  for (const [name, value] of pairs) { if (value !== undefined) process.env[name] = value; }
  return run().finally(() => {
    for (const [name, value] of before) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  });
}

const ALL_ON: Flags = { library: "true", tasks: "true", datasets: "true", sources: "true", panels: "true", outputs: "true", localFiles: "true", dryRun: "true", applications: "true" };

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "specialist-session-journey-"));
  const config = { configPath: join(root, "server.json"), port: 4711, token: "test-token", workspaces: [] as Array<{ id: string; path: string }> };
  const store = await specialistStore(config as unknown as ServerConfig);
  const app = store.create(input("Alpha"), { agents: 0, skills: 0 });
  const pathA = join(root, "proyecto-a");
  const pathB = join(root, "proyecto-b");
  await mkdir(join(pathA, "comex", "fuentes", "tavily"), { recursive: true });
  await mkdir(join(pathB, "comex", "fuentes", "tavily"), { recursive: true });
  const idA = workspaceIdForPath(pathA);
  const idB = workspaceIdForPath(pathB);
  config.workspaces.push({ id: idA, path: pathA }, { id: idB, path: pathB });
  store.bind(idA, app.id, pathA);
  store.bind(idB, app.id, pathB);
  return { root, config, store, app, pathA, pathB, idA, idB };
}

function apiHarness(config: Record<string, unknown>) {
  const routes: Route[] = [];
  registerSpecialistRoutes({
    routes, config: config as unknown as ServerConfig,
    readJsonBody: async (request: Request) => await request.json() as Record<string, unknown>,
    jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
    ensureWritable: () => {}, createWorkspace: async () => "ws_new",
  });
  return async (method: string, fullPath: string, body?: unknown, headers?: Record<string, string>) => {
    const url = new URL(`http://127.0.0.1:1${fullPath}`);
    const match = matchRoute(routes, method, url.pathname);
    assert.ok(match, `no route for ${method} ${fullPath}`);
    const request = new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers });
    try {
      const response = await match.handler({ request, url, params: match.params, config } as unknown as RequestContext);
      return { status: response.status, json: await response.json() as Record<string, unknown> };
    } catch (error) {
      if (error instanceof ApiError) return { status: error.status, json: { error: error.code } };
      throw error;
    }
  };
}

type Proposal = { id: string; kind: string; name: string };
type TaskEntry = { id: string; name: string; enabled: boolean; nextRunAt: number | null };
type DatasetEntry = { id: string; name: string; provider: string; operation: string; derivedFrom: string | null; snapshots: number; lastSnapshotAt: number | null };
type AppliedPiece = { piece: string; ok: boolean; id?: string; detail?: string };

const PLAN = {
  skill: { name: "traer-precios-simulacro", description: "Busca precios de soja para el simulacro.", content: "# Pasos para traer precios" },
  dataset: { name: "precios-simulacro", query: { provider: "tavily", operation: "search", input: { query: "precios soja simulacro" } } },
  panel: { name: "precios-simulacro-panel", spec: { title: "Precios simulacro", source: { dataset: "precios-simulacro" }, blocks: [{ type: "table", limit: 10 }] } },
  task: { prompt: "Refrescá los precios del simulacro.", schedule: { kind: "interval", everyMinutes: 20 } },
};

const longSentence = "La exportación de soja creció un tres por ciento en el último trimestre medido por la Bolsa de Comercio. ";

const OPENAPI_SPEC = JSON.stringify({
  openapi: "3.1.0",
  info: { title: "Simulacro API", version: "1.0" },
  servers: [{ url: "https://api.ejemplo.test/v1" }],
  paths: {
    "/cosas": { get: { operationId: "listarCosas", responses: {} } },
  },
});

test("specialist session journey: one continuous session through the tool bridge", async () => {
  const { root, config, app, pathA, pathB, idA, idB } = await fixture();
  const call = apiHarness(config);
  try {
    await withFlags(ALL_ON, async () => {
      // Descriptor synced for both bound workspaces (plugin files on disk, token-scoped).
      await syncLibraryToolPlugin(config as unknown as ServerConfig, idA, pathA);
      await syncLibraryToolPlugin(config as unknown as ServerConfig, idB, pathB);

      // 1. Propose a PLAN through the tool bridge.
      const proposed = await runLibraryTool(config, pathA, "specialist_propose", {
        kind: "plan",
        name: "programa-simulacro",
        description: "Plan de precios para el simulacro.",
        reason: "La persona pidió el programa.",
        content: JSON.stringify(PLAN),
      }) as { proposal: Proposal; total: number; note: string };
      assert.equal(proposed.proposal.kind, "plan");
      assert.equal(proposed.proposal.name, "programa-simulacro");
      assert.equal(proposed.total, 1);
      assert.match(proposed.note, /plan/);
      assert.match(proposed.note, /skill, dataset, tarea pausada, panel/);
      const planProposalId = proposed.proposal.id;
      assert.equal((await listProposals(config, app.id)).length, 1);

      // 2. Accept it through the HTTP route; every piece applies, task born PAUSED.
      const accepted = await call("POST", `/specialist-applications/${app.id}/library/proposals/${planProposalId}/accept`, {});
      assert.equal(accepted.status, 200);
      const applied = accepted.json.applied as AppliedPiece[];
      assert.deepEqual(applied.map(entry => [entry.piece, entry.ok]), [["skill", true], ["dataset", true], ["panel", true], ["tarea", true]]);
      assert.ok(applied[1]!.id?.startsWith(`${idA}/ds-precios-simulacro-`));
      const planDatasetId = applied[1]!.id!.split("/")[1]!;
      const planDatasetsOnDisk = await listDatasets(pathA);
      assert.equal(planDatasetsOnDisk.length, 1);
      assert.equal(planDatasetsOnDisk[0]!.id, planDatasetId);
      assert.deepEqual(await listDatasets(pathB), []);
      assert.equal(applied[2]!.id, "precios-simulacro-panel");
      const taskId = applied[3]!.id!;
      assert.ok(taskId.startsWith("task_"));
      const tasksAfterAccept = await listTasks(config, app.id);
      assert.equal(tasksAfterAccept.length, 1);
      assert.equal(tasksAfterAccept[0]!.id, taskId);
      assert.equal(tasksAfterAccept[0]!.name, "programa-simulacro");
      assert.equal(tasksAfterAccept[0]!.enabled, false);
      assert.equal(tasksAfterAccept[0]!.nextRunAt, null);
      assert.deepEqual(await listProposals(config, app.id), []);

      // 3. Enable+run observations: list shows paused, updateTask activates, pause tool re-pauses.
      const listed = await runLibraryTool(config, pathA, "specialist_task_list", {}) as { tasks: TaskEntry[] };
      assert.equal(listed.tasks.length, 1);
      assert.equal(listed.tasks[0]!.id, taskId);
      assert.equal(listed.tasks[0]!.enabled, false);
      const activated = await updateTask(config, app.id, taskId, { enabled: true });
      assert.equal(activated.enabled, true);
      assert.ok(activated.nextRunAt !== null && activated.nextRunAt > Date.now());
      const paused = await runLibraryTool(config, pathA, "specialist_task_pause", { taskId }) as { task: TaskEntry };
      assert.equal(paused.task.id, taskId);
      assert.equal(paused.task.enabled, false);

      // 4. Dataset list/read on the plan's dataset (latest=null honest); derive a dataset.
      const dsListed = await runLibraryTool(config, pathA, "specialist_dataset_list", {}) as { datasets: DatasetEntry[]; note: string };
      assert.deepEqual(dsListed.datasets.map(entry => entry.id), [planDatasetId]);
      assert.match(dsListed.note, /Datos/);
      const dsRead = await runLibraryTool(config, pathA, "specialist_dataset_read", { id: planDatasetId }) as { dataset: DatasetEntry; snapshots: string[]; latest: unknown; note?: string };
      assert.equal(dsRead.dataset.id, planDatasetId);
      assert.equal(dsRead.dataset.name, "precios-simulacro");
      assert.equal(dsRead.dataset.snapshots, 0);
      assert.equal(dsRead.dataset.lastSnapshotAt, null);
      assert.deepEqual(dsRead.snapshots, []);
      assert.equal(dsRead.latest, null);
      assert.match(dsRead.note ?? "", /todavía no tuvo una corrida/);
      const derivePayload = [{ precio: 11 }, { precio: 22 }, { precio: 33 }];
      const derived = await runLibraryTool(config, pathA, "specialist_dataset_derive", { sourceId: planDatasetId, name: "Precios limpios", payload: derivePayload }) as { dataset: DatasetEntry; note: string };
      assert.equal(derived.dataset.derivedFrom, planDatasetId);
      assert.equal(derived.dataset.name, "precios-limpios");
      assert.equal(derived.dataset.provider, "local");
      assert.equal(derived.dataset.operation, "derived");
      assert.equal(derived.dataset.snapshots, 1);
      assert.match(derived.note, /derivado/);
      const derivedId = derived.dataset.id;
      assert.equal((await listDatasets(pathA)).length, 2);

      // 5. Local file source: add, read index then chunk 1, stale anchor fails loud.
      const relPath = "datos/informe-simulacro.md";
      await mkdir(join(pathA, "datos"), { recursive: true });
      await writeFile(join(pathA, relPath), longSentence.repeat(30));
      const added = await runLibraryTool(config, pathA, "specialist_source_add", { path: relPath }) as { source: { id: string; provider: string; evidencePath: string; title: string }; note: string };
      assert.equal(added.source.provider, "file");
      assert.equal(added.source.title, "informe-simulacro.md");
      assert.match(added.source.evidencePath, /^comex\/fuentes\/local\//);
      assert.match(added.note, /fuente citable/);
      const sourceId = added.source.id;
      const index = await runLibraryTool(config, pathA, "specialist_source_read", { id: sourceId }) as { totalChunks: number; chunks: string[]; note: string };
      assert.ok(index.totalChunks >= 2);
      assert.equal(index.chunks.length, Math.min(index.totalChunks, 30));
      assert.match(index.note, /Citá como \[fuente/);
      const chunkOne = await runLibraryTool(config, pathA, "specialist_source_read", { id: sourceId, chunk: 1 }) as { ok: boolean; text: string };
      assert.equal(chunkOne.ok, true);
      assert.match(chunkOne.text, /soja/);
      const stale = await runLibraryTool(config, pathA, "specialist_source_read", { id: sourceId, chunk: 999 }) as { ok: boolean; error: string; note: string };
      assert.equal(stale.ok, false);
      assert.match(stale.error, /no existe/);
      assert.match(stale.note, /no cites/);

      // 6. Panel over the derived dataset: write/read, resolve via HTTP route, delete.
      const panelName = "precios-limpios-panel";
      const panelSpec = { title: "Precios limpios", source: { dataset: derivedId }, blocks: [{ type: "table", limit: 10 }] };
      const written = await runLibraryTool(config, pathA, "specialist_panel_write", { name: panelName, spec: panelSpec }) as { panel: string; created: boolean };
      assert.equal(written.panel, panelName);
      assert.equal(written.created, true);
      const panelRead = await runLibraryTool(config, pathA, "specialist_panel_read", { name: panelName }) as { spec: { title: string }; resolution: { ok: boolean; data: unknown } };
      assert.equal(panelRead.spec.title, "Precios limpios");
      assert.equal(panelRead.resolution.ok, true);
      assert.deepEqual(panelRead.resolution.data, derivePayload);
      const resolved = await call("GET", `/specialist-applications/${app.id}/panels/${panelName}/resolve`);
      assert.equal(resolved.status, 200);
      const resolutions = resolved.json.resolutions as Array<{ ok: boolean; data?: unknown; error?: string; workspaceId?: string }>;
      assert.equal(resolutions.length, 2);
      const okOne = resolutions.find(entry => entry.ok === true);
      const badOne = resolutions.find(entry => entry.ok === false);
      assert.ok(okOne);
      assert.equal(okOne!.workspaceId, idA);
      assert.deepEqual(okOne!.data, derivePayload);
      assert.ok(badOne);
      assert.equal(badOne!.workspaceId, idB);
      assert.match(String(badOne!.error), /no existe en este proyecto/);
      const deleted = await runLibraryTool(config, pathA, "specialist_panel_delete", { name: panelName }) as { deleted: string };
      assert.equal(deleted.deleted, panelName);
      assert.equal((await call("GET", `/specialist-applications/${app.id}/panels/${panelName}/resolve`)).status, 404);
      const panelsLeft = await runLibraryTool(config, pathA, "specialist_panel_list", {}) as { panels: Array<{ name: string }> };
      assert.deepEqual(panelsLeft.panels.map(entry => entry.name), ["precios-simulacro-panel"]);
      // The plan's own panel still resolves honestly: its dataset never ran, so resolution says so.
      const planPanelResolve = await call("GET", `/specialist-applications/${app.id}/panels/precios-simulacro-panel/resolve`);
      assert.equal(planPanelResolve.status, 200);
      const planResolutions = planPanelResolve.json.resolutions as Array<{ ok: boolean; error?: string; workspaceId?: string }>;
      assert.equal(planResolutions.length, 2);
      assert.ok(planResolutions.every(entry => entry.ok === false));
      const planOnA = planResolutions.find(entry => entry.workspaceId === idA);
      const planOnB = planResolutions.find(entry => entry.workspaceId === idB);
      assert.ok(planOnA);
      assert.match(String(planOnA!.error), /nunca tuvo una corrida/);
      assert.ok(planOnB);
      assert.match(String(planOnB!.error), /no existe en este proyecto/);

      // 7. Outputs: cited report audits valid; unanchored table says SIN anclas; bogus anchor audits invalid.
      const good = await runLibraryTool(config, pathA, "specialist_output_generate", {
        kind: "report",
        title: "Informe simulacro",
        content: `# Informe simulacro\n\nLa soja creció [fuente:${sourceId}#1].`,
        fromSources: [sourceId],
      }) as { audit: { total: number; valid: number; invalid: unknown[] }; note: string };
      assert.equal(good.audit.total, 1);
      assert.equal(good.audit.valid, 1);
      assert.deepEqual(good.audit.invalid, []);
      assert.match(good.note, /resuelve/);
      const unanchored = await runLibraryTool(config, pathA, "specialist_output_generate", {
        kind: "table", title: "Tabla sin cita", content: JSON.stringify([{ pais: "China", arancel: 23 }]),
      }) as { audit: { total: number }; note: string };
      assert.equal(unanchored.audit.total, 0);
      assert.match(unanchored.note, /SIN anclas/);
      const bogus = await runLibraryTool(config, pathA, "specialist_output_generate", {
        kind: "report", title: "Informe roto", content: "# T\n\nLo inventé [fuente:src_inventado#3].",
      }) as { audit: { invalid: unknown[] }; note: string };
      assert.equal(bogus.audit.invalid.length, 1);
      assert.match(bogus.note, /no resuelven/);

      // 8. OpenAPI propose: a plan lands in the inbox; do NOT accept it.
      const openapi = await runLibraryTool(config, pathA, "specialist_openapi_propose", { spec: OPENAPI_SPEC }) as { proposal: Proposal; operations: number; note: string };
      assert.equal(openapi.proposal.kind, "plan");
      assert.equal(openapi.proposal.name, "api-simulacro-api");
      assert.equal(openapi.operations, 1);
      assert.match(openapi.note, /credenciales/);
      const inbox = await listProposals(config, app.id);
      assert.equal(inbox.length, 1);
      assert.equal(inbox[0]!.id, openapi.proposal.id);
      assert.equal(inbox[0]!.kind, "plan");
      const openapiProposalId = openapi.proposal.id;

      // 9. Dismiss the OpenAPI proposal via route; assert gone.
      const dismissed = await call("DELETE", `/specialist-applications/${app.id}/library/proposals/${openapiProposalId}`);
      assert.equal(dismissed.status, 200);
      assert.equal(dismissed.json.dismissed, openapiProposalId);
      assert.deepEqual(await listProposals(config, app.id), []);
      const inboxAfter = await call("GET", `/specialist-applications/${app.id}/library/proposals`);
      assert.deepEqual(inboxAfter.json.proposals, []);
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

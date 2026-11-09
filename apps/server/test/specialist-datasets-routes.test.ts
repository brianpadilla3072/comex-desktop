import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiError } from "../src/errors.js";
import { workspaceIdForPath } from "../src/workspaces.js";
import { specialistStore, applicationInput } from "../src/specialists/store.js";
import { listDatasets, recordDatasetRun, registerDerivedDataset, type SpecialistDatasetQuery } from "../src/specialists/datasets.js";
import { runLibraryTool, syncLibraryToolPlugin } from "../src/specialists/library-tool-api.js";
import { registerSpecialistRoutes } from "../src/specialists/routes.js";
import { matchRoute, type RequestContext, type Route } from "../src/routes/registry.js";
import type { ServerConfig } from "../src/types.js";

const input = (name: string) => applicationInput.parse({ userName: "Usuario de prueba", name, specialty: `Especialidad ${name}`, personality: `PERSONA_${name}`, template: "custom" });

const failureStatus = (error: unknown, code: string) => error instanceof ApiError && error.code === code;

type Flags = { library?: "true" | "false"; tasks?: "true" | "false"; datasets?: "true" | "false" };
function withFlags(flags: Flags, run: () => Promise<void>) {
  const pairs: Array<[string, "true" | "false" | undefined]> = [
    ["DEN_FEATURE_SPECIALIST_LIBRARY", flags.library],
    ["DEN_FEATURE_SCHEDULED_TASKS", flags.tasks],
    ["DEN_FEATURE_SPECIALIST_DATASETS", flags.datasets],
  ];
  const before = new Map(pairs.map(([name]) => [name, process.env[name]]));
  for (const [name, value] of pairs) { if (value !== undefined) process.env[name] = value; }
  return run().finally(() => {
    for (const [name, value] of before) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  });
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "specialists-datasets-routes-"));
  const config = { configPath: join(root, "server.json"), port: 4711, token: "test-token", workspaces: [] as Array<{ id: string; path: string }> };
  const store = await specialistStore(config as unknown as ServerConfig);
  const app = store.create(input("Alpha"), { agents: 0, skills: 0 });
  const pathA = join(root, "proyecto-a"); const pathB = join(root, "proyecto-b"); const pathSuelto = join(root, "workspace-suelto");
  const idA = workspaceIdForPath(pathA); const idB = workspaceIdForPath(pathB); const idSuelto = workspaceIdForPath(pathSuelto);
  for (const path of [pathA, pathB, pathSuelto]) {
    await mkdir(join(path, "comex", "fuentes", "tavily"), { recursive: true });
    config.workspaces.push({ id: workspaceIdForPath(path), path });
  }
  store.bind(idA, app.id, pathA);
  store.bind(idB, app.id, pathB);
  // The third workspace lives in the server but belongs to no application.
  return { root, config, store, app, pathA, pathB, pathSuelto, idA, idB, idSuelto };
}

/** Seed one dataset inside a project, like the research capture does. */
async function seed(directory: string, name: string, query: SpecialistDatasetQuery, payload: unknown) {
  const relative = `comex/fuentes/tavily/${name}.json`;
  await writeFile(join(directory, relative), JSON.stringify(payload));
  const { dataset } = await recordDatasetRun(directory, query, relative);
  return dataset;
}

const searchQuery = { provider: "tavily", operation: "search", input: { query: "aranceles soja china", maxResults: 5 } };
const mapQuery = { provider: "tavily", operation: "map", input: { url: "https://www.argentina.gob.ar", limit: 20 } };

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

test("dataset routes live and die with the specialistDatasets flag and aggregate the application's workspaces", async () => {
  const { root, config, app, pathA, pathB, idA, idB, idSuelto } = await fixture();
  const call = apiHarness(config);
  try {
    const datasetA = await seed(pathA, "evidencia-a", searchQuery, { results: [1] });
    await new Promise(resolve => setTimeout(resolve, 5));
    const datasetB = await seed(pathB, "evidencia-b", mapQuery, { urls: ["https://www.argentina.gob.ar"] });
    await withFlags({ datasets: "false" }, async () => {
      assert.equal((await call("GET", `/specialist-applications/${app.id}/datasets`)).json.error, "specialist_datasets_disabled");
      assert.equal((await call("POST", `/specialist-applications/${app.id}/datasets/${datasetA.id}/refresh`)).json.error, "specialist_datasets_disabled");
      assert.equal((await call("DELETE", `/specialist-applications/${app.id}/datasets/${datasetA.id}`)).json.error, "specialist_datasets_disabled");
      assert.equal((await call("GET", "/specialist-applications")).json.datasetsEnabled, false);
    });
    await withFlags({ datasets: "true" }, async () => {
      assert.equal((await call("GET", "/specialist-applications")).json.datasetsEnabled, true);
      // Aggregate over both bound projects, newest update first.
      const listed = await call("GET", `/specialist-applications/${app.id}/datasets`);
      const datasets = listed.json.datasets as Array<Record<string, unknown>>;
      assert.deepEqual(datasets.map(entry => entry.id), [datasetB.id, datasetA.id]);
      assert.equal(datasets[0]?.workspaceId, idB);
      assert.equal(datasets[0]?.workspaceName, "proyecto-b");
      assert.equal(datasets[1]?.workspaceName, "proyecto-a");
      // ?workspace= narrows to one project.
      const filtered = await call("GET", `/specialist-applications/${app.id}/datasets?workspace=${idA}`);
      assert.deepEqual((filtered.json.datasets as Array<Record<string, unknown>>).map(entry => entry.id), [datasetA.id]);
      // A workspace removed from the server (or never known) is 404; one that exists but belongs to
      // another application is 403.
      assert.equal((await call("GET", `/specialist-applications/${app.id}/datasets?workspace=ws_inventado`)).json.error, "workspace_not_found");
      assert.equal((await call("GET", `/specialist-applications/${app.id}/datasets?workspace=${idSuelto}`)).json.error, "workspace_not_bound");
      // Detail: meta + snapshot dates + parsed latest preview.
      const detail = await call("GET", `/specialist-applications/${app.id}/datasets/${datasetA.id}`);
      assert.equal((detail.json.dataset as { id: string }).id, datasetA.id);
      assert.deepEqual(detail.json.snapshots, [(await readdir(join(pathA, "comex", "datasets", datasetA.id, "snapshots")))[0]]);
      assert.deepEqual(detail.json.latest, { results: [1] });
      assert.equal((await call("GET", `/specialist-applications/${app.id}/datasets/ds_inventado`)).json.error, "dataset_not_found");
      // An oversized snapshot never floods the panel: it comes back as { tooLarge: true }.
      const fat = await seed(pathA, "evidencia-gorda", { provider: "tavily", operation: "search", input: { query: "informe gigante", maxResults: 5 } }, { blob: "x".repeat(210_000) });
      const bigDetail = await call("GET", `/specialist-applications/${app.id}/datasets/${fat.id}`);
      assert.deepEqual(bigDetail.json.latest, { tooLarge: true });
      // Refresh refuses datasets without a re-runnable Tavily query (derived and local).
      const derived = await registerDerivedDataset(pathA, datasetA.id, "Vista limpia", { rows: [1] });
      assert.equal((await call("POST", `/specialist-applications/${app.id}/datasets/${derived.id}/refresh`)).json.error, "dataset_not_rerunnable");
      // A tavily dataset whose stored input is invalid surfaces the research error (never a fake success).
      const broken = await seed(pathA, "evidencia-rota", { provider: "tavily", operation: "extract", input: { urls: [] } }, { empty: true });
      await assert.rejects(call("POST", `/specialist-applications/${app.id}/datasets/${broken.id}/refresh?workspace=${idA}`));
      // Delete removes the folder and its index entry; unknown ids 404.
      assert.equal((await call("DELETE", `/specialist-applications/${app.id}/datasets/${datasetB.id}?workspace=${idB}`)).json.deleted, datasetB.id);
      assert.equal((await listDatasets(pathB)).length, 0);
      assert.equal((await call("DELETE", `/specialist-applications/${app.id}/datasets/${datasetB.id}`)).json.error, "dataset_not_found");
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("chat can list, read, refresh-guard and derive datasets through the scoped tool bridge", async () => {
  const { root, config, pathA, idA } = await fixture();
  try {
    const datasetA = await seed(pathA, "evidencia-a", searchQuery, { results: [1] });
    await syncLibraryToolPlugin(config as unknown as ServerConfig, idA, pathA);
    await withFlags({ datasets: "true" }, async () => {
      const listed = await runLibraryTool(config, pathA, "specialist_dataset_list", {}) as { datasets: Array<{ id: string }>; note: string };
      assert.deepEqual(listed.datasets.map(entry => entry.id), [datasetA.id]);
      assert.match(listed.note, /Contexto, agentes y skills → Datos/);
      const read = await runLibraryTool(config, pathA, "specialist_dataset_read", { id: datasetA.id }) as { dataset: { id: string }; snapshots: string[]; latest: unknown };
      assert.equal(read.dataset.id, datasetA.id);
      assert.equal(read.snapshots.length, 1);
      assert.deepEqual(read.latest, { results: [1] });
      // Huge snapshots come back as a bounded preview, like the research tools.
      const fat = await seed(pathA, "evidencia-gorda", { provider: "tavily", operation: "search", input: { query: "informe gigante", maxResults: 5 } }, { blob: "y".repeat(45_000) });
      const bigRead = await runLibraryTool(config, pathA, "specialist_dataset_read", { id: fat.id }) as { truncated: boolean; latest: unknown; note?: string };
      assert.equal(bigRead.truncated, true);
      assert.equal(typeof bigRead.latest, "string");
      assert.ok(bigRead.note);
      // Derived datasets keep lineage; oversized payloads are refused.
      const derived = await runLibraryTool(config, pathA, "specialist_dataset_derive", { sourceId: datasetA.id, name: "Precios limpios", payload: [{ precio: 1 }] }) as { dataset: { id: string; derivedFrom: string | null; provider: string; operation: string } };
      assert.equal(derived.dataset.derivedFrom, datasetA.id);
      assert.equal(derived.dataset.provider, "local");
      assert.equal(derived.dataset.operation, "derived");
      await assert.rejects(
        runLibraryTool(config, pathA, "specialist_dataset_derive", { sourceId: datasetA.id, name: "enorme", payload: { blob: "z".repeat(1_100_000) } }),
        (error) => failureStatus(error, "invalid_dataset"),
      );
      // Refresh: derived → 409 without touching the provider; broken stored query → the research error bubbles.
      await assert.rejects(runLibraryTool(config, pathA, "specialist_dataset_refresh", { id: derived.dataset.id }), (error) => failureStatus(error, "dataset_not_rerunnable"));
      const broken = await seed(pathA, "evidencia-rota", { provider: "tavily", operation: "extract", input: { urls: [] } }, { empty: true });
      await assert.rejects(runLibraryTool(config, pathA, "specialist_dataset_refresh", { id: broken.id }));
      // Route level: the tool-call schema accepts the new names with the project's descriptor token.
      const call = apiHarness(config);
      const toolFiles = await readdir(join(root, "specialists", "tool"));
      const descriptor = JSON.parse(await readFile(join(root, "specialists", "tool", toolFiles[0]!), "utf8")) as { token: string };
      const listedCall = await call("POST", "/specialist-tool", { name: "specialist_dataset_list", input: {} }, { authorization: `Bearer ${descriptor.token}`, "content-type": "application/json" });
      assert.equal(listedCall.status, 200);
      // datasetA + fat + derived + broken: all four registrations are visible to the chat.
      assert.equal((listedCall.json.result as { datasets: unknown[] }).datasets.length, 4);
      await assert.rejects(call("POST", "/specialist-tool", { name: "specialist_dataset_rename", input: {} }, { authorization: `Bearer ${descriptor.token}`, "content-type": "application/json" }));
    });
    await withFlags({ datasets: "false" }, async () => {
      await assert.rejects(runLibraryTool(config, pathA, "specialist_dataset_list", {}), (error) => failureStatus(error, "specialist_datasets_disabled"));
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a project with only datasets enabled still gets a working library descriptor", async () => {
  const { root, config, pathA, idA } = await fixture();
  const call = apiHarness(config);
  try {
    await seed(pathA, "evidencia-a", searchQuery, { results: [1] });
    await withFlags({ library: "false", tasks: "false", datasets: "true" }, async () => {
      await syncLibraryToolPlugin(config as unknown as ServerConfig, idA, pathA);
      const toolFiles = await readdir(join(root, "specialists", "tool"));
      const descriptor = JSON.parse(await readFile(join(root, "specialists", "tool", toolFiles[0]!), "utf8")) as { token: string };
      assert.notEqual(descriptor.token, "00000000000000000000000000000000");
      const listed = await call("POST", "/specialist-tool", { name: "specialist_dataset_list", input: {} }, { authorization: `Bearer ${descriptor.token}`, "content-type": "application/json" });
      assert.equal(listed.status, 200);
      assert.equal((listed.json.result as { datasets: unknown[] }).datasets.length, 1);
      // The library family rides on its own flag: datasets-only projects keep it locked.
      const locked = await call("POST", "/specialist-tool", { name: "specialist_library_list", input: {} }, { authorization: `Bearer ${descriptor.token}`, "content-type": "application/json" });
      assert.equal(locked.status, 409);
      assert.equal(locked.json.error, "specialist_library_disabled");
    });
    // All three flags off: the bridge itself closes (sentinel descriptor).
    await withFlags({ library: "false", tasks: "false", datasets: "false" }, async () => {
      await syncLibraryToolPlugin(config as unknown as ServerConfig, idA, pathA);
      const toolFiles = await readdir(join(root, "specialists", "tool"));
      const descriptor = JSON.parse(await readFile(join(root, "specialists", "tool", toolFiles[0]!), "utf8")) as { token: string };
      assert.equal(descriptor.token, "00000000000000000000000000000000");
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

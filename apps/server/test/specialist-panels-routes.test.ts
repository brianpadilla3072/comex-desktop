import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiError } from "../src/errors.js";
import { workspaceIdForPath } from "../src/workspaces.js";
import { specialistStore, applicationInput } from "../src/specialists/store.js";
import { recordDatasetRun, readLatestDiff, writeDatasetDiff } from "../src/specialists/datasets.js";
import { diffSnapshots } from "../src/specialists/diffs.js";
import { runLibraryTool, syncLibraryToolPlugin } from "../src/specialists/library-tool-api.js";
import { registerSpecialistRoutes } from "../src/specialists/routes.js";
import { matchRoute, type RequestContext, type Route } from "../src/routes/registry.js";
import type { ServerConfig } from "../src/types.js";

const input = (name: string) => applicationInput.parse({ userName: "Usuario de prueba", name, specialty: `Especialidad ${name}`, personality: `PERSONA_${name}`, template: "custom" });

type Flags = { panels?: "true" | "false" };
function withFlags(flags: Flags, run: () => Promise<void>) {
  const before = process.env.DEN_FEATURE_SPECIALIST_PANELS;
  if (flags.panels !== undefined) process.env.DEN_FEATURE_SPECIALIST_PANELS = flags.panels;
  return run().finally(() => { if (before === undefined) delete process.env.DEN_FEATURE_SPECIALIST_PANELS; else process.env.DEN_FEATURE_SPECIALIST_PANELS = before; });
}

const searchQuery = { provider: "tavily", operation: "search", input: { query: "precios soja", maxResults: 5 } };
const rows = [
  { fecha: "2026-11-07", cierre: 480 },
  { fecha: "2026-11-08", cierre: 486 },
  { fecha: "2026-11-09", cierre: 491 },
];
const spec = {
  title: "Soja — cierre",
  source: { dataset: "search-precios-soja" },
  refresh: { watch: "latest" },
  blocks: [
    { type: "stat", field: "cierre", agg: "last" },
    { type: "line", x: "fecha", y: ["cierre"], title: "Precio" },
    { type: "table", limit: 20, sort: { by: "fecha", desc: true } },
    { type: "changes" },
  ],
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "specialists-panels-routes-"));
  const config = { configPath: join(root, "server.json"), port: 4711, token: "test-token", workspaces: [] as Array<{ id: string; path: string }> };
  const store = await specialistStore(config as unknown as ServerConfig);
  const app = store.create(input("Alpha"), { agents: 0, skills: 0 });
  const pathA = join(root, "proyecto-a"); const pathB = join(root, "proyecto-b");
  await mkdir(join(pathA, "comex", "fuentes", "tavily"), { recursive: true });
  await mkdir(join(pathB, "comex", "fuentes", "tavily"), { recursive: true });
  const idA = workspaceIdForPath(pathA); const idB = workspaceIdForPath(pathB);
  config.workspaces.push({ id: idA, path: pathA }, { id: idB, path: pathB });
  store.bind(idA, app.id, pathA);
  store.bind(idB, app.id, pathB);
  return { root, config, app, pathA, pathB, idA, idB };
}

async function seed(directory: string, name: string, payload: unknown) {
  const relative = `comex/fuentes/tavily/${name}.json`;
  await writeFile(join(directory, relative), JSON.stringify(payload));
  return recordDatasetRun(directory, { provider: "tavily", operation: "search", input: { query: "precios soja", maxResults: 5 } }, relative).then(r => r.dataset);
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

test("panels: write, list, resolve per project, and per-project failure stays local", async () => {
  const { root, config, app, pathA } = await fixture();
  const call = apiHarness(config);
  try {
    const dataset = await seed(pathA, "a", rows);
    await withFlags({ panels: "false" }, async () => {
      assert.equal((await call("GET", `/specialist-applications/${app.id}/panels`)).json.error, "specialist_panels_disabled");
      assert.equal((await call("PUT", `/specialist-applications/${app.id}/panels/soja`, spec)).json.error, "specialist_panels_disabled");
    });
    await withFlags({ panels: "true" }, async () => {
      const written = await call("PUT", `/specialist-applications/${app.id}/panels/soja`, spec);
      assert.equal(written.status, 200);
      assert.equal((written.json.spec as { title: string }).title, "Soja — cierre");
      const listed = await call("GET", `/specialist-applications/${app.id}/panels`);
      assert.equal((listed.json.panels as Array<Record<string, unknown>>).length, 1);
      assert.equal(((listed.json.panels as Array<Record<string, unknown>>)[0] as { title: string }).title, "Soja — cierre");
      // Unknown fields fail loud instead of being silently dropped.
      const bad = await call("PUT", `/specialist-applications/${app.id}/panels/soja`, { ...spec, typo: true });
      assert.equal(bad.status, 422);
      // Resolve: project A has the dataset, project B doesn't → B fails loudly, A paints.
      const resolved = await call("GET", `/specialist-applications/${app.id}/panels/soja/resolve`);
      const resolutions = resolved.json.resolutions as Array<Record<string, unknown>>;
      assert.equal(resolutions.length, 2);
      const okOne = resolutions.find(entry => entry.ok === true);
      const badOne = resolutions.find(entry => entry.ok === false);
      assert.ok(okOne);
      assert.deepEqual(okOne!.data, rows);
      assert.ok(badOne);
      assert.match(String(badOne!.error), /no existe en este proyecto/);
      // The changes block source: an F2 diff written for project A rides along; B has none.
      const diff = diffSnapshots(rows, [...rows, { fecha: "2026-11-10", cierre: 495 }]);
      assert.match(diff.summary, /\+1/);
      await writeDatasetDiff(pathA, dataset.id, { at: 1_700_000_000_000, diff });
      const withDiff = await call("GET", `/specialist-applications/${app.id}/panels/soja/resolve`);
      const okAgain = (withDiff.json.resolutions as Array<Record<string, unknown>>).find(entry => entry.ok === true);
      assert.match(JSON.stringify(okAgain!.diff), /\+1 nuevo/);
      assert.equal((await readLatestDiff(pathA, dataset.id) as { diff: { added: number } }).diff.added, 1);
      // Delete + 404s.
      assert.equal((await call("DELETE", `/specialist-applications/${app.id}/panels/soja`)).json.deleted, "soja");
      assert.equal((await call("GET", `/specialist-applications/${app.id}/panels/soja/resolve`)).status, 404);
      assert.equal((await call("DELETE", `/specialist-applications/${app.id}/panels/soja`)).json.error, "panel_not_found");
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the chat can write, read and delete panels through the tool bridge", async () => {
  const { root, config, pathA, idA } = await fixture();
  try {
    const dataset = await seed(pathA, "a", rows);
    void dataset;
    await syncLibraryToolPlugin(config as unknown as ServerConfig, idA, pathA);
    await withFlags({ panels: "true" }, async () => {
      const written = await runLibraryTool(config, pathA, "specialist_panel_write", { name: "soja", spec }) as { panel: string; created: boolean };
      assert.equal(written.panel, "soja");
      assert.equal(written.created, true);
      const read = await runLibraryTool(config, pathA, "specialist_panel_read", { name: "soja" }) as { spec: { title: string }; resolution: { ok: boolean; data: unknown } };
      assert.equal(read.spec.title, "Soja — cierre");
      assert.equal(read.resolution.ok, true);
      assert.deepEqual(read.resolution.data, rows);
      const listed = await runLibraryTool(config, pathA, "specialist_panel_list", {}) as { panels: Array<{ name: string }> };
      assert.deepEqual(listed.panels.map(entry => entry.name), ["soja"]);
      const deleted = await runLibraryTool(config, pathA, "specialist_panel_delete", { name: "soja" }) as { deleted: string };
      assert.equal(deleted.deleted, "soja");
      // Route level: schema accepts the new names with the descriptor token.
      const call = apiHarness(config);
      const { readdir } = await import("node:fs/promises");
      const toolFiles = await readdir(join(root, "specialists", "tool"));
      const descriptor = JSON.parse(await readFile(join(root, "specialists", "tool", toolFiles[0]!), "utf8")) as { token: string };
      await call("POST", "/specialist-tool", { name: "specialist_panel_write", input: { name: "soja", spec } }, { authorization: `Bearer ${descriptor.token}`, "content-type": "application/json" });
      const viaRoute = await call("POST", "/specialist-tool", { name: "specialist_panel_list", input: {} }, { authorization: `Bearer ${descriptor.token}`, "content-type": "application/json" });
      assert.equal(viaRoute.status, 200);
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

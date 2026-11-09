import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiError } from "../src/errors.js";
import { workspaceIdForPath } from "../src/workspaces.js";
import { specialistStore, applicationInput } from "../src/specialists/store.js";
import { listProposals } from "../src/specialists/proposals.js";
import { listDatasets } from "../src/specialists/datasets.js";
import { readPanelSpec } from "../src/specialists/panels.js";
import { runLibraryTool, syncLibraryToolPlugin } from "../src/specialists/library-tool-api.js";
import { registerSpecialistRoutes } from "../src/specialists/routes.js";
import { matchRoute, type RequestContext, type Route } from "../src/routes/registry.js";
import type { ServerConfig } from "../src/types.js";

const input = (name: string) => applicationInput.parse({ userName: "Usuario de prueba", name, specialty: `Especialidad ${name}`, personality: `PERSONA_${name}`, template: "custom" });

const SPEC = JSON.stringify({
  openapi: "3.1.0",
  info: { title: "Mercado API", version: "1.0" },
  servers: [{ url: "https://api.ejemplo.com/v1" }],
  paths: {
    "/precios": { get: { operationId: "listarPrecios", responses: {} } },
    "/ordenes": { post: { operationId: "crearOrden" }, get: { operationId: "listarOrdenes" } },
  },
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "specialists-openapi-"));
  const config = { configPath: join(root, "server.json"), port: 4711, token: "test-token", workspaces: [] as Array<{ id: string; path: string }> };
  const store = await specialistStore(config as unknown as ServerConfig);
  const app = store.create(input("Alpha"), { agents: 0, skills: 0 });
  const pathA = join(root, "proyecto-a");
  await mkdir(pathA, { recursive: true });
  const idA = workspaceIdForPath(pathA);
  config.workspaces.push({ id: idA, path: pathA });
  store.bind(idA, app.id, pathA);
  return { root, config, app, pathA, idA };
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

test("an OpenAPI spec becomes a plan proposal: skill + openapi dataset + table panel", async () => {
  const { root, config, app, pathA, idA } = await fixture();
  const call = apiHarness(config);
  try {
    await syncLibraryToolPlugin(config as unknown as ServerConfig, idA, pathA);
    await withFlags(true, async () => {
      const proposed = await runLibraryTool(config, pathA, "specialist_openapi_propose", { spec: SPEC }) as { proposal: { kind: string; name: string }; operations: number; note: string };
      assert.equal(proposed.proposal.kind, "plan");
      assert.equal(proposed.proposal.name, "api-mercado-api");
      assert.equal(proposed.operations, 2); // two GETs (the POST is ignored)
      assert.match(proposed.note, /credenciales/);
      const inbox = await listProposals(config, app.id);
      assert.equal(inbox.length, 1);
      const plan = JSON.parse(inbox[0]!.content) as { skill: { name: string; content: string }; dataset: { name: string; query: { provider: string; input: Record<string, unknown> } }; panel: { name: string } };
      assert.match(plan.skill.name, /^consultar-mercado-api$/);
      assert.match(plan.skill.content, /NUNCA embebidas/); // credentials by integration, never embedded
      assert.equal(plan.dataset.query.provider, "openapi");
      assert.equal(plan.dataset.query.input.url, "https://api.ejemplo.com/v1/precios");
      // Accepting applies all three pieces through the normal plan flow.
      const accepted = await call("POST", `/specialist-applications/${app.id}/library/proposals/${inbox[0]!.id}/accept`, {});
      assert.equal(accepted.status, 200);
      const applied = accepted.json.applied as Array<{ piece: string; ok: boolean }>;
      assert.deepEqual(applied.map(entry => [entry.piece, entry.ok]), [["skill", true], ["dataset", true], ["panel", true]]);
      const datasets = await listDatasets(pathA);
      assert.equal(datasets.length, 1);
      assert.equal(datasets[0]!.provider, "openapi");
      assert.equal(datasets[0]!.lastSnapshotAt, null); // query-only until first run
      const panel = await readPanelSpec(config, app.id, "mercado-api-panel");
      assert.equal(panel.title, "mercado-api");
      // Refresh refuses non-Tavily queries loud (no fake re-runs).
      const refresh = await call("POST", `/specialist-applications/${app.id}/datasets/${datasets[0]!.id}/refresh?workspace=${idA}`, {});
      assert.equal(refresh.json.error, "dataset_not_rerunnable");
    });
    // Validation fails loud: no paths, no JSON, no GETs.
    await withFlags(true, async () => {
      await assert.rejects(runLibraryTool(config, pathA, "specialist_openapi_propose", { spec: "no-json" }), (e) => e instanceof ApiError && e.code === "invalid_openapi");
      await assert.rejects(runLibraryTool(config, pathA, "specialist_openapi_propose", { spec: JSON.stringify({ paths: {} }) }), (e) => e instanceof ApiError && e.code === "invalid_openapi");
      await assert.rejects(runLibraryTool(config, pathA, "specialist_openapi_propose", { spec: JSON.stringify({ paths: { "/x": { post: {} } } }) }), (e) => e instanceof ApiError && e.code === "invalid_openapi");
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function withFlags(enabled: boolean, run: () => Promise<void>) {
  const keys = ["DEN_FEATURE_SPECIALIST_LIBRARY", "DEN_FEATURE_SPECIALIST_DATASETS", "DEN_FEATURE_SPECIALIST_PANELS"];
  const before = new Map(keys.map(key => [key, process.env[key]]));
  if (enabled) for (const key of keys) process.env[key] = "true";
  return run().finally(() => {
    for (const [key, value] of before) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
}

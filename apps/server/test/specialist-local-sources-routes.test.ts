import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiError } from "../src/errors.js";
import { workspaceIdForPath } from "../src/workspaces.js";
import { specialistStore, applicationInput } from "../src/specialists/store.js";
import { runLibraryTool, syncLibraryToolPlugin } from "../src/specialists/library-tool-api.js";
import { registerSpecialistRoutes } from "../src/specialists/routes.js";
import { matchRoute, type RequestContext, type Route } from "../src/routes/registry.js";
import type { ServerConfig } from "../src/types.js";

const input = (name: string) => applicationInput.parse({ userName: "Usuario de prueba", name, specialty: `Especialidad ${name}`, personality: `PERSONA_${name}`, template: "custom" });
const longSentence = "La exportación de soja creció un tres por ciento en el último trimestre medido por la Bolsa de Comercio. ";

function withEnv(values: Record<string, string>, run: () => Promise<void>) {
  const before = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  return run().finally(() => {
    for (const [key, value] of before) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "specialists-local-routes-"));
  const config = { configPath: join(root, "server.json"), port: 4711, token: "test-token", workspaces: [] as Array<{ id: string; path: string }> };
  const store = await specialistStore(config as unknown as ServerConfig);
  const app = store.create(input("Alpha"), { agents: 0, skills: 0 });
  const pathA = join(root, "proyecto-a");
  await mkdir(join(pathA, "datos"), { recursive: true });
  await writeFile(join(pathA, "datos", "informe.md"), longSentence.repeat(12));
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

const ALL = { DEN_FEATURE_SPECIALIST_SOURCES: "true", DEN_FEATURE_SOURCES_LOCAL_FILES: "true" };

test("route + tool register a local file as a citable source, flag-gated", async () => {
  const { root, config, app, pathA, idA } = await fixture();
  const call = apiHarness(config);
  try {
    await withEnv({ ...ALL, DEN_FEATURE_SOURCES_LOCAL_FILES: "false" }, async () => {
      assert.equal((await call("POST", `/specialist-applications/${app.id}/sources/local?workspace=${idA}`, { path: "datos/informe.md" })).json.error, "sources_local_files_disabled");
      await assert.rejects(runLibraryTool(config, pathA, "specialist_source_add", { path: "datos/informe.md" }), (e) => e instanceof ApiError && e.code === "sources_local_files_disabled");
    });
    await withEnv(ALL, async () => {
      const created = await call("POST", `/specialist-applications/${app.id}/sources/local?workspace=${idA}`, { path: "datos/informe.md", title: "Informe local" });
      assert.equal(created.status, 201);
      assert.equal((created.json.source as { provider: string }).provider, "file");
      assert.equal((created.json.source as { title: string }).title, "Informe local");
      assert.equal((created.json.source as { workspaceId: string }).workspaceId, idA);
      const listed = await call("GET", `/specialist-applications/${app.id}/sources?workspace=${idA}`);
      assert.equal((listed.json.sources as Array<Record<string, unknown>>).length, 1);
      // Tool path.
      await syncLibraryToolPlugin(config as unknown as ServerConfig, idA, pathA);
      const viaTool = await runLibraryTool(config, pathA, "specialist_source_add", { path: "datos/informe.md" }) as { source: { provider: string } };
      assert.equal(viaTool.source.provider, "file");
      // Unknown tool names / outside paths fail loud.
      assert.equal((await call("POST", `/specialist-applications/${app.id}/sources/local?workspace=${idA}`, { path: "../x.md" })).json.error, "invalid_source");
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

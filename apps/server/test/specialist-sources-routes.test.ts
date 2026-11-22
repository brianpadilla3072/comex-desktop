import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiError } from "../src/errors.js";
import { workspaceIdForPath } from "../src/workspaces.js";
import { specialistStore, applicationInput } from "../src/specialists/store.js";
import { registerSource } from "../src/specialists/sources.js";
import { recordDatasetRun } from "../src/specialists/datasets.js";
import { runLibraryTool, syncLibraryToolPlugin } from "../src/specialists/library-tool-api.js";
import { registerSpecialistRoutes } from "../src/specialists/routes.js";
import { matchRoute, type RequestContext, type Route } from "../src/routes/registry.js";
import type { ServerConfig } from "../src/types.js";

const input = (name: string) => applicationInput.parse({ userName: "Usuario de prueba", name, specialty: `Especialidad ${name}`, personality: `PERSONA_${name}`, template: "custom" });

type Flags = { sources?: "true" | "false" };
function withFlags(flags: Flags, run: () => Promise<void>) {
  const before = process.env.DEN_FEATURE_SPECIALIST_SOURCES;
  if (flags.sources !== undefined) process.env.DEN_FEATURE_SPECIALIST_SOURCES = flags.sources;
  return run().finally(() => { if (before === undefined) delete process.env.DEN_FEATURE_SPECIALIST_SOURCES; else process.env.DEN_FEATURE_SPECIALIST_SOURCES = before; });
}

const longSentence = "La exportación de soja creció un tres por ciento en el último trimestre medido por la Bolsa de Comercio. ";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "specialists-sources-routes-"));
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

const searchQuery = { provider: "tavily", operation: "search", input: { query: "aranceles soja china", maxResults: 5 } };

async function seed(directory: string, name: string) {
  const relative = `comex/fuentes/tavily/${name}.json`;
  await writeFile(join(directory, relative), JSON.stringify({ results: [{ title: "Soja", content: longSentence.repeat(12), url: "https://ejemplo.cl/soja" }] }));
  const { dataset } = await recordDatasetRun(directory, searchQuery, relative);
  const source = await registerSource(directory, { provider: "tavily", evidencePath: relative, title: "Investigación soja", datasetId: dataset.id });
  return { dataset, source };
}

test("sources routes aggregate workspaces, return passages and single anchors", async () => {
  const { root, config, app, pathA, pathB, idA, idB } = await fixture();
  const call = apiHarness(config);
  try {
    const { source: sourceA } = await seed(pathA, "a");
    const { source: sourceB } = await seed(pathB, "b");
    await withFlags({ sources: "false" }, async () => {
      assert.equal((await call("GET", `/specialist-applications/${app.id}/sources`)).json.error, "specialist_sources_disabled");
      const catalog = await call("GET", "/specialist-applications");
      assert.equal(catalog.json.sourcesEnabled, false);
    });
    await withFlags({ sources: "true" }, async () => {
      const listed = await call("GET", `/specialist-applications/${app.id}/sources`);
      const sources = listed.json.sources as Array<Record<string, unknown>>;
      assert.equal(sources.length, 2);
      assert.deepEqual(new Set(sources.map(entry => entry.workspaceName)), new Set(["proyecto-a", "proyecto-b"]));
      // Workspace narrowing + unknown workspace 404, unbound 403.
      const filtered = await call("GET", `/specialist-applications/${app.id}/sources?workspace=${idA}`);
      assert.deepEqual((filtered.json.sources as Array<Record<string, unknown>>).map(entry => entry.id), [sourceA.id]);
      assert.equal((await call("GET", `/specialist-applications/${app.id}/sources?workspace=ws_inventado`)).json.error, "workspace_not_found");
      // Detail builds the passage list (lazy chunks).
      const detail = await call("GET", `/specialist-applications/${app.id}/sources/${sourceA.id}?workspace=${idA}`);
      assert.equal(detail.json.ok, true);
      assert.equal((detail.json.source as { id: string }).id, sourceA.id);
      assert.equal(detail.json.chunk, null);
      assert.ok((detail.json.chunks as string[]).length >= 2);
      assert.match((detail.json.chunks as string[])[1]!, /soja/);
      // One anchor: the exact passage, addressed by its citation index.
      const anchor = await call("GET", `/specialist-applications/${app.id}/sources/${sourceA.id}?workspace=${idA}&chunk=1`);
      assert.equal(anchor.json.ok, true);
      assert.equal(anchor.json.chunk, 1);
      assert.match(String(anchor.json.text), /soja/);
      // A stale anchor fails loud, never with invented text.
      const stale = await call("GET", `/specialist-applications/${app.id}/sources/${sourceA.id}?workspace=${idA}&chunk=999`);
      assert.equal(stale.json.ok, false);
      assert.match(String(stale.json.error), /no existe/);
      // Unknown source 404.
      assert.equal((await call("GET", `/specialist-applications/${app.id}/sources/src_inventado`)).json.error, "source_not_found");
      void sourceB;
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the chat can read a source index and resolve one anchor, never citing from memory", async () => {
  const { root, config, pathA, idA } = await fixture();
  try {
    const { source } = await seed(pathA, "a");
    await syncLibraryToolPlugin(config as unknown as ServerConfig, idA, pathA);
    await withFlags({ sources: "true" }, async () => {
      const index = await runLibraryTool(config, pathA, "specialist_source_read", { id: source.id }) as { source: { id: string }; totalChunks: number; chunks: string[]; note: string };
      assert.equal(index.source.id, source.id);
      assert.ok(index.totalChunks >= 2);
      assert.match(index.note, /nunca cites de memoria/);
      const cited = await runLibraryTool(config, pathA, "specialist_source_read", { id: source.id, chunk: 0 }) as { ok: boolean; text: string };
      assert.equal(cited.ok, true);
      assert.match(cited.text, /soja/);
      const stale = await runLibraryTool(config, pathA, "specialist_source_read", { id: source.id, chunk: 999 }) as { ok: boolean; error: string };
      assert.equal(stale.ok, false);
      assert.match(stale.error, /no existe/);
      await assert.rejects(runLibraryTool(config, pathA, "specialist_source_read", { id: "src_inventado" }), (error) => error instanceof ApiError && error.code === "source_not_found");
      // Route level: the tool-call schema accepts the new name (dead-tool regression guard).
      const call = apiHarness(config);
      const { readdir, readFile } = await import("node:fs/promises");
      const toolFiles = await readdir(join(root, "specialists", "tool"));
      const descriptor = JSON.parse(await readFile(join(root, "specialists", "tool", toolFiles[0]!), "utf8")) as { token: string };
      const viaRoute = await call("POST", "/specialist-tool", { name: "specialist_source_read", input: { id: source.id, chunk: 1 } }, { authorization: `Bearer ${descriptor.token}`, "content-type": "application/json" });
      assert.equal(viaRoute.status, 200);
      assert.equal((viaRoute.json.result as { ok: boolean }).ok, true);
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

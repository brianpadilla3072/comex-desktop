import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiError } from "../src/errors.js";
import { workspaceIdForPath } from "../src/workspaces.js";
import { specialistStore, applicationInput } from "../src/specialists/store.js";
import { recordDatasetRun } from "../src/specialists/datasets.js";
import { registerSource } from "../src/specialists/sources.js";
import { runLibraryTool, syncLibraryToolPlugin } from "../src/specialists/library-tool-api.js";
import { registerSpecialistRoutes } from "../src/specialists/routes.js";
import { matchRoute, type RequestContext, type Route } from "../src/routes/registry.js";
import type { ServerConfig } from "../src/types.js";

const input = (name: string) => applicationInput.parse({ userName: "Usuario de prueba", name, specialty: `Especialidad ${name}`, personality: `PERSONA_${name}`, template: "custom" });

type Flags = { outputs?: "true" | "false" };
function withFlags(flags: Flags, run: () => Promise<void>) {
  const before = process.env.DEN_FEATURE_STUDIO_OUTPUTS;
  if (flags.outputs !== undefined) process.env.DEN_FEATURE_STUDIO_OUTPUTS = flags.outputs;
  return run().finally(() => { if (before === undefined) delete process.env.DEN_FEATURE_STUDIO_OUTPUTS; else process.env.DEN_FEATURE_STUDIO_OUTPUTS = before; });
}

const longSentence = "La exportación de soja creció un tres por ciento en el último trimestre medido por la Bolsa de Comercio. ";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "specialists-outputs-routes-"));
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

async function seedSource(directory: string, name: string) {
  const relative = `comex/fuentes/tavily/${name}.json`;
  await writeFile(join(directory, relative), JSON.stringify({ results: [{ title: "Soja", content: longSentence.repeat(12), url: "https://ejemplo.cl/soja" }] }));
  const { dataset } = await recordDatasetRun(directory, { provider: "tavily", operation: "search", input: { query: "aranceles soja", maxResults: 5 } }, relative);
  return registerSource(directory, { provider: "tavily", evidencePath: relative, title: "Investigación soja", datasetId: dataset.id });
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

const report = (sourceId: string) => "# Informe soja\n\nLa soja creció [fuente:" + sourceId + "#1].";

test("outputs: create, list, read, audit (valid anchors), update and delete", async () => {
  const { root, config, app, pathA, idA } = await fixture();
  const call = apiHarness(config);
  try {
    const source = await seedSource(pathA, "a");
    await withFlags({ outputs: "false" }, async () => {
      assert.equal((await call("GET", `/specialist-applications/${app.id}/outputs`)).json.error, "studio_outputs_disabled");
    });
    await withFlags({ outputs: "true" }, async () => {
      const created = await call("POST", `/specialist-applications/${app.id}/outputs?workspace=${idA}`, { kind: "report", title: "Informe soja", content: report(source.id), fromSources: [source.id] });
      assert.equal(created.status, 201);
      const outputId = (created.json.output as { id: string }).id;
      assert.equal((created.json.output as { title: string }).title, "Informe soja");
      const listed = await call("GET", `/specialist-applications/${app.id}/outputs`);
      assert.equal((listed.json.outputs as Array<Record<string, unknown>>).length, 1);
      const read = await call("GET", `/specialist-applications/${app.id}/outputs/${outputId}?workspace=${idA}`);
      assert.match(String(read.json.content), /creció/);
      const audit = await call("GET", `/specialist-applications/${app.id}/outputs/${outputId}/audit?workspace=${idA}`);
      assert.deepEqual((audit.json.audit as { total: number; valid: number }).total, 1);
      assert.deepEqual((audit.json.audit as { total: number; valid: number }).valid, 1);
      // Invalid kind shape fails at write, not at render.
      const broken = await call("POST", `/specialist-applications/${app.id}/outputs?workspace=${idA}`, { kind: "mindmap", title: "sin fence", content: "texto suelto" });
      assert.equal(broken.status, 422);
      // Update regenerates the same id.
      const updated = await call("PUT", `/specialist-applications/${app.id}/outputs/${outputId}?workspace=${idA}`, { kind: "report", title: "Informe soja v2", content: report(source.id) });
      assert.equal(updated.status, 200);
      assert.equal((updated.json.output as { id: string }).id, outputId);
      assert.equal((updated.json.output as { title: string }).title, "Informe soja v2");
      assert.equal((await call("DELETE", `/specialist-applications/${app.id}/outputs/${outputId}?workspace=${idA}`)).json.deleted, outputId);
      assert.equal((await call("GET", `/specialist-applications/${app.id}/outputs/${outputId}`)).json.error, "output_not_found");
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the generate tool returns the citation audit with the output (never silent)", async () => {
  const { root, config, pathA, idA } = await fixture();
  try {
    const source = await seedSource(pathA, "a");
    await syncLibraryToolPlugin(config as unknown as ServerConfig, idA, pathA);
    await withFlags({ outputs: "true" }, async () => {
      const good = await runLibraryTool(config, pathA, "specialist_output_generate", { kind: "report", title: "Con cita", content: report(source.id), fromSources: [source.id] }) as { audit: { total: number; valid: number; invalid: unknown[] }; note: string };
      assert.equal(good.audit.valid, 1);
      assert.match(good.note, /resuelve/);
      const unanchored = await runLibraryTool(config, pathA, "specialist_output_generate", { kind: "table", title: "Sin cita", content: JSON.stringify([{ pais: "China", arancel: 23 }]) }) as { audit: { total: number }; note: string };
      assert.equal(unanchored.audit.total, 0);
      assert.match(unanchored.note, /SIN anclas/);
      const brokenCitation = await runLibraryTool(config, pathA, "specialist_output_generate", { kind: "report", title: "Rota", content: "# T\n\nLo inventé [fuente:src_inventado#3]." }) as { audit: { invalid: unknown[] }; note: string };
      assert.equal(brokenCitation.audit.invalid.length, 1);
      assert.match(brokenCitation.note, /no resuelven/);
      await assert.rejects(runLibraryTool(config, pathA, "specialist_output_generate", { kind: "quiz", title: "mal", content: JSON.stringify([{ question: "q", options: ["a"], answer: 5 }]) }),
        (error) => error instanceof ApiError && error.code === "invalid_output");
      const listed = await runLibraryTool(config, pathA, "specialist_output_list", {}) as { outputs: Array<{ title: string }> };
      assert.equal(listed.outputs.length, 3);
      // Route level: schema accepts the new names with the descriptor token.
      const call = apiHarness(config);
      const { readdir, readFile } = await import("node:fs/promises");
      const toolFiles = await readdir(join(root, "specialists", "tool"));
      const descriptor = JSON.parse(await readFile(join(root, "specialists", "tool", toolFiles[0]!), "utf8")) as { token: string };
      const viaRoute = await call("POST", "/specialist-tool", { name: "specialist_output_generate", input: { kind: "report", title: "Ruta", content: "# T" } }, { authorization: `Bearer ${descriptor.token}`, "content-type": "application/json" });
      assert.equal(viaRoute.status, 200);
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

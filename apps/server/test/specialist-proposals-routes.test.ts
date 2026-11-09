import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiError } from "../src/errors.js";
import { workspaceIdForPath } from "../src/workspaces.js";
import { specialistStore, applicationInput } from "../src/specialists/store.js";
import { addProposal, listProposals } from "../src/specialists/proposals.js";
import { listTasks } from "../src/specialists/tasks.js";
import { listDatasets } from "../src/specialists/datasets.js";
import { readPanelSpec } from "../src/specialists/panels.js";
import { runLibraryTool, syncLibraryToolPlugin } from "../src/specialists/library-tool-api.js";
import { registerSpecialistRoutes } from "../src/specialists/routes.js";
import { matchRoute, type RequestContext, type Route } from "../src/routes/registry.js";
import type { ServerConfig } from "../src/types.js";

const input = (name: string) => applicationInput.parse({ userName: "Usuario de prueba", name, specialty: `Especialidad ${name}`, personality: `PERSONA_${name}`, template: "custom" });

type Flags = { library?: "true" | "false"; tasks?: "true" | "false"; datasets?: "true" | "false"; panels?: "true" | "false" };
function withFlags(flags: Flags, run: () => Promise<void>) {
  const pairs: Array<[string, "true" | "false" | undefined]> = [
    ["DEN_FEATURE_SPECIALIST_LIBRARY", flags.library],
    ["DEN_FEATURE_SCHEDULED_TASKS", flags.tasks],
    ["DEN_FEATURE_SPECIALIST_DATASETS", flags.datasets],
    ["DEN_FEATURE_SPECIALIST_PANELS", flags.panels],
  ];
  const before = new Map(pairs.map(([name]) => [name, process.env[name]]));
  for (const [name, value] of pairs) { if (value !== undefined) process.env[name] = value; }
  return run().finally(() => {
    for (const [name, value] of before) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  });
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "specialists-proposals-routes-"));
  const config = { configPath: join(root, "server.json"), port: 4711, token: "test-token", workspaces: [] as Array<{ id: string; path: string }> };
  const store = await specialistStore(config as unknown as ServerConfig);
  const app = store.create(input("Alpha"), { agents: 0, skills: 0 });
  const pathA = join(root, "proyecto-a");
  await mkdir(join(pathA, "comex", "fuentes"), { recursive: true });
  const idA = workspaceIdForPath(pathA);
  config.workspaces.push({ id: idA, path: pathA });
  store.bind(idA, app.id, pathA);
  return { root, config, store, app, pathA, idA };
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

const base = { description: "Se repite cada semana.", reason: "Lo enseñó la persona." };

test("accepting a task proposal creates the task PAUSED and keeps the schedule visible", async () => {
  const { root, config, app } = await fixture();
  const call = apiHarness(config);
  try {
    const created = await addProposal(config, app.id, { ...base, kind: "task", name: "refrescar aranceles", content: JSON.stringify({ prompt: "Consultá las fuentes.", schedule: { kind: "interval", everyMinutes: 20 } }) });
    const proposalId = created.proposals[0]!.id;
    await withFlags({ tasks: "true" }, async () => {
      const accepted = await call("POST", `/specialist-applications/${app.id}/library/proposals/${proposalId}/accept`, {});
      assert.equal(accepted.status, 200);
      const applied = accepted.json.applied as Array<{ piece: string; ok: boolean; id?: string }>;
      assert.equal(applied.length, 1);
      assert.equal(applied[0]!.piece, "tarea");
      assert.equal(applied[0]!.ok, true);
      assert.ok(applied[0]!.id?.startsWith("task_"));
      const tasks = await listTasks(config, app.id);
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0]!.enabled, false);
      assert.equal(tasks[0]!.nextRunAt, null);
      assert.equal(tasks[0]!.name, "refrescar aranceles");
      assert.deepEqual(await listProposals(config, app.id), []);
    });
    // With tasks off the proposal stays and the accept says exactly which piece could not run.
    const again = await addProposal(config, app.id, { ...base, kind: "task", name: "otra", content: JSON.stringify({ prompt: "P.", schedule: { kind: "daily", hour: 8, minute: 0 } }) });
    await withFlags({ tasks: "false" }, async () => {
      const accepted = await call("POST", `/specialist-applications/${app.id}/library/proposals/${again.proposals[0]!.id}/accept`, {});
      assert.equal(accepted.status, 200);
      assert.deepEqual(accepted.json.applied, [{ piece: "tarea", ok: false, detail: "Las tareas programadas están desactivadas." }]);
      assert.equal((await listTasks(config, app.id)).length, 1);
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a hand-edited task proposal fails loud BEFORE leaving the inbox", async () => {
  const { root, config, app } = await fixture();
  const call = apiHarness(config);
  try {
    const created = await addProposal(config, app.id, { ...base, kind: "task", name: "rota", content: JSON.stringify({ prompt: "P.", schedule: { kind: "interval", everyMinutes: 20 } }) });
    const proposalId = created.proposals[0]!.id;
    const file = join(root, "specialists", app.id, "proposals.json");
    const proposals = JSON.parse(await readFile(file, "utf8")) as Array<Record<string, unknown>>;
    proposals[0]!.content = "{ roto";
    await writeFile(file, JSON.stringify(proposals));
    await withFlags({ tasks: "true" }, async () => {
      const accepted = await call("POST", `/specialist-applications/${app.id}/library/proposals/${proposalId}/accept`, {});
      assert.equal(accepted.status, 422);
      assert.equal(accepted.json.error, "invalid_proposal");
      assert.equal((await listProposals(config, app.id)).length, 1);
      assert.equal((await listTasks(config, app.id)).length, 0);
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a plan proposal applies each piece and reports the ones that could not run", async () => {
  const { root, config, app, pathA } = await fixture();
  const call = apiHarness(config);
  try {
    const plan = {
      skill: { name: "traer-aranceles", description: "Busca aranceles.", content: "# pasos" },
      dataset: { name: "aranceles", query: { provider: "tavily", operation: "search", input: { query: "arancel soja" } } },
      panel: { name: "aranceles-panel", spec: { title: "Aranceles", source: { dataset: "aranceles" }, blocks: [{ type: "table", limit: 10 }] } },
      task: { prompt: "Refrescá y repintá.", schedule: { kind: "interval", everyMinutes: 20 } },
    };
    const created = await addProposal(config, app.id, { ...base, kind: "plan", name: "programa aranceles", content: JSON.stringify(plan) });
    const proposalId = created.proposals[0]!.id;
    // Panels off: the plan still applies its other pieces and names the panel as the failure.
    await withFlags({ library: "true", tasks: "true", datasets: "true", panels: "false" }, async () => {
      const accepted = await call("POST", `/specialist-applications/${app.id}/library/proposals/${proposalId}/accept`, {});
      assert.equal(accepted.status, 200);
      const applied = accepted.json.applied as Array<{ piece: string; ok: boolean; detail?: string }>;
      assert.deepEqual(applied.map(entry => [entry.piece, entry.ok]), [["skill", true], ["dataset", true], ["panel", false], ["tarea", true]]);
      assert.match(applied[2]!.detail!, /paneles están desactivados/);
      // Skill materialized into the application library (specialists/<app>/pack/skills/).
      const skill = await readFile(join(root, "specialists", app.id, "pack", "skills", "traer-aranceles", "SKILL.md"), "utf8");
      assert.match(skill, /traer-aranceles/);
      // Dataset exists as a re-runnable query with zero snapshots (never a fake empty snapshot).
      const datasets = await listDatasets(pathA);
      assert.equal(datasets.length, 1);
      assert.equal(datasets[0]!.snapshots, 0);
      assert.equal(datasets[0]!.lastSnapshotAt, null);
      const detail = await call("GET", `/specialist-applications/${app.id}/datasets/${datasets[0]!.id}?workspace=${workspaceIdForPath(pathA)}`);
      assert.equal(detail.json.latest, null);
      // Task paused like a standalone task proposal.
      const tasks = await listTasks(config, app.id);
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0]!.enabled, false);
    });
    // Panels on: a fresh plan writes the panel spec beside the library.
    const second = await addProposal(config, app.id, { ...base, kind: "plan", name: "programa paneles", content: JSON.stringify({ panel: plan.panel }) });
    await withFlags({ panels: "true" }, async () => {
      const accepted = await call("POST", `/specialist-applications/${app.id}/library/proposals/${second.proposals[0]!.id}/accept`, {});
      assert.equal((accepted.json.applied as Array<{ ok: boolean }>)[0]!.ok, true);
      const spec = await readPanelSpec(config, app.id, "aranceles-panel");
      assert.equal(spec.title, "Aranceles");
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the propose tool accepts task and plan kinds and validates their payloads", async () => {
  const { root, config, app, pathA, idA } = await fixture();
  try {
    await syncLibraryToolPlugin(config as unknown as ServerConfig, idA, pathA);
    await withFlags({ library: "true", tasks: "true", datasets: "true" }, async () => {
      const task = await runLibraryTool(config, pathA, "specialist_propose", {
        kind: "task", name: "revisar precios", description: "Cada mañana.", reason: "Se repite.",
        content: JSON.stringify({ prompt: "Revisá precios.", schedule: { kind: "daily", hour: 8, minute: 0 } }),
      }) as { proposal: { kind: string }; note: string };
      assert.equal(task.proposal.kind, "task");
      assert.match(task.note, /PAUSADA/);
      await assert.rejects(
        runLibraryTool(config, pathA, "specialist_propose", { kind: "task", name: "rota", description: "x", reason: "", content: "no-json" }),
        (error) => error instanceof ApiError && error.code === "invalid_proposal",
      );
      const plan = await runLibraryTool(config, pathA, "specialist_propose", {
        kind: "plan", name: "programa", description: "Varias piezas.", reason: "Se repite.",
        content: JSON.stringify({ dataset: { name: "precios", query: { provider: "tavily", operation: "search", input: { query: "precio soja" } } } }),
      }) as { proposal: { kind: string } };
      assert.equal(plan.proposal.kind, "plan");
      assert.equal((await listProposals(config, app.id)).length, 2);
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

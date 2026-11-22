import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiError } from "../src/errors.js";
import { workspaceIdForPath } from "../src/workspaces.js";
import { specialistStore, applicationInput } from "../src/specialists/store.js";
import { addProposal, listProposals, rawProposal } from "../src/specialists/proposals.js";
import { listTasks } from "../src/specialists/tasks.js";
import { registerDatasetQuery, writeDatasetDiff } from "../src/specialists/datasets.js";
import { runLibraryTool, syncLibraryToolPlugin } from "../src/specialists/library-tool-api.js";
import { registerSpecialistRoutes } from "../src/specialists/routes.js";
import { matchRoute, type RequestContext, type Route } from "../src/routes/registry.js";
import type { ServerConfig } from "../src/types.js";

const input = (name: string) => applicationInput.parse({ userName: "Usuario de prueba", name, specialty: `Especialidad ${name}`, personality: `PERSONA_${name}`, template: "custom" });
const base = { description: "Se repite.", reason: "" };
const failureStatus = (error: unknown, code: string) => error instanceof ApiError && error.code === code;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "specialists-review-"));
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

function withEnv(values: Record<string, string>, run: () => Promise<void>) {
  const before = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  return run().finally(() => {
    for (const [key, value] of before) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
}

const taskProposal = (name: string) => addProposal({ configPath: "" } as never, "app_never", { ...base, kind: "task", name, content: JSON.stringify({ prompt: "P.", schedule: { kind: "interval", everyMinutes: 20 } }) });

test("concurrent adds keep both proposals (serialized RMW)", async () => {
  const { root, config, app } = await fixture();
  try {
    const [a, b] = await Promise.all([
      addProposal(config, app.id, { ...base, kind: "skill", name: "uno", content: "# 1" }),
      addProposal(config, app.id, { ...base, kind: "skill", name: "dos", content: "# 2" }),
    ]);
    assert.ok(a.proposals[0] && b.proposals[0]);
    const inbox = await listProposals(config, app.id);
    assert.deepEqual(new Set(inbox.map(entry => entry.name)), new Set(["uno", "dos"]));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("two concurrent accepts apply exactly once (the other gets 404)", async () => {
  const { root, config, app } = await fixture();
  const call = apiHarness(config);
  try {
    const created = await addProposal(config, app.id, { ...base, kind: "task", name: "una", content: JSON.stringify({ prompt: "P.", schedule: { kind: "interval", everyMinutes: 20 } }) });
    const proposalId = created.proposals[0]!.id;
    await withEnv({ DEN_FEATURE_SCHEDULED_TASKS: "true" }, async () => {
      const [first, second] = await Promise.all([
        call("POST", `/specialist-applications/${app.id}/library/proposals/${proposalId}/accept`, {}),
        call("POST", `/specialist-applications/${app.id}/library/proposals/${proposalId}/accept`, {}),
      ]);
      const statuses = [first.status, second.status].sort();
      assert.deepEqual(statuses, [200, 404]);
      assert.equal((await listTasks(config, app.id)).length, 1);
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a hand-damaged proposal fails 422 on accept and stays in the inbox", async () => {
  const { root, config, app } = await fixture();
  const call = apiHarness(config);
  try {
    const created = await addProposal(config, app.id, { ...base, kind: "skill", name: "ok-skill", content: "# ok" });
    const proposalId = created.proposals[0]!.id;
    const file = join(root, "specialists", app.id, "proposals.json");
    const proposals = JSON.parse(await readFile(file, "utf8")) as Array<Record<string, unknown>>;
    proposals[0]!.kind = "nope";
    await writeFile(file, JSON.stringify(proposals));
    await withEnv({ DEN_FEATURE_SPECIALIST_LIBRARY: "true" }, async () => {
      const accepted = await call("POST", `/specialist-applications/${app.id}/library/proposals/${proposalId}/accept`, {});
      assert.equal(accepted.status, 422);
      assert.equal(accepted.json.error, "invalid_proposal");
      // The damaged entry is not listed (it can't be trusted) but is still reachable for dismiss/repair.
      assert.equal((await listProposals(config, app.id)).length, 0);
      assert.ok(await rawProposal(config, app.id, proposalId));
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("tool boundary: unknown name / bad input is a readable 422, not a 500", async () => {
  const { root, config, pathA, idA } = await fixture();
  const call = apiHarness(config);
  try {
    await syncLibraryToolPlugin(config as unknown as ServerConfig, idA, pathA);
    await withEnv({ DEN_FEATURE_SPECIALIST_LIBRARY: "true", DEN_FEATURE_SCHEDULED_TASKS: "true", DEN_FEATURE_SPECIALIST_DATASETS: "true", DEN_FEATURE_SPECIALIST_SOURCES: "true", DEN_FEATURE_SPECIALIST_PANELS: "true", DEN_FEATURE_STUDIO_OUTPUTS: "true" }, async () => {
      const toolFiles = await readdir(join(root, "specialists", "tool"));
      const descriptor = JSON.parse(await readFile(join(root, "specialists", "tool", toolFiles[0]!), "utf8")) as { token: string };
      const headers = { authorization: `Bearer ${descriptor.token}`, "content-type": "application/json" };
      const unknown = await call("POST", "/specialist-tool", { name: "specialist_inventado", input: {} }, headers);
      assert.equal(unknown.status, 422);
      assert.equal(unknown.json.error, "invalid_library_tool");
      await assert.rejects(runLibraryTool(config, pathA, "specialist_task_pause", {}), (error) => failureStatus(error, "invalid_library_tool"));
      // Direct creation still honors "explicit ask applies directly" (born enabled), while
      // proposal-born tasks are born paused (tested in specialist-proposals-routes.test.ts).
      const direct = await runLibraryTool(config, pathA, "specialist_task_create", { name: "directa", prompt: "P.", schedule: { kind: "interval", everyMinutes: 10 } }) as { task: { enabled: boolean } };
      assert.equal(direct.task.enabled, true);
      // Propose rides on any-family: library off, tasks on → still works.
      await withEnv({ DEN_FEATURE_SPECIALIST_LIBRARY: "false" }, async () => {
        const proposed = await runLibraryTool(config, pathA, "specialist_propose", { kind: "task", name: "prop", description: "d", reason: "", content: JSON.stringify({ prompt: "P.", schedule: { kind: "interval", everyMinutes: 5 } }) }) as { proposal: { kind: string } };
        assert.equal(proposed.proposal.kind, "task");
      });
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("specialist_dataset_read on a query-only dataset returns latest:null (no ENOENT 500)", async () => {
  const { root, config, pathA, idA } = await fixture();
  try {
    await syncLibraryToolPlugin(config as unknown as ServerConfig, idA, pathA);
    const dataset = await registerDatasetQuery(pathA, { name: "sin-correr", query: { provider: "tavily", operation: "search", input: { query: "x y", maxResults: 5 } } });
    await withEnv({ DEN_FEATURE_SPECIALIST_DATASETS: "true" }, async () => {
      const read = await runLibraryTool(config, pathA, "specialist_dataset_read", { id: dataset.id }) as { latest: unknown; snapshots: unknown[] };
      assert.equal(read.latest, null);
      assert.deepEqual(read.snapshots, []);
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("concurrent diff writes keep the retention bound and stay valid JSON", async () => {
  const { root, pathA } = await fixture();
  try {
    await mkdir(join(pathA, "comex", "datasets", "ds-x", "snapshots"), { recursive: true });
    await Promise.all(Array.from({ length: 10 }, (_, n) => writeDatasetDiff(pathA, "ds-x", { n })));
    const files = (await readdir(join(pathA, "comex", "datasets", "ds-x", "diffs"))).filter(name => name.endsWith(".json"));
    assert.ok(files.length <= 30);
    for (const file of files) JSON.parse(await readFile(join(pathA, "comex", "datasets", "ds-x", "diffs", file), "utf8"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a symlinked dataset folder refuses the diff write (containment)", async () => {
  const { root, pathA } = await fixture();
  try {
    await mkdir(join(pathA, "comex", "datasets"), { recursive: true });
    const outside = join(root, "fuera");
    await mkdir(outside, { recursive: true });
    await symlink(outside, join(pathA, "comex", "datasets", "ds-trampa"));
    await assert.rejects(writeDatasetDiff(pathA, "ds-trampa", { n: 1 }), (error) => failureStatus(error, "invalid_dataset"));
    assert.deepEqual(await readdir(outside), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("accepting with every piece failing keeps the proposal in the inbox", async () => {
  const { root, config, app } = await fixture();
  const call = apiHarness(config);
  try {
    const created = await addProposal(config, app.id, { ...base, kind: "task", name: "quedarse", content: JSON.stringify({ prompt: "P.", schedule: { kind: "daily", hour: 8, minute: 0 } }) });
    const proposalId = created.proposals[0]!.id;
    await withEnv({ DEN_FEATURE_SCHEDULED_TASKS: "false" }, async () => {
      const accepted = await call("POST", `/specialist-applications/${app.id}/library/proposals/${proposalId}/accept`, {});
      assert.equal(accepted.status, 200);
      assert.equal(accepted.json.kept, true);
      assert.equal((accepted.json.applied as Array<{ ok: boolean }>)[0]!.ok, false);
      assert.equal((await listProposals(config, app.id)).length, 1);
      assert.equal((await listTasks(config, app.id)).length, 0);
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("PUT outputs updates the workspace that owns it (no shadow copy)", async () => {
  const { root, config, app, pathB, idB } = await fixture();
  const call = apiHarness(config);
  try {
    await withEnv({ DEN_FEATURE_STUDIO_OUTPUTS: "true" }, async () => {
      const created = await call("POST", `/specialist-applications/${app.id}/outputs?workspace=${idB}`, { kind: "report", title: "En B", content: "# T" });
      const outputId = (created.json.output as { id: string }).id;
      const updated = await call("PUT", `/specialist-applications/${app.id}/outputs/${outputId}`, { kind: "report", title: "En B v2", content: "# T2" });
      assert.equal(updated.status, 200);
      assert.equal(updated.json.workspaceId, idB);
      assert.equal((updated.json.output as { title: string }).title, "En B v2");
      const listed = await call("GET", `/specialist-applications/${app.id}/outputs`);
      assert.equal((listed.json.outputs as Array<Record<string, unknown>>).length, 1);
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("?chunk=abc on a source is a readable 422", async () => {
  const { root, config, app, pathA, idA } = await fixture();
  const call = apiHarness(config);
  try {
    const relative = "comex/fuentes/tavily/a.json";
    await writeFile(join(pathA, relative), JSON.stringify({ answer: "La exportación de soja creció un tres por ciento en el último trimestre medido por la Bolsa de Comercio. ".repeat(12) }));
    const { registerSource } = await import("../src/specialists/sources.js");
    const source = await registerSource(pathA, { provider: "tavily", evidencePath: relative });
    await withEnv({ DEN_FEATURE_SPECIALIST_SOURCES: "true" }, async () => {
      const bad = await call("GET", `/specialist-applications/${app.id}/sources/${source.id}?workspace=${idA}&chunk=abc`);
      assert.equal(bad.status, 422);
      assert.equal(bad.json.error, "invalid_chunk");
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

void taskProposal;

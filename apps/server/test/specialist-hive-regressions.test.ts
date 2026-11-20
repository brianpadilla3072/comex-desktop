import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { specialistStore, applicationInput } from "../src/specialists/store.js";
import { inspectSpecialistPack, prepareSpecialistWorkspace, saveSpecialistPack } from "../src/specialists/packs.js";
import { isSafeRecordPath, syncSpecialistWorkspace } from "../src/specialists/sync.js";
import { deleteApplication } from "../src/specialists/portability/index.js";
import { sha256 } from "../src/specialists/digest.js";
import { ApiError } from "../src/errors.js";
import type { ServerConfig } from "../src/types.js";
import { createTask, listRuns, listTasks, patchTask } from "../src/specialists/tasks.js";
import { createSpecialistScheduler } from "../src/specialists/scheduler.js";
import { specialistDirectory } from "../src/specialists/store.js";

async function fixture(label: string) {
  const root = await mkdtemp(join(tmpdir(), `specialist-hive-${label}-`));
  const config = { configPath: join(root, "server.json"), port: 4711, token: "test-token", workspaces: [] as Array<{ id: string; path: string }> };
  const store = await specialistStore(config as unknown as ServerConfig);
  const pack = join(root, "pack-source");
  await mkdir(join(pack, "agents"), { recursive: true });
  await writeFile(join(pack, "agents", "revisor.md"), "---\ndescription: Revisor.\nmode: subagent\n---\nRevisá.\n");
  const app = store.create(applicationInput.parse({ userName: "Persona", name: `App ${label}`, specialty: "Pruebas", template: "custom" }), { agents: 1, skills: 0 });
  await saveSpecialistPack(config, app.id, await inspectSpecialistPack(pack));
  return { root, config, store, app };
}

// w6-7: the sync record lives inside the project; a crafted `../..` key with a matching hash made
// the server delete a file outside `.opencode` on the next library sync.
test("a crafted sync record never deletes files outside the project's .opencode", async () => {
  const { root, config, app } = await fixture("sync");
  try {
    const project = join(root, "project");
    await prepareSpecialistWorkspace(config, app, project);
    const victim = join(root, "victim.txt");
    await writeFile(victim, "keep me");
    await writeFile(join(project, ".opencode", "specialist-sync.json"), JSON.stringify({ version: 1, files: { "../../victim.txt": sha256("keep me"), "/abs/path": "x", "a\\\\b": "x" } }));
    await syncSpecialistWorkspace(config, app, project);
    assert.equal(await readFile(victim, "utf8"), "keep me");
    assert.deepEqual([isSafeRecordPath("agents/revisor.md"), isSafeRecordPath("../x"), isSafeRecordPath("/x"), isSafeRecordPath("a\\\\b"), isSafeRecordPath("a/.hidden"), isSafeRecordPath("C:/x")], [true, false, false, false, false, false]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// w6-1: a corrupt binding marker in an adopted folder aborted the deletion halfway (500).
test("deleting an application survives a corrupt marker in an adopted folder", async () => {
  const { root, config, store, app } = await fixture("delete");
  try {
    const adopted = join(root, "adopted");
    await mkdir(join(adopted, ".opencode"), { recursive: true });
    await prepareSpecialistWorkspace(config, app, adopted);
    store.bind("ws_adopted", app.id, adopted);
    await writeFile(join(adopted, ".opencode", "specialist-application.json"), "{not json");
    const result = await deleteApplication({ config, store, id: app.id, removeWorkspace: async () => {} });
    assert.deepEqual(result.keptWorkspaceIds, ["ws_adopted"]);
    assert.equal(store.list().applications.length, 0);
    // Unreadable means not provably ours: it stays for the person to decide.
    assert.ok((await stat(join(adopted, ".opencode", "specialist-application.json"))).isFile());
  } finally { await rm(root, { recursive: true, force: true }); }
});

// w6-13: a corrupt marker answered an English 500 "Unexpected server error".
test("binding a folder with a corrupt marker explains what to do", async () => {
  const { root, config, app } = await fixture("marker");
  try {
    const project = join(root, "project");
    await mkdir(join(project, ".opencode"), { recursive: true });
    await writeFile(join(project, ".opencode", "specialist-application.json"), "{not json");
    await assert.rejects(prepareSpecialistWorkspace(config, app, project), error => error instanceof ApiError && error.status === 422 && /dañado/.test(error.message));
  } finally { await rm(root, { recursive: true, force: true }); }
});

// w4-5 and w1-1: control and bidi characters were accepted, and duplicates were only detected for
// ASCII case ("Árbol" and "árbol", or the NFD form, coexisted in the switcher).
test("names are visible text in NFC and duplicates ignore case beyond ASCII", async () => {
  const { root, store } = await fixture("names");
  try {
    for (const name of ["Nombre\u0000oculto", "Factura‮txt.exe", "Línea\nnueva"]) {
      assert.equal(applicationInput.safeParse({ userName: "P", name, specialty: "x" }).success, false, JSON.stringify(name));
    }
    store.create(applicationInput.parse({ name: "Árbol", specialty: "x", template: "custom" }), { agents: 0, skills: 0 });
    for (const name of ["árbol", "ÁRBOL", "Árbol"]) {
      assert.throws(() => store.create(applicationInput.parse({ name, specialty: "x", template: "custom" }), { agents: 0, skills: 0 }), (error: unknown) => error instanceof ApiError && error.code === "application_name_exists", name);
    }
    assert.equal(applicationInput.parse({ name: "Árbol", specialty: "x" }).name, "Árbol");
  } finally { await rm(root, { recursive: true, force: true }); }
});

// w6-2: one application's corrupt tasks.json made every scheduler tick fail, so no other
// application ran its tasks; a corrupt run log kept a finished task "running" forever.
test("one application's corrupt tasks never stop the others, and a corrupt run log reads as empty", async () => {
  const before = process.env.DEN_FEATURE_SCHEDULED_TASKS;
  process.env.DEN_FEATURE_SCHEDULED_TASKS = "true";
  // The fixture's application is created first, so the scheduler reaches the corrupt one first.
  const { root, config, store, app: broken } = await fixture("scheduler");
  try {
    const app = store.create(applicationInput.parse({ name: "Sana", specialty: "x", template: "custom" }), { agents: 0, skills: 0 });
    await saveSpecialistPack(config, app.id, null);
    await mkdir(join(specialistDirectory(config), broken.id), { recursive: true });
    await writeFile(join(specialistDirectory(config), broken.id, "tasks.json"), "{corrupt");
    await assert.rejects(listTasks(config, broken.id), (error: unknown) => error instanceof ApiError && error.code === "tasks_unreadable");
    const project = join(root, "project");
    await prepareSpecialistWorkspace(config, app, project);
    config.workspaces.push({ id: "ws_ok", path: project });
    store.bind("ws_ok", app.id, project);
    const prompted: string[] = [];
    const engine = async (request: Request) => {
      const path = new URL(request.url).pathname.replace(/^\/workspace\/[^/]+\/opencode2\/api/, "");
      if (request.method === "POST" && path === "/session") return new Response(JSON.stringify({ data: { id: "ses_ok" } }), { status: 200, headers: { "content-type": "application/json" } });
      if (request.method === "POST" && path.startsWith("/session/")) { prompted.push(path); return new Response("{}", { status: 200 }); }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const scheduler = await createSpecialistScheduler(config as unknown as ServerConfig, engine);
    const task = await createTask(config, app.id, { name: "sana", prompt: "Revisá.", schedule: { kind: "interval", everyMinutes: 20 } });
    await patchTask(config, app.id, task.id, current => ({ ...current, nextRunAt: Date.now() - 1_000 }));
    await scheduler.tick();
    // Reached and dispatched despite the corrupt application before it.
    assert.equal((await listTasks(config, app.id)).find(entry => entry.id === task.id)?.lastStatus, "running");
    assert.ok(prompted.length > 0);
    await writeFile(join(specialistDirectory(config), app.id, "tasks", `${task.id}.json`), "{corrupt");
    assert.deepEqual(await listRuns(config, app.id, task.id), []);
    await scheduler.stop?.();
  } finally {
    if (before === undefined) delete process.env.DEN_FEATURE_SCHEDULED_TASKS; else process.env.DEN_FEATURE_SCHEDULED_TASKS = before;
    await rm(root, { recursive: true, force: true });
  }
});

// w1-7: deleting while files were still busy removed the profile first, then failed on the folder:
// the app vanished from the switcher but its files stayed, and a retry said "not found".
test("when the application's files cannot be removed, the profile stays and a retry works", async () => {
  const { root, config, store, app } = await fixture("busy");
  const busy = join(specialistDirectory(config), app.id, "projects", "Principal", ".opencode", "node_modules", "pkg");
  try {
    await mkdir(busy, { recursive: true });
    await writeFile(join(busy, "index.js"), "x");
    await chmod(busy, 0o500);
    await assert.rejects(deleteApplication({ config, store, id: app.id, removeWorkspace: async () => {} }), (error: unknown) => error instanceof ApiError && error.code === "application_files_busy");
    assert.equal(store.list().applications.some(entry => entry.id === app.id), true);
    await chmod(busy, 0o700);
    await deleteApplication({ config, store, id: app.id, removeWorkspace: async () => {} });
    assert.equal(store.list().applications.some(entry => entry.id === app.id), false);
    await assert.rejects(stat(join(specialistDirectory(config), app.id)));
  } finally { await chmod(busy, 0o700).catch(() => undefined); await rm(root, { recursive: true, force: true }); }
});

// w6-3: index.json of artifacts and outputs was read-modify-written without a queue, so concurrent
// writes in the same project kept only one of them.
test("concurrent artifact and output writes in one project all land in the index", async () => {
  const { writeArtifact, listArtifacts } = await import("../src/specialists/artifacts.js");
  const { writeOutput, listOutputs } = await import("../src/specialists/outputs.js");
  const root = await mkdtemp(join(tmpdir(), "specialist-hive-index-"));
  try {
    await mkdir(join(root, "proyecto"), { recursive: true });
    await Promise.all(Array.from({ length: 8 }, (_, index) => writeArtifact(root, { type: "doc", title: `Documento ${index}`, content: `# Documento ${index}\n`, metadata: { workspaceId: "ws_local", schemaVersion: 1, workspaceName: "Proyecto" } })));
    assert.equal((await listArtifacts(root)).length, 8);
    const report = (index: number) => JSON.stringify({ sections: [{ heading: `Parte ${index}`, body: "Texto." }] });
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, index) => writeOutput(root, { kind: "report", title: `Informe ${index}`, content: report(index) })));
    const written = results.filter(result => result.status === "fulfilled").length;
    assert.equal((await listOutputs(root)).length, written);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// w6-4: every "Abrir en el panel" click created a new artifact; after 40 the project answered 409
// for good, with no way to delete them.
test("opening the same output again reuses its artifact", async () => {
  const { createArtifactFromOutput, listArtifacts } = await import("../src/specialists/artifacts.js");
  const root = await mkdtemp(join(tmpdir(), "specialist-hive-open-"));
  try {
    await mkdir(join(root, "proyecto"), { recursive: true });
    const output = { id: "out-1", kind: "report" as const, title: "Informe", fromSources: [], focus: "" };
    const audit = { total: 0, valid: 0, invalid: [] };
    const first = await createArtifactFromOutput(root, "app_x", "ws_x", output, "# Informe\n", audit);
    const again = await createArtifactFromOutput(root, "app_x", "ws_x", output, "# Informe\n", audit);
    assert.deepEqual([first.created, again.created, again.meta.id], [true, false, first.meta.id]);
    const changed = await createArtifactFromOutput(root, "app_x", "ws_x", output, "# Informe\n\nNuevo dato.\n", audit);
    assert.equal(changed.meta.id, first.meta.id);
    const all = await listArtifacts(root);
    assert.equal(all.length, 1);
    assert.equal(all[0]?.versions.length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// w6-8: at the 60-dataset limit each refused new query still left a folder and snapshot on disk.
test("a dataset refused by the limit leaves nothing on disk", async () => {
  const { recordDatasetRun } = await import("../src/specialists/datasets.js");
  const { readdir } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "specialist-hive-datasets-"));
  try {
    await mkdir(join(root, "proyecto", "fuentes"), { recursive: true });
    await writeFile(join(root, "proyecto", "fuentes", "evidencia.json"), "{}");
    const query = (index: number) => ({ provider: "tavily", operation: "search", input: { query: `consulta ${index}` } });
    for (let index = 0; index < 60; index += 1) await recordDatasetRun(root, query(index), "proyecto/fuentes/evidencia.json");
    const folders = async () => (await readdir(join(root, "proyecto", "datasets"))).filter(name => name.startsWith("ds-")).length;
    assert.equal(await folders(), 60);
    await assert.rejects(recordDatasetRun(root, query(999), "proyecto/fuentes/evidencia.json"), (error: unknown) => error instanceof ApiError && error.code === "dataset_limit");
    assert.equal(await folders(), 60);
    // An existing query still records a new snapshot at the limit.
    await recordDatasetRun(root, query(0), "proyecto/fuentes/evidencia.json");
  } finally { await rm(root, { recursive: true, force: true }); }
});

// w6-11: the revoked-token placeholder was accepted once it sat in the descriptor cache.
test("the revoked library tool token is never accepted, cached or not", async () => {
  const { REVOKED_TOOL_TOKEN, findDescriptorDirectory } = await import("../src/specialists/library-tool-api.js");
  const { root, config } = await fixture("tool");
  try {
    const tools = join(specialistDirectory(config), "tool");
    await mkdir(tools, { recursive: true });
    await writeFile(join(tools, "revoked.json"), JSON.stringify({ directory: join(root, "project"), token: REVOKED_TOOL_TOKEN, url: "http://127.0.0.1:1/specialist-tool" }));
    assert.equal(await findDescriptorDirectory(config, REVOKED_TOOL_TOKEN), null);
    assert.equal(await findDescriptorDirectory(config, REVOKED_TOOL_TOKEN), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// Live QA: switching projects fired several first-syncs of the library tool at once; the in-place
// descriptor write let a concurrent read parse an empty file (500 "Unexpected end of JSON input").
test("concurrent library tool syncs keep one token and never expose a half-written descriptor", async () => {
  const { syncLibraryToolPlugin, readSpecialistToolDescriptor } = await import("../src/specialists/library-tool-api.js");
  const { root, config, store, app } = await fixture("descriptor");
  try {
    const project = join(root, "project");
    await prepareSpecialistWorkspace(config, app, project);
    store.bind("ws_descriptor", app.id, project);
    const serverConfig = { ...config, workspaces: [{ id: "ws_descriptor", path: project }] };
    // Hammer it: every sync rewrites the descriptor while readers keep parsing it.
    let stop = false;
    const reader = (async () => { while (!stop) await readSpecialistToolDescriptor(config, project); })();
    const readers = [reader, (async () => { while (!stop) await readSpecialistToolDescriptor(config, project); })()];
    try {
      for (let round = 0; round < 40; round += 1) await Promise.all(Array.from({ length: 6 }, () => syncLibraryToolPlugin(serverConfig, "ws_descriptor", project)));
    } finally { stop = true; }
    await Promise.all(readers);
    const first = await readSpecialistToolDescriptor(config, project);
    assert.ok(first?.token);
    await Promise.all(Array.from({ length: 4 }, () => syncLibraryToolPlugin(serverConfig, "ws_descriptor", project)));
    assert.equal((await readSpecialistToolDescriptor(config, project))?.token, first.token);
  } finally { await rm(root, { recursive: true, force: true }); }
});

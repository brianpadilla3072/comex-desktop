import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiError } from "../src/errors.js";
import { workspaceIdForPath } from "../src/workspaces.js";
import { specialistDirectory, specialistStore } from "../src/specialists/store.js";
import { prepareSpecialistWorkspace } from "../src/specialists/packs.js";
import { createTask, listTasks } from "../src/specialists/tasks.js";
import { registerSpecialistRoutes } from "../src/specialists/routes.js";
import { matchRoute, type RequestContext, type Route } from "../src/routes/registry.js";
import type { ServerConfig } from "../src/types.js";

const FLAGS = ["DEN_FEATURE_SPECIALIST_APPLICATIONS", "DEN_FEATURE_SPECIALIST_LIBRARY", "DEN_FEATURE_SCHEDULED_TASKS", "DEN_FEATURE_SPECIALIST_APP_PORTABILITY"];

type Workspace = { id: string; path: string; name: string; workspaceType: "local" };
type Json = Record<string, unknown>;

async function machine(label: string) {
  const root = await mkdtemp(join(tmpdir(), `specialist-portability-${label}-`));
  const config = { configPath: join(root, "server.json"), port: 4711, token: "t", workspaces: [] as Workspace[] };
  const routes: Route[] = [];
  registerSpecialistRoutes({
    routes, config: config as unknown as ServerConfig,
    readJsonBody: async (request: Request) => await request.json() as Json,
    jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
    ensureWritable: () => {},
    // Same steps as POST /workspaces/local with a specialist preset.
    createWorkspace: async (_ctx, payload) => {
      const folderPath = String(payload.folderPath);
      const store = await specialistStore(config as unknown as ServerConfig);
      await prepareSpecialistWorkspace(config, store.application(String(payload.applicationId)), folderPath);
      const id = workspaceIdForPath(folderPath);
      store.bind(id, String(payload.applicationId), folderPath);
      config.workspaces.push({ id, path: folderPath, name: String(payload.name), workspaceType: "local" });
      return id;
    },
    removeWorkspace: async (_ctx, workspaceId) => { config.workspaces = config.workspaces.filter(workspace => workspace.id !== workspaceId); },
    renameWorkspace: async (_ctx, workspaceId, name) => { config.workspaces = config.workspaces.map(workspace => workspace.id === workspaceId ? { ...workspace, name } : workspace); },
  });
  const call = async (method: string, path: string, body?: unknown, actor: Record<string, unknown> = { type: "host", scope: "owner" }) => {
    const url = new URL(`http://127.0.0.1:1${path}`);
    const match = matchRoute(routes, method, url.pathname);
    assert.ok(match, `${method} ${path}`);
    const request = new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    try {
      const response = await match.handler({ request, url, params: match.params, config, actor } as unknown as RequestContext);
      return { status: response.status, json: await response.json() as Json };
    } catch (error) {
      if (error instanceof ApiError) return { status: error.status, json: { code: error.code, message: error.message } };
      throw error;
    }
  };
  return { root, config, call, store: () => specialistStore(config as unknown as ServerConfig) };
}

async function withFlags(run: () => Promise<void>) {
  const before = new Map(FLAGS.map(name => [name, process.env[name]]));
  for (const name of FLAGS) process.env[name] = "true";
  try { await run(); }
  finally { for (const [name, value] of before) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
}

async function sourcePack(root: string) {
  const pack = join(root, "pack-source");
  await mkdir(join(pack, "agents"), { recursive: true });
  await mkdir(join(pack, "skills", "tono"), { recursive: true });
  await writeFile(join(pack, "agents", "revisor.md"), "---\ndescription: Revisor de prueba.\nmode: subagent\n---\nRevisá evidencia.\n");
  await writeFile(join(pack, "skills", "tono", "SKILL.md"), "---\nname: tono\ndescription: Una skill de prueba.\n---\nAyudá con claridad.\n");
  return pack;
}

test("an application moves to another computer with its library, context, paused tasks, memory and session summaries", async () => withFlags(async () => {
  const a = await machine("a");
  const b = await machine("b");
  try {
    const created = await a.call("POST", "/specialist-applications", { userName: "Persona", name: "Soja", specialty: "Exportación de soja", template: "custom", packPath: await sourcePack(a.root) });
    assert.equal(created.status, 201);
    const app = created.json.application as { id: string };
    const project = a.config.workspaces[0]!;
    await a.call("PUT", `/specialist-applications/${app.id}/context`, { content: "Citar siempre la fuente." });
    await createTask(a.config, app.id, { name: "semanal", prompt: "Revisá precios.", schedule: { kind: "interval", everyMinutes: 60 } });
    await writeFile(join(project.path, "proyecto", "estado.md"), "# Memoria\nDecisión: puerto de Rosario.\n");
    await mkdir(join(project.path, "proyecto", "sesiones"), { recursive: true });
    await writeFile(join(project.path, "proyecto", "sesiones", "ses_1.md"), "# Notas\nAvance: tabla de precios.\n");
    await writeFile(join(project.path, "proyecto", "imagen.bin"), Buffer.from([0, 255, 1, 254]));

    // v1 JSON bundle; the .owapp archive is covered by specialist-app-zip-bundle.test.ts.
    const exported = await a.call("GET", `/specialist-applications/${app.id}/export?format=json`);
    assert.equal(exported.status, 200);
    const bundle = exported.json;
    assert.equal(bundle.format, "openwork.specialist-application");
    // Personal data and machine paths never travel.
    const text = JSON.stringify(bundle);
    assert.equal(text.includes("Persona"), false);
    assert.equal(text.includes(a.root), false);

    // The other computer has no local profile yet: the person's name comes with the import.
    const imported = await b.call("POST", "/specialist-applications/import", { bundle, userName: "Persona B" });
    assert.equal(imported.status, 201, JSON.stringify(imported.json));
    const result = imported.json as { application: { id: string; name: string; agentCount: number; skillCount: number }; workspaceId: string; skippedSections: string[] };
    assert.notEqual(result.application.id, app.id);
    assert.equal(result.application.name, "Soja");
    assert.deepEqual([result.application.agentCount, result.application.skillCount], [1, 1]);
    assert.deepEqual(result.skippedSections, []);
    const target = b.config.workspaces.find(workspace => workspace.id === result.workspaceId)!;
    assert.ok(target.path.startsWith(specialistDirectory(b.config)));
    assert.equal(await readFile(join(target.path, "proyecto", "estado.md"), "utf8"), "# Memoria\nDecisión: puerto de Rosario.\n");
    assert.equal(await readFile(join(target.path, "proyecto", "sesiones", "ses_1.md"), "utf8"), "# Notas\nAvance: tabla de precios.\n");
    assert.deepEqual([...await readFile(join(target.path, "proyecto", "imagen.bin"))], [0, 255, 1, 254]);
    assert.ok((await stat(join(target.path, ".opencode", "agents", "revisor.md"))).isFile());
    const context = await b.call("GET", `/specialist-applications/${result.application.id}/context`);
    assert.equal(context.json.content, "Citar siempre la fuente.");
    const tasks = await listTasks(b.config, result.application.id);
    assert.deepEqual(tasks.map(task => [task.name, task.enabled]), [["semanal", false]]);

    // Importing the same file again keeps both, with a distinct name.
    const again = await b.call("POST", "/specialist-applications/import", { bundle });
    assert.equal((again.json.application as { name: string }).name, "Soja (importada)");
  } finally { await rm(a.root, { recursive: true, force: true }); await rm(b.root, { recursive: true, force: true }); }
}));

test("deleting an application removes its own projects but keeps adopted folders as ordinary workspaces", async () => withFlags(async () => {
  const a = await machine("delete");
  try {
    const first = await a.call("POST", "/specialist-applications", { userName: "Persona", name: "Primera", specialty: "Pruebas", template: "custom" });
    const second = await a.call("POST", "/specialist-applications", { name: "Segunda", specialty: "Pruebas", template: "custom" });
    const appId = (first.json.application as { id: string }).id;
    const otherId = (second.json.application as { id: string }).id;
    await a.call("POST", `/specialist-applications/${appId}/activate`);
    const own = a.config.workspaces.find(workspace => workspace.path.includes(appId))!;
    // An adopted folder outside the application, with the person's own files.
    const adopted = join(a.root, "mi-proyecto");
    await mkdir(join(adopted, ".opencode"), { recursive: true });
    await writeFile(join(adopted, "notas.md"), "mías");
    await writeFile(join(adopted, ".opencode", "opencode.json"), "{}");
    const store = await a.store();
    await prepareSpecialistWorkspace(a.config, store.application(appId), adopted);
    store.bind(workspaceIdForPath(adopted), appId, adopted);
    a.config.workspaces.push({ id: workspaceIdForPath(adopted), path: adopted, name: "mi-proyecto", workspaceType: "local" });

    const deleted = await a.call("DELETE", `/specialist-applications/${appId}`);
    assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
    assert.deepEqual(deleted.json.removedWorkspaceIds, [own.id]);
    assert.deepEqual(deleted.json.keptWorkspaceIds, [workspaceIdForPath(adopted)]);
    await assert.rejects(stat(join(specialistDirectory(a.config), appId)));
    assert.equal(a.config.workspaces.some(workspace => workspace.id === own.id), false);
    assert.equal(a.config.workspaces.some(workspace => workspace.path === adopted), true);
    assert.equal(await readFile(join(adopted, "notas.md"), "utf8"), "mías");
    assert.equal(await readFile(join(adopted, ".opencode", "opencode.json"), "utf8"), "{}");
    await assert.rejects(stat(join(adopted, ".opencode", "specialist-application.json")));
    const catalog = deleted.json.catalog as { activeApplicationId: string | null; applications: Array<{ id: string }> };
    assert.deepEqual(catalog.applications.map(app => app.id), [otherId]);
    assert.equal(catalog.activeApplicationId, otherId);
    // The folder can be bound again by another application.
    assert.equal((await a.call("DELETE", `/specialist-applications/${appId}`)).status, 404);
  } finally { await rm(a.root, { recursive: true, force: true }); }
}));

test("invalid, newer or malicious bundles are rejected before anything is written; unknown sections are skipped", async () => withFlags(async () => {
  const a = await machine("invalid");
  try {
    const base = { format: "openwork.specialist-application", version: 1, application: { name: "X", specialty: "Y", personality: "", template: "custom" } };
    const reject = async (bundle: unknown, pattern: RegExp) => {
      const response = await a.call("POST", "/specialist-applications/import", { bundle, userName: "Persona" });
      assert.equal(response.status, 422, JSON.stringify(response.json));
      assert.match(String(response.json.message), pattern);
    };
    await reject({ hello: "world" }, /no es una aplicación exportada/);
    await reject({ ...base, version: 99, sections: {} }, /versión más nueva/);
    await reject({ ...base, sections: { projects: { projects: [{ name: "P", dataDir: "proyecto", files: [{ path: "a", encoding: "utf8", content: "x" }, { path: "a/b", encoding: "utf8", content: "y" }] }] } } }, /como archivo y como carpeta/);
    await reject({ ...base, sections: { projects: { projects: [{ name: "P", dataDir: "proyecto", files: [{ path: "a.md", encoding: "utf8", content: "x" }, { path: "a.md", encoding: "utf8", content: "y" }] }] } } }, /repite la ruta/);
    await reject({ ...base, sections: { projects: { projects: [{ name: "P", dataDir: "proyecto", files: [{ path: "../../escape.md", encoding: "utf8", content: "x" }] }] } } }, /no son válidos/);
    await reject({ ...base, sections: { projects: { projects: [{ name: "P", dataDir: "proyecto", files: [{ path: "/etc/passwd", encoding: "utf8", content: "x" }] }] } } }, /no son válidos/);
    await reject({ ...base, sections: { library: { files: [{ path: "agents/sin-encabezado.md", encoding: "utf8", content: "nada" }] } } }, /YAML|encabezado/);
    await reject({ ...base, sections: { projects: { projects: [{ name: "P", dataDir: "proyecto", files: [{ path: "grande.bin", encoding: "base64", content: Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64") }] }] } } }, /5 MB/);
    // Nothing was created by the rejected imports.
    assert.equal((await a.store()).list().applications.length, 0);
    assert.equal(a.config.workspaces.length, 0);

    const ok = await a.call("POST", "/specialist-applications/import", { bundle: { ...base, sections: { "future-family": { anything: true } } }, userName: "Persona" });
    assert.equal(ok.status, 201, JSON.stringify(ok.json));
    assert.deepEqual(ok.json.skippedSections, ["future-family"]);
    // With no projects in the file, the application still gets its own starting project.
    assert.equal(a.config.workspaces.length, 1);
  } finally { await rm(a.root, { recursive: true, force: true }); }
}));

test("the portability routes disappear when the flag is off", async () => {
  const before = new Map(FLAGS.map(name => [name, process.env[name]]));
  for (const name of FLAGS) process.env[name] = "true";
  process.env.DEN_FEATURE_SPECIALIST_APP_PORTABILITY = "false";
  const a = await machine("flag");
  try {
    const created = await a.call("POST", "/specialist-applications", { userName: "Persona", name: "Una", specialty: "Pruebas", template: "custom" });
    const id = (created.json.application as { id: string }).id;
    assert.equal((created.json.catalog as { portabilityEnabled: boolean }).portabilityEnabled, false);
    for (const [method, path] of [["GET", `/specialist-applications/${id}/export`], ["DELETE", `/specialist-applications/${id}`], ["POST", "/specialist-applications/import"]] as const) {
      assert.equal((await a.call(method, path, method === "POST" ? {} : undefined)).status, 404, `${method} ${path}`);
    }
  } finally {
    for (const [name, value] of before) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(a.root, { recursive: true, force: true });
  }
});

test("a failure halfway through an import leaves no application, workspace or folder behind", async () => withFlags(async () => {
  const a = await machine("rollback");
  try {
    const bundle = {
      format: "openwork.specialist-application", version: 1,
      application: { name: "A medias", specialty: "Pruebas", personality: "", template: "custom" },
      // The new project already has estado.md as a file; "estado.md/x" needs it to be a folder, so
      // the write fails after the application and its project workspace exist.
      sections: { projects: { projects: [{ name: "P", dataDir: "proyecto", files: [{ path: "estado.md/x", encoding: "utf8", content: "y" }] }] } },
    };
    const response = await a.call("POST", "/specialist-applications/import", { bundle, userName: "Persona" }).catch((error: unknown) => ({ status: 500, json: { message: String(error) } }));
    assert.equal(response.status, 422, JSON.stringify(response.json));
    assert.match(String(response.json.message), /No se pudo escribir estado\.md\/x/);
    assert.equal((await a.store()).list().applications.length, 0);
    assert.equal(a.config.workspaces.length, 0);
    const leftovers = await import("node:fs/promises").then(fs => fs.readdir(specialistDirectory(a.config)).catch(() => []));
    assert.deepEqual(leftovers.filter(name => name.startsWith("app_")), []);
  } finally { await rm(a.root, { recursive: true, force: true }); }
}));

test("the catalog tells a read-only browser session apart from the desktop host", async () => withFlags(async () => {
  const a = await machine("writable");
  try {
    assert.equal((await a.call("GET", "/specialist-applications")).json.writable, true);
    assert.equal((await a.call("GET", "/specialist-applications", undefined, { type: "remote", scope: "owner" })).json.writable, true);
    assert.equal((await a.call("GET", "/specialist-applications", undefined, { type: "remote", scope: "collaborator" })).json.writable, false);
  } finally { await rm(a.root, { recursive: true, force: true }); }
}));

test("renaming an application renames the projects that still carry its old name, not the ones renamed by hand", async () => withFlags(async () => {
  const a = await machine("rename");
  try {
    const created = await a.call("POST", "/specialist-applications", { userName: "Persona", name: "Comex", specialty: "Comercio", template: "custom" });
    const id = (created.json.application as { id: string }).id;
    await a.call("POST", `/specialist-applications/${id}/projects`, { name: "Soja 2026" });
    assert.deepEqual(a.config.workspaces.map(workspace => workspace.name).sort(), ["Comex", "Soja 2026"]);
    const renamed = await a.call("PATCH", `/specialist-applications/${id}`, { name: "Comex QA", specialty: "Comercio", personality: "" });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.json));
    assert.deepEqual(a.config.workspaces.map(workspace => workspace.name).sort(), ["Comex QA", "Soja 2026"]);
  } finally { await rm(a.root, { recursive: true, force: true }); }
}));

// w1-2: renaming the app to the name of a hand-renamed project made that project follow every
// later rename. Only the app's own first project ("Principal") follows.
test("a project renamed by hand never follows the application's renames", async () => withFlags(async () => {
  const a = await machine("rename-hand");
  try {
    const created = await a.call("POST", "/specialist-applications", { userName: "Persona", name: "Comex", specialty: "Comercio", template: "custom" });
    const id = (created.json.application as { id: string }).id;
    await a.call("POST", `/specialist-applications/${id}/projects`, { name: "Comex Final" });
    await a.call("PATCH", `/specialist-applications/${id}`, { name: "Comex Final", specialty: "Comercio", personality: "" });
    await a.call("PATCH", `/specialist-applications/${id}`, { name: "Comex Otra", specialty: "Comercio", personality: "" });
    assert.deepEqual(a.config.workspaces.map(workspace => workspace.name).sort(), ["Comex Final", "Comex Otra"]);
  } finally { await rm(a.root, { recursive: true, force: true }); }
}));

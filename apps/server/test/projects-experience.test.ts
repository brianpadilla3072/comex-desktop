import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import {
  compareProjects, projectContextChangeSchema, projectContextListingSchema, projectDetailSchema, projectInstructionsSchema,
  projectListSchema, projectMemorySchema, projectTaskListSchema, projectUsagePercent,
} from "@openwork/types/projects";
import { ApiError } from "../src/errors.js";
import { projectsExperienceEnabled } from "../src/comex/features.js";
import { applicationInput, specialistStore } from "../src/specialists/store.js";
import { createTask, listTasks } from "../src/specialists/tasks.js";
import { registerSpecialistRoutes } from "../src/specialists/routes.js";
import { taskPermissionReplies } from "../src/specialists/scheduler.js";
import { checkUpload, normalizeContextPath, uploadByteBudget } from "../src/specialists/projects/core.js";
import { projectAgentInstructions } from "../src/specialists/projects/instructions.js";
import { recentSessionsFrom } from "../src/specialists/projects/sessions.js";
import { runsInProject } from "../src/specialists/projects/tasks-view.js";
import { matchRoute, type RequestContext, type Route } from "../src/routes/registry.js";
import type { ServerConfig, WorkspaceInfo } from "../src/types.js";

// ---- Contract vectors (contracts/projects/v1) ----

const vectors = z.object({
  constants: z.object({ contextBytes: z.number(), contextFiles: z.number(), contextFileBytes: z.number(), contextDepth: z.number() }).passthrough(),
  contextPaths: z.array(z.object({ input: z.string(), allowRoot: z.boolean(), result: z.union([z.object({ ok: z.literal(true), path: z.string() }), z.object({ ok: z.literal(false), code: z.string() })]) })),
  usagePercent: z.array(z.object({ usage: z.object({ files: z.number(), bytes: z.number() }), percent: z.number() })),
  uploads: z.array(z.object({ usage: z.object({ files: z.number(), bytes: z.number() }), size: z.number(), replacing: z.number().nullable(), result: z.union([z.object({ ok: z.literal(true) }), z.object({ ok: z.literal(false), code: z.string() })]), budget: z.number() })),
  order: z.object({ projects: z.array(z.object({ workspaceId: z.string(), name: z.string(), pinnedAt: z.number().nullable(), lastActivityAt: z.number() })), expected: z.array(z.string()) }),
  permissionReplies: z.array(z.object({ name: z.string(), mode: z.enum(["auto", "manual"]), autoEnabled: z.boolean(), runSessions: z.array(z.string()), pending: z.array(z.object({ id: z.string(), sessionID: z.string() })), replies: z.array(z.object({ sessionId: z.string(), requestId: z.string(), reply: z.literal("once") })) })),
  runsInProject: z.array(z.object({ task: z.object({ workspaceId: z.string().nullable() }), workspaceId: z.string(), firstLive: z.string().nullable(), runs: z.boolean() })),
  recentSessions: z.object({ limit: z.number(), rows: z.unknown(), expected: z.unknown() }),
}).parse(JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "contracts", "projects", "v1", "vectors.json"), "utf8")));

test("contract: limits match the shared constants", async () => {
  const { PROJECT_LIMITS } = await import("@openwork/types/projects");
  assert.equal(PROJECT_LIMITS.contextBytes, vectors.constants.contextBytes);
  assert.equal(PROJECT_LIMITS.contextFiles, vectors.constants.contextFiles);
  assert.equal(PROJECT_LIMITS.contextFileBytes, vectors.constants.contextFileBytes);
  assert.equal(PROJECT_LIMITS.contextDepth, vectors.constants.contextDepth);
});

test("contract: context paths", () => {
  for (const vector of vectors.contextPaths) assert.deepEqual(normalizeContextPath(vector.input, { allowRoot: vector.allowRoot }), vector.result, JSON.stringify(vector.input));
});

test("contract: usage percent, upload checks and byte budget", () => {
  for (const vector of vectors.usagePercent) assert.equal(projectUsagePercent(vector.usage), vector.percent, JSON.stringify(vector.usage));
  for (const vector of vectors.uploads) {
    assert.deepEqual(checkUpload(vector.usage, vector.size, vector.replacing), vector.result, JSON.stringify(vector));
    assert.equal(uploadByteBudget(vector.usage, vector.replacing), vector.budget, JSON.stringify(vector));
  }
});

test("contract: registry order, permission replies, task placement and recent sessions", () => {
  assert.deepEqual([...vectors.order.projects].sort(compareProjects).map(project => project.workspaceId), vectors.order.expected);
  for (const vector of vectors.permissionReplies) assert.deepEqual(taskPermissionReplies(vector.mode, vector.autoEnabled, vector.runSessions, vector.pending), vector.replies, vector.name);
  for (const vector of vectors.runsInProject) assert.equal(runsInProject(vector.task, vector.workspaceId, vector.firstLive), vector.runs, JSON.stringify(vector));
  assert.deepEqual(recentSessionsFrom(vectors.recentSessions.rows, vectors.recentSessions.limit), vectors.recentSessions.expected);
});

test("projectsExperience is on by default and follows the operator switch", () => {
  assert.equal(projectsExperienceEnabled({}), true);
  assert.equal(projectsExperienceEnabled({ DEN_FEATURE_PROJECTS_EXPERIENCE: "false" }), false);
});

// ---- Routes, against an isolated config folder ----

const FLAGS = ["DEN_FEATURE_SPECIALIST_APPLICATIONS", "DEN_FEATURE_SCHEDULED_TASKS", "DEN_FEATURE_COMEX_SCOPED_MEMORY", "DEN_FEATURE_PROJECTS_EXPERIENCE"];
const savedFlags = new Map(FLAGS.map(name => [name, process.env[name]]));
type Harness = Awaited<ReturnType<typeof setup>>;
let harness: Harness;

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "projects-experience-"));
  const workspaces: WorkspaceInfo[] = [];
  const config = { configPath: join(root, "server.json"), port: 4799, token: "test-token", workspaces, readOnly: false };
  const store = await specialistStore(config);
  const app = store.create(applicationInput.parse({ userName: "Persona", name: "Aduanas", specialty: "Pruebas", template: "custom" }), { agents: 0, skills: 0 });
  const other = store.create(applicationInput.parse({ name: "Logística", specialty: "Pruebas", template: "custom" }), { agents: 0, skills: 0 });
  const add = async (id: string, name: string, appId: string) => {
    const path = join(root, "projects", id);
    await mkdir(join(path, "proyecto"), { recursive: true });
    workspaces.push({ id, name, path, preset: "specialist", workspaceType: "local" });
    store.bind(id, appId, path);
    return path;
  };
  const first = await add("ws_first", "Principal", app.id);
  const second = await add("ws_second", "Importación", app.id);
  await add("ws_other", "Fletes", other.id);
  const renames: Array<{ id: string; name: string }> = [];
  const routes: Route[] = [];
  registerSpecialistRoutes({
    routes, config: config as unknown as ServerConfig,
    readJsonBody: async (request: Request) => z.record(z.string(), z.unknown()).parse(await request.json()),
    jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
    ensureWritable: () => {}, createWorkspace: async () => "ws_new",
    renameWorkspace: async (_ctx, workspaceId, name) => {
      renames.push({ id: workspaceId, name });
      const index = workspaces.findIndex(entry => entry.id === workspaceId);
      const current = workspaces[index];
      if (current) workspaces[index] = { ...current, displayName: name };
    },
  });
  const call = async (method: string, path: string, options: { body?: unknown; raw?: BodyInit; actor?: "host" | "client" } = {}) => {
    const url = new URL(`http://127.0.0.1:1${path}`);
    const match = matchRoute(routes, method, url.pathname);
    assert.ok(match, `no route for ${method} ${url.pathname}`);
    const body = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
    const request = new Request(url, { method, body, ...(body === undefined ? {} : { duplex: "half" }) });
    const actor = options.actor === "client" ? { type: "remote", scope: "collaborator", tokenHash: "hash_client" } : { type: "host", scope: "owner", tokenHash: "hash_host" };
    try {
      const response = await match.handler({ request, url, params: match.params, config, actor } as unknown as RequestContext);
      return { status: response.status, json: z.unknown().parse(await response.json()) };
    } catch (error) {
      if (error instanceof ApiError) return { status: error.status, json: { code: error.code } };
      throw error;
    }
  };
  const route = (method: string, path: string, auth: string) => matchRoute(routes, method, path.replace(":workspaceId", "ws_first").replace(":noteId", "00000000-0000-4000-8000-000000000000"))?.auth === auth;
  return { root, config, store, app, other, first, second, call, renames, route };
}

const code = (value: unknown) => z.object({ code: z.string() }).parse(value).code;

before(async () => {
  for (const name of FLAGS) process.env[name] = "true";
  harness = await setup();
});
after(async () => {
  for (const [name, value] of savedFlags) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  harness.store.close();
  await rm(harness.root, { recursive: true, force: true });
});

test("reads are client routes and writes are host routes", () => {
  const { route } = harness;
  assert.ok(route("GET", "/specialist-projects", "client"));
  assert.ok(route("GET", "/specialist-projects/:workspaceId", "client"));
  assert.ok(route("PATCH", "/specialist-projects/:workspaceId", "host"));
  assert.ok(route("PUT", "/specialist-projects/:workspaceId/instructions", "host"));
  assert.ok(route("POST", "/specialist-projects/:workspaceId/context/files", "host"));
  assert.ok(route("POST", "/specialist-projects/:workspaceId/context/folders", "host"));
  assert.ok(route("DELETE", "/specialist-projects/:workspaceId/context", "host"));
  assert.ok(route("POST", "/specialist-projects/:workspaceId/memory", "host"));
  assert.ok(route("DELETE", "/specialist-projects/:workspaceId/memory/:noteId", "host"));
  assert.ok(route("GET", "/specialist-projects/:workspaceId/tasks", "client"));
});

test("the registry lists every project of every application; pin and description persist", async () => {
  const { call, app, other, renames } = harness;
  const listed = projectListSchema.parse((await call("GET", "/specialist-projects", { actor: "client" })).json);
  assert.equal(listed.writable, false);
  assert.deepEqual(listed.projects.map(project => project.workspaceId).sort(), ["ws_first", "ws_other", "ws_second"]);
  assert.equal(listed.projects.find(project => project.workspaceId === "ws_other")?.applicationId, other.id);
  assert.equal(listed.projects.find(project => project.workspaceId === "ws_first")?.applicationName, app.name);

  const pinned = await call("PATCH", "/specialist-projects/ws_second", { body: { pinned: true, description: "Importaciones de 2026.\nCon permisos." } });
  assert.equal(pinned.status, 200);
  const again = projectListSchema.parse((await call("GET", "/specialist-projects")).json);
  assert.equal(again.writable, true);
  assert.equal(again.projects[0]?.workspaceId, "ws_second", "pinned projects come first");
  assert.equal(again.projects[0]?.description, "Importaciones de 2026.\nCon permisos.");
  const pinnedAt = again.projects[0]?.pinnedAt;
  assert.ok(pinnedAt);
  await call("PATCH", "/specialist-projects/ws_second", { body: { pinned: true } });
  assert.equal(projectListSchema.parse((await call("GET", "/specialist-projects")).json).projects[0]?.pinnedAt, pinnedAt, "re-pinning keeps the pin time");

  const renamed = await call("PATCH", "/specialist-projects/ws_first", { body: { name: "Exportación" } });
  assert.equal(renamed.status, 200);
  assert.deepEqual(renames, [{ id: "ws_first", name: "Exportación" }]);
  assert.equal(z.object({ project: z.object({ name: z.string() }) }).parse(renamed.json).project.name, "Exportación");

  assert.equal(code((await call("PATCH", "/specialist-projects/ws_first", { body: {} })).json), "invalid_project");
  assert.equal(code((await call("PATCH", "/specialist-projects/ws_first", { body: { name: "a\u202eb" } })).json), "invalid_project");
  assert.equal(code((await call("PATCH", "/specialist-projects/ws_first", { body: { description: "x".repeat(2_001) } })).json), "invalid_project");
  assert.equal(code((await call("PATCH", "/specialist-projects/ws_missing", { body: { pinned: true } })).json), "project_not_found");
  await call("PATCH", "/specialist-projects/ws_second", { body: { pinned: false } });
  assert.equal(projectListSchema.parse((await call("GET", "/specialist-projects")).json).projects.find(project => project.workspaceId === "ws_second")?.pinned, false);
});

test("instructions are saved in the project's data folder and reach the agent entry", async () => {
  const { call, second } = harness;
  const empty = projectInstructionsSchema.parse((await call("GET", "/specialist-projects/ws_second/instructions")).json);
  assert.deepEqual([empty.text, empty.updatedAt], ["", null]);
  assert.equal(await projectAgentInstructions(second, "Importación"), null);
  const saved = projectInstructionsSchema.parse((await call("PUT", "/specialist-projects/ws_second/instructions", { body: { text: "Responde siempre con el código arancelario.\r\n" } })).json);
  assert.equal(saved.text.trim(), "Responde siempre con el código arancelario.");
  assert.ok(saved.updatedAt);
  assert.equal(await readFile(join(second, "proyecto", "instrucciones.md"), "utf8"), "Responde siempre con el código arancelario.\n");
  const entry = await projectAgentInstructions(second, "Importación");
  assert.match(entry ?? "", /código arancelario/);
  assert.match(entry ?? "", /proyecto\/instrucciones\.md/);
  assert.equal(code((await call("PUT", "/specialist-projects/ws_second/instructions", { body: { text: "x".repeat(8_001) } })).json), "instructions_too_long");
  const cleared = projectInstructionsSchema.parse((await call("PUT", "/specialist-projects/ws_second/instructions", { body: { text: "  " } })).json);
  assert.equal(cleared.updatedAt, null);
  const detail = projectDetailSchema.parse((await call("GET", "/specialist-projects/ws_second")).json);
  assert.equal(detail.instructions.set, false);
});

test("context: upload, folders, listing, capacity and path safety", async () => {
  const { call, second, root } = harness;
  const empty = projectContextListingSchema.parse((await call("GET", "/specialist-projects/ws_second/context")).json);
  assert.deepEqual(empty.entries, []);
  assert.equal(empty.agentPath, "proyecto/contexto");

  const folder = projectContextChangeSchema.parse((await call("POST", "/specialist-projects/ws_second/context/folders", { body: { path: "Normas" } })).json);
  assert.equal(folder.entry?.kind, "folder");
  const upload = await call("POST", "/specialist-projects/ws_second/context/files?path=Normas&name=resolucion.txt", { raw: "Texto de la resolución." });
  assert.equal(upload.status, 201);
  const uploaded = projectContextChangeSchema.parse(upload.json);
  assert.equal(uploaded.entry?.path, "Normas/resolucion.txt");
  assert.equal(uploaded.usage.files, 1);
  await call("POST", "/specialist-projects/ws_second/context/files?name=lista.csv", { raw: "a,b\n1,2\n" });
  assert.equal(await readFile(join(second, "proyecto", "contexto", "Normas", "resolucion.txt"), "utf8"), "Texto de la resolución.");

  const listing = projectContextListingSchema.parse((await call("GET", "/specialist-projects/ws_second/context", { actor: "client" })).json);
  assert.deepEqual(listing.entries.map(entry => [entry.kind, entry.path, entry.items]), [["folder", "Normas", 1], ["file", "lista.csv", null]]);
  assert.equal(listing.entries[0]?.size, Buffer.byteLength("Texto de la resolución."));
  assert.equal(listing.usage.files, 2);
  const inner = projectContextListingSchema.parse((await call("GET", "/specialist-projects/ws_second/context?path=Normas")).json);
  assert.deepEqual(inner.entries.map(entry => entry.name), ["resolucion.txt"]);

  assert.equal(code((await call("POST", "/specialist-projects/ws_second/context/files?name=lista.csv", { raw: "otra" })).json), "context_exists");
  assert.equal((await call("POST", "/specialist-projects/ws_second/context/files?name=lista.csv&replace=true", { raw: "otra" })).status, 201);
  assert.equal(code((await call("POST", "/specialist-projects/ws_second/context/files?name=..%2Fescape.txt", { raw: "x" })).json), "context_path_invalid");
  assert.equal(code((await call("POST", "/specialist-projects/ws_second/context/files?name=.env", { raw: "x" })).json), "context_path_hidden");
  assert.equal(code((await call("POST", "/specialist-projects/ws_second/context/files?path=NoExiste&name=a.txt", { raw: "x" })).json), "context_not_found");
  assert.equal(code((await call("GET", "/specialist-projects/ws_second/context?path=..")).json), "context_path_invalid");
  assert.equal(code((await call("POST", "/specialist-projects/ws_second/context/folders", { body: { path: "Normas" } })).json), "context_exists");

  // A link inside the context is neither listed nor followed.
  const outside = join(root, "outside");
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, "secreto.txt"), "no");
  await symlink(outside, join(second, "proyecto", "contexto", "Enlace"));
  const withLink = projectContextListingSchema.parse((await call("GET", "/specialist-projects/ws_second/context")).json);
  assert.ok(!withLink.entries.some(entry => entry.name === "Enlace"));
  assert.equal(code((await call("GET", "/specialist-projects/ws_second/context?path=Enlace")).json), "context_unsafe_path");
  assert.equal(code((await call("POST", "/specialist-projects/ws_second/context/files?path=Enlace&name=x.txt", { raw: "x" })).json), "context_unsafe_path");

  // A declared size above the per-file cap is refused before anything is written.
  const big = await call("POST", "/specialist-projects/ws_second/context/files?name=grande.bin", { raw: new Uint8Array(26 * 1024 * 1024 + 1) });
  assert.equal(big.status, 413);
  assert.equal(code(big.json), "context_file_too_large");

  const agent = await projectAgentInstructions(second, "Importación");
  assert.match(agent ?? "", /proyecto\/contexto\/Normas\/resolucion\.txt/);

  const removed = projectContextChangeSchema.parse((await call("DELETE", "/specialist-projects/ws_second/context?path=Normas")).json);
  assert.equal(removed.usage.files, 1);
  assert.equal(code((await call("DELETE", "/specialist-projects/ws_second/context?path=Normas")).json), "context_not_found");
  assert.equal(code((await call("DELETE", "/specialist-projects/ws_second/context?path=")).json), "context_path_required");
  const detail = projectDetailSchema.parse((await call("GET", "/specialist-projects/ws_second")).json);
  assert.equal(detail.context.files, 1);
  assert.equal(detail.recentSessionsComplete, false, "no engine in this test: recent sessions are reported as incomplete");
});

test("memory: project notes can be listed, added, edited and deleted", async () => {
  const { call } = harness;
  const empty = projectMemorySchema.parse((await call("GET", "/specialist-projects/ws_first/memory", { actor: "client" })).json);
  assert.deepEqual([empty.revision, empty.notes.length, empty.writable], [0, 0, false]);
  const added = projectMemorySchema.parse((await call("POST", "/specialist-projects/ws_first/memory", { body: { expectedRevision: 0, text: "El cliente prefiere FOB." } })).json);
  const note = added.notes[0];
  assert.ok(note);
  const edited = projectMemorySchema.parse((await call("POST", "/specialist-projects/ws_first/memory", { body: { expectedRevision: added.revision, text: "El cliente prefiere CIF.", id: note.id } })).json);
  assert.equal(edited.notes[0]?.text, "El cliente prefiere CIF.");
  assert.equal(code((await call("POST", "/specialist-projects/ws_first/memory", { body: { expectedRevision: 0, text: "Vieja" } })).json), "memory_conflict");
  assert.equal(projectDetailSchema.parse((await call("GET", "/specialist-projects/ws_first")).json).memory.entries, 1);
  // Memory belongs to the folder: another project of the same application does not see it.
  assert.equal(projectMemorySchema.parse((await call("GET", "/specialist-projects/ws_second/memory")).json).notes.length, 0);
  const deleted = projectMemorySchema.parse((await call("DELETE", `/specialist-projects/ws_first/memory/${note.id}?expectedRevision=${edited.revision}`)).json);
  assert.equal(deleted.notes.length, 0);
});

test("tasks: per-project listing, permission mode and advanced settings through the application routes", async () => {
  const { call, app, config } = harness;
  const schedule = { kind: "daily", hour: 9, minute: 0 };
  const created = await call("POST", `/specialist-applications/${app.id}/tasks`, { body: { name: "Resumen", prompt: "Resume novedades.", schedule, workspaceId: "ws_second", permissionMode: "auto", advanced: { catchUp: false, isolation: false } } });
  assert.equal(created.status, 200);
  const legacy = await createTask(config, app.id, { name: "Antigua", prompt: "Revisa.", schedule });
  assert.equal(legacy.permissionMode, "manual", "tasks without an explicit choice ask the person");
  assert.equal(legacy.workspaceId, null);

  const second = projectTaskListSchema.parse((await call("GET", "/specialist-projects/ws_second/tasks", { actor: "client" })).json);
  assert.equal(second.applicationId, app.id);
  assert.deepEqual(second.tasks.map(task => [task.name, task.permissionMode, task.advanced.catchUp, task.advanced.isolation, task.workspaceId]), [["Resumen", "auto", false, false, "ws_second"]]);
  // A task that names no project runs in the application's first live project.
  const first = projectTaskListSchema.parse((await call("GET", "/specialist-projects/ws_first/tasks")).json);
  assert.deepEqual(first.tasks.map(task => task.name), ["Antigua"]);
  assert.equal(projectDetailSchema.parse((await call("GET", "/specialist-projects/ws_second")).json).scheduled.tasks, 1);

  const taskId = second.tasks[0]?.id ?? "";
  const updated = await call("PUT", `/specialist-applications/${app.id}/tasks/${taskId}`, { body: { permissionMode: "manual", advanced: { catchUp: true } } });
  assert.equal(updated.status, 200);
  const stored = (await listTasks(config, app.id)).find(task => task.id === taskId);
  assert.deepEqual([stored?.permissionMode, stored?.catchUp, stored?.isolation, stored?.workspaceId], ["manual", true, false, "ws_second"]);

  assert.equal(code((await call("POST", `/specialist-applications/${app.id}/tasks`, { body: { name: "Ajena", prompt: "x", schedule, workspaceId: "ws_other" } })).json), "workspace_not_bound");
  assert.equal(code((await call("POST", `/specialist-applications/${app.id}/tasks`, { body: { name: "Rara", prompt: "x", schedule, permissionMode: "siempre" } })).json), "invalid_task");
  // The core task input (agent tools, proposals, imports) cannot carry owner settings.
  const sneaky = await createTask(config, app.id, { name: "Agente", prompt: "x", schedule, permissionMode: "auto", workspaceId: "ws_second" });
  assert.deepEqual([sneaky.permissionMode, sneaky.workspaceId], ["manual", null]);
});

test("every project route answers 404 while the feature is off", async () => {
  const { call } = harness;
  process.env.DEN_FEATURE_PROJECTS_EXPERIENCE = "false";
  try {
    for (const [method, path] of [["GET", "/specialist-projects"], ["GET", "/specialist-projects/ws_first"], ["GET", "/specialist-projects/ws_first/context"], ["GET", "/specialist-projects/ws_first/tasks"]] as const) {
      const response = await call(method, path);
      assert.equal(response.status, 404, path);
      assert.equal(code(response.json), "projects_disabled");
    }
  } finally { process.env.DEN_FEATURE_PROJECTS_EXPERIENCE = "true"; }
});

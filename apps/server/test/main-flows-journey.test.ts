import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

// App-less journey over the real HTTP server: the main flows a person walks through, end to end,
// with no engine prompts. Everything lives in one temp dir (HOME, XDG and the env store included).
const dir = mkdtempSync(join(tmpdir(), "main-flows-journey-"));
const HOST = "journey-host";
const CLIENT = "journey-client";
const overrides: Record<string, string | undefined> = {
  HOME: join(dir, "home"), XDG_CONFIG_HOME: join(dir, "config"), XDG_DATA_HOME: join(dir, "data"),
  XDG_STATE_HOME: join(dir, "state"), XDG_CACHE_HOME: join(dir, "cache"),
  OPENWORK_DATA_DIR: join(dir, "openwork"), OPENWORK_RUNTIME_DB: join(dir, "runtime.sqlite"),
  OPENCODE_DB: join(dir, "v1.db"), OPENWORK_ENGINE_AUTO_UPGRADE: "0",
  OPENWORK_ENV_STORE: join(dir, "env.json"),
  DEN_FEATURE_SPECIALIST_APPLICATIONS: "true", DEN_FEATURE_SPECIALIST_LIBRARY: "true",
  DEN_FEATURE_SCHEDULED_TASKS: "true", DEN_FEATURE_SPECIALIST_APP_PORTABILITY: "true",
};
const previous = new Map(Object.keys(overrides).map(key => [key, process.env[key]]));
let server: { port: number; stop: () => void | Promise<void> };

before(async () => {
  for (const [key, value] of Object.entries(overrides)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  mkdirSync(join(dir, "workspace"), { recursive: true });
  const { resolveServerConfig } = await import("../src/config.js");
  const { startServer } = await import("../src/server.js");
  const config = await resolveServerConfig({ configPath: join(dir, "server.json"), workspaces: [join(dir, "workspace")], port: 0, token: CLIENT, hostToken: HOST, logRequests: false });
  config.approval = { mode: "auto", timeoutMs: 1000 };
  server = await startServer(config);
});
after(async () => {
  await server?.stop();
  for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  rmSync(dir, { recursive: true, force: true });
});

async function call(method: string, path: string, headers: Record<string, string>, body?: unknown) {
  const response = await fetch(`http://127.0.0.1:${server.port}${path}`, { method, headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, text, json: text ? z.unknown().parse(JSON.parse(text)) : null };
}
const host = { "x-openwork-host-token": HOST };
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

const application = z.object({ id: z.string(), name: z.string() });
const catalog = z.object({ applications: z.array(application) });
const created = z.object({ application, workspaceId: z.string(), catalog });
const task = z.object({ id: z.string(), name: z.string(), enabled: z.boolean() });
const tasks = z.object({ tasks: z.array(task) });
const workspaces = z.object({ items: z.array(z.object({ id: z.string() })) });

test("create, organize, move and share an application without the engine", async () => {
  // 1. A custom specialist application (host only: the page's collaborator token cannot).
  const input = { userName: "Persona", name: "Viaje", specialty: "Pruebas de recorrido", template: "custom" };
  assert.equal((await call("POST", "/specialist-applications", bearer(CLIENT), input)).status, 401);
  const first = await call("POST", "/specialist-applications", host, input);
  assert.equal(first.status, 201, first.text);
  const app = created.parse(first.json);
  assert.notEqual(app.workspaceId, "");
  assert.deepEqual(app.catalog.applications.map(item => item.name), ["Viaje"]);

  // 2. A second project inside it, visible as a workspace.
  const project = await call("POST", `/specialist-applications/${app.application.id}/projects`, host, { name: "Segundo" });
  assert.equal(project.status, 201, project.text);
  const projectId = z.object({ workspaceId: z.string() }).parse(project.json).workspaceId;
  const listed = workspaces.parse((await call("GET", "/workspaces", bearer(CLIENT))).json).items.map(item => item.id);
  assert.equal(listed.includes(app.workspaceId), true);
  assert.equal(listed.includes(projectId), true);

  // 3. Scheduled tasks: create, list, delete.
  const tasksPath = `/specialist-applications/${app.application.id}/tasks`;
  const made = await call("POST", tasksPath, host, { name: "Resumen semanal", prompt: "Resumí la semana.", schedule: { kind: "weekly", daysOfWeek: [1], hour: 9, minute: 0 } });
  assert.equal(made.status, 200, made.text);
  const taskId = z.object({ task }).parse(made.json).task.id;
  assert.deepEqual(tasks.parse((await call("GET", tasksPath, bearer(CLIENT))).json).tasks.map(item => item.name), ["Resumen semanal"]);
  const removed = await call("DELETE", `${tasksPath}/${taskId}`, host);
  assert.equal(removed.status, 200, removed.text);
  assert.deepEqual(tasks.parse(removed.json).tasks, []);
  // Leave one task so the bundle carries it (imported tasks come back paused).
  assert.equal((await call("POST", tasksPath, host, { name: "Diaria", prompt: "Revisá novedades.", schedule: { kind: "daily", hour: 8, minute: 30 } })).status, 200);

  // 4. Export, delete, import the bundle back.
  const exported = await call("GET", `/specialist-applications/${app.application.id}/export`, host);
  assert.equal(exported.status, 200, exported.text);
  const bundle = z.object({ format: z.literal("openwork.specialist-application") }).passthrough().parse(exported.json);
  assert.equal(exported.text.includes(dir), false, "the bundle never carries machine paths");
  const deleted = await call("DELETE", `/specialist-applications/${app.application.id}`, host);
  assert.equal(deleted.status, 200, deleted.text);
  assert.deepEqual(z.object({ catalog }).parse(deleted.json).catalog.applications, []);
  const afterDelete = workspaces.parse((await call("GET", "/workspaces", bearer(CLIENT))).json).items.map(item => item.id);
  assert.equal(afterDelete.includes(app.workspaceId) || afterDelete.includes(projectId), false);
  const imported = await call("POST", "/specialist-applications/import", host, { bundle });
  assert.equal(imported.status, 201, imported.text);
  const restored = z.object({ application, workspaceId: z.string() }).parse(imported.json);
  assert.equal(restored.application.name, "Viaje");
  const restoredTasks = tasks.parse((await call("GET", `/specialist-applications/${restored.application.id}/tasks`, bearer(CLIENT))).json).tasks;
  assert.deepEqual(restoredTasks.map(item => [item.name, item.enabled]), [["Diaria", false]]);

  // 5. Pair a device with a one-time code and repeat a host action as that device.
  const code = z.object({ code: z.string() }).parse((await call("POST", "/pairing/codes", host)).json).code;
  const device = z.object({ id: z.string(), token: z.string() }).parse((await call("POST", "/pairing/redeem", {}, { code, deviceName: "Celular" })).json);
  const byDevice = await call("POST", `/specialist-applications/${restored.application.id}/projects`, bearer(device.token), { name: "Desde el celular" });
  assert.equal(byDevice.status, 201, byDevice.text);
  const deviceTask = await call("POST", `/specialist-applications/${restored.application.id}/tasks`, bearer(device.token), { name: "Del celular", prompt: "Avisame.", schedule: { kind: "interval", everyMinutes: 120 } });
  assert.equal(deviceTask.status, 200, deviceTask.text);

  // 6. Revoke it: the same host action is refused at once.
  assert.equal((await call("DELETE", `/pairing/devices/${device.id}`, host)).status, 200);
  assert.equal((await call("POST", `/specialist-applications/${restored.application.id}/projects`, bearer(device.token), { name: "Tarde" })).status, 401);
  assert.equal((await call("GET", "/pairing/devices", bearer(device.token))).status, 401);
});

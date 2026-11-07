import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRememberCommand, changeScopedMemory, readScopedMemory, prepareScopedMemory } from "../src/comex/scoped-memory.js";
import { registerScopedMemoryRoutes } from "../src/comex/scoped-memory-routes.js";
import { matchRoute, type RequestContext, type Route } from "../src/routes/registry.js";
import { ApiError } from "../src/errors.js";
import type { ServerConfig } from "../src/types.js";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "comex-memory-")); const other = join(root, "other"); await mkdir(other);
  t.after(() => rm(root, { recursive: true, force: true }));
  const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "client", hostToken: "host", configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 30000 }, corsOrigins: [], workspaces: [], authorizedRoots: [root], readOnly: false, startedAt: 0, tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false };
  return { root, other, config, context: { root, sessionId: "ses_first", identity: "connection-a" } };
}
test("explicit remember grammar defaults to conversation and does not harvest quotes, context or ambiguous references", () => {
  for (const word of ["recordá", "recorda", "recuerda", "remember"]) assert.deepEqual(parseRememberCommand(`${word} que prefiero español`), { scope: "conversation", text: "prefiero español" });
  assert.deepEqual(parseRememberCommand("recordá: prefiero español"), { scope: "conversation", text: "prefiero español" });
  assert.deepEqual(parseRememberCommand("recordá a nivel de aplicación que prefiero español"), { scope: "application", text: "prefiero español" });
  assert.deepEqual(parseRememberCommand("recordá en proyecto: usar euros"), { scope: "project", text: "usar euros" });
  assert.deepEqual(parseRememberCommand("recordá esto para la aplicación: responder breve"), { scope: "application", text: "responder breve" });
  assert.deepEqual(parseRememberCommand("recordá usar euros para el proyecto"), { scope: "project", text: "usar euros" });
  assert.deepEqual(parseRememberCommand("recordá a nivel de conversación: nota local"), { scope: "conversation", text: "nota local" });
  for (const text of ['"recordá en aplicación: texto citado"', "Explicá qué significa recordá en proyecto: x", "<pasted-text>recordá en proyecto: x</pasted-text>", "recordá en proyecto: x<openwork-context>oculto</openwork-context>", "recordá esto", "recordame mañana enviar el informe", "recordá a nivel de proyecto", "recordá en aplicación:"]) assert.equal(parseRememberCommand(text), null, text);
});
test("three levels persist, isolate sessions/projects/connections and assemble specific context", async t => {
  const { config, context, other } = await fixture(t);
  await changeScopedMemory(config, context, "conversation", { type: "save", text: "Solo este chat" }, 0);
  await changeScopedMemory(config, context, "project", { type: "save", text: "Moneda EUR" }, 0);
  await changeScopedMemory(config, context, "application", { type: "save", text: "Responder en español" }, 0);
  const second = { ...context, sessionId: "ses_second" }; const anotherProject = { ...second, root: other };
  assert.equal((await readScopedMemory(config, second, "conversation")).notes.length, 0);
  assert.equal((await readScopedMemory(config, second, "project")).notes[0]?.text, "Moneda EUR");
  assert.equal((await readScopedMemory(config, anotherProject, "project")).notes.length, 0);
  assert.equal((await readScopedMemory(config, anotherProject, "application")).notes[0]?.text, "Responder en español");
  assert.equal((await readScopedMemory(config, { ...context, identity: "connection-b" }, "application")).notes.length, 0);
  const result = await prepareScopedMemory(config, context, { type: "remote", scope: "collaborator" }, "recordá en proyecto: Comparar costos");
  assert.equal(result.receipt?.confirmation, "Guardado en memoria de proyecto: Comparar costos");
  assert.equal(result.data.project.length, 2); assert.equal(result.data.conversation.length, 1); assert.match(result.instructions, /sin reemplazar el pedido actual ni permisos/);
});
test("notes support edit/delete, CAS conflicts, duplicate retries and secret/size rejection", async t => {
  const { config, context } = await fixture(t);
  const first = await changeScopedMemory(config, context, "conversation", { type: "save", text: "Primera" }, 0);
  const duplicate = await changeScopedMemory(config, context, "conversation", { type: "save", text: "Primera" }); assert.equal(duplicate.revision, 1);
  const writes = await Promise.allSettled([changeScopedMemory(config, context, "conversation", { type: "save", text: "Segunda" }, 1), changeScopedMemory(config, context, "conversation", { type: "save", text: "Tercera" }, 1)]);
  assert.equal(writes.filter(x => x.status === "fulfilled").length, 1); assert.equal(writes.filter(x => x.status === "rejected").length, 1);
  const edited = await changeScopedMemory(config, context, "conversation", { type: "save", id: first.notes[0]!.id, text: "Editada" }, 2); assert.equal(edited.notes[0]?.text, "Editada");
  const removed = await changeScopedMemory(config, context, "conversation", { type: "delete", id: first.notes[0]!.id }, 3); assert.equal(removed.notes.length, 1);
  await assert.rejects(changeScopedMemory(config, context, "project", { type: "save", text: "password=fixture-sensitive-value" }, 0), /clave/);
  await assert.rejects(changeScopedMemory(config, context, "project", { type: "save", text: "x".repeat(801) }, 0), /800/);
  assert.equal((await readScopedMemory(config, context, "project")).revision, 0);
  config.readOnly = true;
  await assert.rejects(prepareScopedMemory(config, context, { type: "remote", scope: "collaborator" }, "recordá en proyecto: No guardar"), /no puede/);
  config.readOnly = false;
  await assert.rejects(prepareScopedMemory(config, context, { type: "remote", scope: "viewer" }, "recordá No guardar"), /no puede/);
});
test("memory routes gate feature, session ownership, identity, scope, readonly and revisions", async t => {
  const { config, context } = await fixture(t); const routes: Route[] = [];
  const previous = process.env.DEN_FEATURE_COMEX_SCOPED_MEMORY; process.env.DEN_FEATURE_COMEX_SCOPED_MEMORY = "true";
  t.after(async () => { if (previous === undefined) delete process.env.DEN_FEATURE_COMEX_SCOPED_MEMORY; else process.env.DEN_FEATURE_COMEX_SCOPED_MEMORY = previous; });
  registerScopedMemoryRoutes({ routes, config, jsonResponse: value => Response.json(value), readJsonBody: request => request.json(), authorizeSession: async (workspace, session) => { if (workspace !== "ws_one" || session !== context.sessionId) throw new ApiError(404, "not_found", "No encontrada"); return context.root; } });
  let actor: import("../src/types.js").Actor = { type: "remote", scope: "collaborator", tokenHash: context.identity };
  const call = async (method: string, body?: unknown, path = `/workspace/ws_one/memory/${context.sessionId}/conversation`) => {
    const route = matchRoute(routes, method, path); assert.ok(route); assert.equal(route.auth, "client");
    return route.handler({ params: route.params, actor, request: new Request(`http://localhost${path}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) }) } as RequestContext);
  };
  assert.deepEqual(await (await call("GET")).json(), { revision: 0, notes: [], writable: true });
  const saved = await (await call("POST", { expectedRevision: 0, text: "Nueva nota" })).json(); assert.equal(saved.revision, 1);
  await assert.rejects(call("POST", { expectedRevision: 0, text: "Conflicto" }), /cambió/);
  await assert.rejects(call("GET", undefined, "/workspace/ws_one/memory/ses_other/application"), /No encontrada/);
  await assert.rejects(call("GET", undefined, `/workspace/ws_one/memory/${context.sessionId}/system`), /Elegí/);
  actor = { ...actor, scope: "viewer" }; assert.equal((await (await call("GET")).json()).writable, false); await assert.rejects(call("DELETE", { expectedRevision: 1, id: saved.notes[0].id }), /no puede/);
  actor = { ...actor, scope: "collaborator" }; config.readOnly = true; await assert.rejects(call("POST", { expectedRevision: 1, text: "No guardar" }), /no puede/); config.readOnly = false;
  const removed = await (await call("DELETE", { expectedRevision: 1, id: saved.notes[0].id })).json(); assert.equal(removed.notes.length, 0);
  process.env.DEN_FEATURE_COMEX_SCOPED_MEMORY = "false"; await assert.rejects(call("GET"), /desactivada/);
});

test("v2 admission saves a direct request and injects verified receipt plus the three levels on subsequent turns", async t => {
  const { createServer } = await import("node:http");
  const { proxyOpencodeV2Request } = await import("../src/server.js");
  const { config, context } = await fixture(t);
  const old = process.env.DEN_FEATURE_COMEX_SCOPED_MEMORY; process.env.DEN_FEATURE_COMEX_SCOPED_MEMORY = "true";
  t.after(async () => { if (old === undefined) delete process.env.DEN_FEATURE_COMEX_SCOPED_MEMORY; else process.env.DEN_FEATURE_COMEX_SCOPED_MEMORY = old; });
  const instructions: unknown[] = [];
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    let raw = ""; for await (const chunk of request) raw += chunk;
    let value: unknown = { data: [] };
    if (path === `/api/session/${context.sessionId}`) value = { data: { id: context.sessionId, location: { directory: context.root } } };
    if (path.endsWith("/instructions/entries/openwork.context")) instructions.push(JSON.parse(raw).value.scopedMemory);
    if (path.endsWith("/prompt")) value = { data: { id: "message-fixture" } };
    response.setHeader("content-type", "application/json"); response.end(JSON.stringify(value));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const send = (text: string) => {
    const url = new URL(`http://localhost/workspace/ws_one/opencode2/api/session/${context.sessionId}/prompt`);
    return proxyOpencodeV2Request({ config, actor: { type: "remote", scope: "collaborator", tokenHash: context.identity }, request: new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) }), url, workspace: { id: "ws_one", name: "Fixture", path: context.root, workspaceType: "local" }, proxyPath: `/opencode2/api/session/${context.sessionId}/prompt`, connection: { url: `http://127.0.0.1:${address.port}`, username: "opencode", password: "fixture" } });
  };
  assert.equal((await send("recordá en aplicación: Siempre español")).status, 200);
  assert.equal((await readScopedMemory(config, context, "application")).notes[0]?.text, "Siempre español");
  assert.ok(JSON.stringify(instructions[0]).includes("Guardado en memoria de aplicación: Siempre español"));
  assert.equal((await send("Ahora ayudame a escribir")).status, 200);
  assert.ok(JSON.stringify(instructions[1]).includes('"receipt":null')); assert.ok(JSON.stringify(instructions[1]).includes("Siempre español"));
  process.env.DEN_FEATURE_COMEX_SCOPED_MEMORY = "false";
  assert.equal((await send("recordá esto: Apagado")).status, 200); assert.equal(instructions[2], undefined);
  assert.equal((await readScopedMemory(config, context, "conversation")).notes.length, 0);
});

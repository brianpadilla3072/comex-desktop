import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiError } from "../src/errors.js";
import { workspaceIdForPath } from "../src/workspaces.js";
import { runLibraryTool, syncLibraryToolPlugin } from "../src/specialists/library-tool-api.js";
import { openSpecialistStore, specialistStore, applicationInput } from "../src/specialists/store.js";
import { inspectSpecialistPack, prepareSpecialistWorkspace, saveSpecialistPack } from "../src/specialists/packs.js";
import {
  createLibraryAgent, createLibrarySkill, deleteLibraryFile, listSpecialistLibrary,
  readLibraryFile, readSpecialistContext, writeLibraryFile, writeSpecialistContext,
} from "../src/specialists/library.js";
import { syncSpecialistWorkspace } from "../src/specialists/sync.js";
import { specialistInstructions } from "../src/specialists/instructions.js";
import { readComexMemory } from "../src/comex/seed.js";
import { registerSpecialistRoutes } from "../src/specialists/routes.js";
import { matchRoute, type RequestContext, type Route } from "../src/routes/registry.js";
import type { ServerConfig } from "../src/types.js";

const input = (name: string) => applicationInput.parse({ userName: "Usuario de prueba", name, specialty: `Especialidad ${name}`, personality: `PERSONA_${name}`, template: "custom" });

function apiHarness(config: { configPath: string; workspaces: Array<{ id: string; path: string }> }) {
  const routes: Route[] = [];
  registerSpecialistRoutes({
    routes,
    config: config as unknown as ServerConfig,
    readJsonBody: async (request: Request) => await request.json() as Record<string, unknown>,
    jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
    ensureWritable: () => {},
    createWorkspace: async () => "ws_new",
  });
  return async (method: string, path: string, body?: unknown, search = "") => {
    const match = matchRoute(routes, method, path);
    assert.ok(match, `no route for ${method} ${path}`);
    const url = new URL(`http://127.0.0.1:1${path}${search}`);
    const request = new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    const ctx = { request, url, params: match.params, config } as unknown as RequestContext;
    try {
      const response = await match.handler(ctx);
      return { status: response.status, json: await response.json() as Record<string, unknown> };
    } catch (error) {
      // The server's dispatcher turns ApiError into a JSON response; mimic it here.
      if (error instanceof ApiError) return { status: error.status, json: { error: error.code } };
      throw error;
    }
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "specialists-library-"));
  const config = { configPath: join(root, "server.json") };
  const store = await openSpecialistStore(join(root, "profiles.sqlite"));
  const pack = join(root, "source");
  await mkdir(join(pack, "skills", "tono", "references"), { recursive: true });
  await mkdir(join(pack, "agents"));
  await writeFile(join(pack, "skills", "tono", "SKILL.md"), "---\nname: tono\ndescription: Una skill de prueba.\n---\nAyudá con claridad.\n");
  await writeFile(join(pack, "skills", "tono", "references", "datos.csv"), "dato,valor\na,1\n");
  await writeFile(join(pack, "agents", "revisor.md"), "---\ndescription: Revisor de prueba.\nmode: subagent\n---\nRevisá evidencia.\n");
  const app = store.create(input("Alpha"), { agents: 1, skills: 1 });
  await saveSpecialistPack(config, app.id, await inspectSpecialistPack(pack));
  return { root, config, store, app };
}

test("library marks official files, detects edits and separates custom creations", async () => {
  const { config, store, app, root } = await fixture();
  try {
    let listing = await listSpecialistLibrary(config, app.id);
    assert.deepEqual(listing.counts, { agents: 1, skills: 1 });
    assert.equal(listing.agents[0]?.origin, "official");
    assert.equal(listing.skills[0]?.origin, "official");
    assert.equal(listing.skills[0]?.resources, 1);
    await writeLibraryFile(config, app.id, "agents/revisor.md", "---\ndescription: Revisor editado.\nmode: subagent\n---\nRevisá distinto.\n");
    await createLibrarySkill(config, app.id, { name: "mi-procedimiento", description: "Repite lo enseñado.", content: undefined });
    listing = await listSpecialistLibrary(config, app.id);
    assert.equal(listing.agents[0]?.origin, "official-modified");
    assert.equal(listing.agents[0]?.description, "Revisor editado.");
    assert.equal(listing.skills.find(skill => skill.name === "mi-procedimiento")?.origin, "custom");
    assert.deepEqual(listing.counts, { agents: 1, skills: 2 });
    const created = await readLibraryFile(config, app.id, "skills/mi-procedimiento/SKILL.md");
    assert.ok(created.content.includes("name: mi-procedimiento") && created.content.includes("description: Repite lo enseñado."));
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

test("library rejects traversal, broken headers and name mismatches", async () => {
  const { config, store, app, root } = await fixture();
  try {
    await assert.rejects(readLibraryFile(config, app.id, "../profiles.sqlite"), /Ruta inválida/);
    await assert.rejects(writeLibraryFile(config, app.id, "agents/Mi Agente.md"), /kebab-case/);
    await assert.rejects(writeLibraryFile(config, app.id, "agents/sin-desc.md", "---\nmode: all\n---\nTexto\n"), /descripción/);
    await assert.rejects(writeLibraryFile(config, app.id, "skills/tono/SKILL.md", "---\nname: otra\ndescription: Prueba\n---\nTexto\n"), /coincidir/);
    await assert.rejects(writeLibraryFile(config, app.id, ".opencode/x", "x"), /ocultos/);
    await assert.rejects(writeLibraryFile(config, app.id, "node_modules/x/y.md", "x"), /Solo podés editar/);
    await assert.rejects(createLibraryAgent(config, app.id, { name: "revisor", description: "Duplicado." }), /Ya existe/);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

test("application context is editable and injected into the turn instructions", async () => {
  const { config, store, app, root } = await fixture();
  try {
    assert.equal(await readSpecialistContext(config, app.id), null);
    await writeSpecialistContext(config, app.id, "Siempre entregá en PDF y firmá con mi seudónimo.");
    const context = await readSpecialistContext(config, app.id);
    assert.ok(context?.includes("seudónimo"));
    await mkdir(join(root, "memproject"));
    const prompt = specialistInstructions(app, store.user(), await readComexMemory(join(root, "memproject"), "session_x"), context);
    assert.ok(prompt.includes("instrucciones propias") && prompt.includes("seudónimo"));
    await writeSpecialistContext(config, app.id, "   ");
    assert.equal(await readSpecialistContext(config, app.id), null);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

test("sync materializes library edits into projects, protects project edits with .nuevo and removes deletions", async () => {
  const { config, store, app, root } = await fixture();
  const project = join(root, "project");
  try {
    store.bind("ws_1", app.id, project);
    await prepareSpecialistWorkspace(config, app, project);
    const installed = join(project, ".opencode", "agents", "revisor.md");
    assert.ok((await readFile(installed, "utf8")).includes("Revisor de prueba."));
    // Library edit flows to an unmodified project copy.
    await writeLibraryFile(config, app.id, "agents/revisor.md", "---\ndescription: Revisor v2.\nmode: subagent\n---\nRevisá doble.\n");
    let sync = await syncSpecialistWorkspace(config, app, project, "ws_1");
    assert.equal(sync.error, undefined);
    assert.equal(sync.updated, 1);
    assert.ok((await readFile(installed, "utf8")).includes("Revisor v2."));
    // A project-local edit is never overwritten: the update lands as .nuevo.
    await writeFile(installed, "---\ndescription: Edité acá.\nmode: subagent\n---\nLocal.\n");
    await writeLibraryFile(config, app.id, "agents/revisor.md", "---\ndescription: Revisor v3.\nmode: subagent\n---\nRevisá triple.\n");
    sync = await syncSpecialistWorkspace(config, app, project, "ws_1");
    assert.ok((await readFile(installed, "utf8")).includes("Edité acá."));
    assert.ok((await readFile(`${installed}.nuevo`, "utf8")).includes("Revisor v3."));
    assert.deepEqual(sync.nuevo, ["agents/revisor.md"]);
    // New library files install on the next sync; deletions remove clean copies.
    await createLibrarySkill(config, app.id, { name: "nueva", description: "Creada después." });
    sync = await syncSpecialistWorkspace(config, app, project, "ws_1");
    assert.equal(sync.installed, 1);
    assert.ok((await readFile(join(project, ".opencode", "skills", "nueva", "SKILL.md"), "utf8")).includes("Creada después."));
    await deleteLibraryFile(config, app.id, "skills/nueva/SKILL.md");
    sync = await syncSpecialistWorkspace(config, app, project, "ws_1");
    assert.equal(sync.removed, 1);
    await assert.rejects(readFile(join(project, ".opencode", "skills", "nueva", "SKILL.md")));
    assert.equal((await listSpecialistLibrary(config, app.id)).counts.skills, 1);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

test("deleting a skill removes the whole folder and its manifest entries", async () => {
  const { config, store, app, root } = await fixture();
  try {
    await deleteLibraryFile(config, app.id, "skills/tono/references/datos.csv");
    const listing = await listSpecialistLibrary(config, app.id);
    assert.deepEqual(listing.counts, { agents: 1, skills: 0 });
    await assert.rejects(readLibraryFile(config, app.id, "skills/tono/SKILL.md"), /no está en la biblioteca/);
    const manifest = JSON.parse(await readFile(join(root, "specialists", app.id, "pack", ".library.json"), "utf8")) as Record<string, string>;
    assert.equal(manifest["skills/tono/SKILL.md"], undefined);
    assert.equal(manifest["agents/revisor.md"] !== undefined, true);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

test("library routes validate, store and materialize into the application's projects", async () => {
  const root = await mkdtemp(join(tmpdir(), "specialists-library-routes-"));
  const config = { configPath: join(root, "server.json"), workspaces: [] as Array<{ id: string; path: string }> };
  const store = await specialistStore(config);
  try {
    const pack = join(root, "source");
    await mkdir(join(pack, "agents"), { recursive: true });
    await writeFile(join(pack, "agents", "revisor.md"), "---\ndescription: Revisor de prueba.\nmode: subagent\n---\nRevisá evidencia.\n");
    const app = store.create(input("Alpha"), { agents: 1, skills: 0 });
    await saveSpecialistPack(config, app.id, await inspectSpecialistPack(pack));
    const project = join(root, "project");
    await prepareSpecialistWorkspace(config, app, project);
    config.workspaces.push({ id: "ws_1", path: project });
    store.bind("ws_1", app.id, project);
    const api = apiHarness(config);

    const listing = await api("GET", `/specialist-applications/${app.id}/library`);
    assert.equal(listing.status, 200);
    assert.equal((listing.json.agents as Array<unknown>).length, 1);

    const invalid = await api("POST", `/specialist-applications/${app.id}/library/skills`, { name: "Mal Nombre", description: "X" });
    assert.equal(invalid.status, 422);

    const created = await api("POST", `/specialist-applications/${app.id}/library/skills`, { name: "procedimiento", description: "Repite el procedimiento enseñado." });
    assert.equal(created.status, 201);
    const sync = (created.json.sync as Array<Record<string, unknown>>)[0]!;
    assert.equal(sync.installed, 1);
    assert.ok((await readFile(join(project, ".opencode", "skills", "procedimiento", "SKILL.md"), "utf8")).includes("procedimiento enseñado"));

    const file = await api("GET", `/specialist-applications/${app.id}/library/file`, undefined, `?path=${encodeURIComponent("agents/revisor.md")}`);
    assert.equal(file.status, 200);
    assert.equal(file.json.origin, "official");

    const saved = await api("PUT", `/specialist-applications/${app.id}/library/file`, { path: "agents/revisor.md", content: "---\ndescription: Revisor v2.\nmode: subagent\n---\nRevisá doble.\n" });
    assert.equal(saved.status, 200);
    assert.ok((await readFile(join(project, ".opencode", "agents", "revisor.md"), "utf8")).includes("Revisor v2."));

    const badContext = await api("PUT", `/specialist-applications/${app.id}/context`, { content: "x".repeat(8_001) });
    assert.equal(badContext.status, 422);
    const context = await api("PUT", `/specialist-applications/${app.id}/context`, { content: "Entregá siempre en PDF." });
    assert.equal(context.status, 200);
    const read = await api("GET", `/specialist-applications/${app.id}/context`);
    assert.equal(read.json.content, "Entregá siempre en PDF.");

    const removed = await api("DELETE", `/specialist-applications/${app.id}/library/file`, undefined, `?path=${encodeURIComponent("skills/procedimiento/SKILL.md")}`);
    assert.equal(removed.status, 200);
    await assert.rejects(readFile(join(project, ".opencode", "skills", "procedimiento", "SKILL.md")));
    assert.equal((store.application(app.id).agentCount), 1);
    assert.equal((store.application(app.id).skillCount), 0);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

test("the library tool bridge authenticates by project token and edits through the same rules", async () => {
  const root = await mkdtemp(join(tmpdir(), "specialists-tool-bridge-"));
  const config = { configPath: join(root, "server.json"), port: 4711, workspaces: [] as Array<{ id: string; path: string }> };
  const store = await specialistStore(config);
  try {
    const pack = join(root, "source");
    await mkdir(join(pack, "agents"), { recursive: true });
    await writeFile(join(pack, "agents", "revisor.md"), "---\ndescription: Revisor de prueba.\nmode: subagent\n---\nRevisá evidencia.\n");
    const app = store.create(input("Alpha"), { agents: 1, skills: 0 });
    await saveSpecialistPack(config, app.id, await inspectSpecialistPack(pack));
    const project = join(root, "project");
    await prepareSpecialistWorkspace(config, app, project);
    const workspaceId = workspaceIdForPath(project);
    config.workspaces.push({ id: workspaceId, path: project });
    store.bind(workspaceId, app.id, project);
    await syncLibraryToolPlugin(config, workspaceId, project);
    // The native plugin file landed in the project.
    const pluginFile = await readFile(join(project, ".opencode", "plugins", "comex-library", "server.js"), "utf8");
    assert.ok(pluginFile.includes("createSpecialistLibraryPlugin"));
    // The descriptor is private and its token routes the tool call to this app.
    const files = await readdir(join(root, "specialists", "tool"));
    const descriptor = JSON.parse(await readFile(join(root, "specialists", "tool", files[0]!), "utf8")) as { directory: string; token: string; url: string };
    const listed = await runLibraryTool(config, project, "specialist_library_list", {});
    assert.equal((listed as { application: { name: string } }).application.name, "Alpha");
    const created = await runLibraryTool(config, project, "specialist_skill_create", { name: "procedimiento", description: "Lo que me enseñaste." }) as { counts: { skills: number }; sync: Array<{ installed: number }> };
    assert.equal(created.counts.skills, 1);
    assert.equal(created.sync[0]?.installed, 1); // only the new SKILL.md; the agent was already synced
    assert.ok((await readFile(join(project, ".opencode", "skills", "procedimiento", "SKILL.md"), "utf8")).includes("enseñaste"));
    await assert.rejects(runLibraryTool(config, join(root, "elsewhere"), "specialist_library_list", {}), /aplicación especialista/);
    assert.ok(descriptor.token.length >= 16 && descriptor.url.endsWith("/specialist-tool"));
    // A proposal is stored, listed and applied only through the library route when accepted.
    const proposed = await runLibraryTool(config, project, "specialist_propose", { kind: "skill", name: "metodo-del-lunes", description: "Procedimiento enseñado.", content: "# metodo-del-lunes\n\n1. Paso.", reason: "Se repite cada lunes." }) as { proposal: { id: string } };
    const routes: Route[] = [];
    registerSpecialistRoutes({
      routes, config: config as unknown as ServerConfig,
      readJsonBody: async (request: Request) => await request.json() as Record<string, unknown>,
      jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
      ensureWritable: () => {}, createWorkspace: async () => "ws_new",
    });
    const call = async (method: string, path: string, body?: unknown) => {
      const match = matchRoute(routes, method, path)!;
      const url = new URL(`http://127.0.0.1:1${path}`);
      const response = await match.handler({ request: new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body) }), url, params: match.params, config } as unknown as RequestContext);
      return await response.json() as Record<string, unknown>;
    };
    const proposals = await call("GET", `/specialist-applications/${app.id}/library/proposals`);
    assert.equal((proposals.proposals as Array<Record<string, unknown>>).length, 1);
    await call("POST", `/specialist-applications/${app.id}/library/proposals/${proposed.proposal.id}/accept`, {});
    assert.ok((await readFile(join(project, ".opencode", "skills", "metodo-del-lunes", "SKILL.md"), "utf8")).includes("Paso"));
    const afterAccept = await call("GET", `/specialist-applications/${app.id}/library/proposals`);
    assert.equal((afterAccept.proposals as Array<unknown>).length, 0);
    // The tool route itself: only the project's scoped bearer token authorizes it.
    const toolRoute = matchRoute(routes, "POST", "/specialist-tool")!;
    const toolCall = (headers: Record<string, string>) => {
      const url = new URL("http://127.0.0.1:1/specialist-tool");
      const request = new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ name: "specialist_library_list", input: {} }) });
      return toolRoute.handler({ request, url, params: {}, config } as unknown as RequestContext);
    };
    await assert.rejects(toolCall({}), ApiError);
    const authorized = await toolCall({ authorization: `Bearer ${descriptor.token}` });
    assert.equal(authorized.status, 200);
    const authorizedBody = await authorized.json() as { ok: boolean; result: { application: { name: string } } };
    assert.equal(authorizedBody.ok, true);
    assert.equal(authorizedBody.result.application.name, "Alpha");
    await assert.rejects(toolCall({ authorization: "Bearer nope-nope-nope-nope-nope" }), /credencial/);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

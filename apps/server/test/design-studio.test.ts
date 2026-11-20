import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { unzipSync } from "fflate";
import { z } from "zod";
import { DESIGN_LIMITS, designManifestSchema, designSummarySchema, type DesignPage } from "@openwork/types/designs";
import { ApiError } from "../src/errors.js";
import { designStudioEnabled } from "../src/comex/features.js";
import { applicationInput, specialistStore } from "../src/specialists/store.js";
import { registerDesignRoutes } from "../src/designs/routes.js";
import { DESIGN_CONTENT_SECURITY_POLICY, checkDesignPath, contentTypeFor, designIdFor, insertPage, nextPageId, reorderPages } from "../src/designs/core.js";
import { configureDesignSystemContext, designAgentInstructions } from "../src/designs/guidance.js";
import { matchRoute, type RequestContext, type Route } from "../src/routes/registry.js";
import type { ServerConfig, WorkspaceInfo } from "../src/types.js";

// ---- Contract vectors (contracts/designs/v1) ----

const vectors = z.object({
  contentSecurityPolicy: z.string(),
  ids: z.array(z.object({ title: z.string(), taken: z.array(z.string()), id: z.string() })),
  pageIds: z.array(z.object({ pages: z.array(z.string()), id: z.string() })),
  paths: z.array(z.object({ input: z.string(), result: z.union([z.object({ ok: z.literal(true), path: z.string(), role: z.string() }), z.object({ ok: z.literal(false), code: z.string() })]) })),
  contentTypes: z.array(z.object({ path: z.string(), type: z.string() })),
  reorder: z.array(z.object({ pages: z.array(z.string()), order: z.array(z.string()), result: z.array(z.string()).nullable() })),
  insert: z.array(z.object({ pages: z.array(z.string()), page: z.string(), after: z.string().nullable(), result: z.array(z.string()) })),
}).parse(JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "contracts", "designs", "v1", "vectors.json"), "utf8")));

const page = (id: string): DesignPage => ({ id, title: id, file: `pages/${id}.html`, width: 10, height: 10 });

test("contract: ids, page ids, paths, content types, reorder and insert", () => {
  assert.equal(DESIGN_CONTENT_SECURITY_POLICY, vectors.contentSecurityPolicy);
  for (const vector of vectors.ids) assert.equal(designIdFor(vector.title, new Set(vector.taken)), vector.id, vector.title);
  for (const vector of vectors.pageIds) assert.equal(nextPageId(vector.pages.map(id => ({ id }))), vector.id);
  for (const vector of vectors.paths) assert.deepEqual(checkDesignPath(vector.input), vector.result, vector.input);
  for (const vector of vectors.contentTypes) assert.equal(contentTypeFor(vector.path), vector.type);
  for (const vector of vectors.reorder) assert.deepEqual(reorderPages(vector.pages.map(page), vector.order)?.map(entry => entry.id) ?? null, vector.result);
  for (const vector of vectors.insert) assert.deepEqual(insertPage(vector.pages.map(page), page(vector.page), vector.after).map(entry => entry.id), vector.result);
});

test("designStudio is on by default and follows the operator switch", () => {
  assert.equal(designStudioEnabled({}), true);
  assert.equal(designStudioEnabled({ DEN_FEATURE_DESIGN_STUDIO: "false" }), false);
});

// ---- Routes, against an isolated config folder ----

const FLAGS = ["DEN_FEATURE_SPECIALIST_APPLICATIONS", "DEN_FEATURE_DESIGN_STUDIO"];
const savedFlags = new Map(FLAGS.map(name => [name, process.env[name]]));
type Harness = Awaited<ReturnType<typeof setup>>;
let harness: Harness;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "design-studio-"));
  const workspaces: WorkspaceInfo[] = [];
  const config = { configPath: join(root, "server.json"), port: 4799, token: "test-token", workspaces, readOnly: false };
  const store = await specialistStore(config);
  const app = store.create(applicationInput.parse({ userName: "Persona", name: "Marketing", specialty: "Pruebas", template: "custom" }), { agents: 0, skills: 0 });
  const add = async (id: string, name: string) => {
    const path = join(root, "projects", id);
    await mkdir(path, { recursive: true });
    workspaces.push({ id, name, path, preset: "specialist", workspaceType: "local" });
    store.bind(id, app.id, path);
    return path;
  };
  const first = await add("ws_first", "Lanzamiento");
  const second = await add("ws_second", "Marca");
  // A live workspace that is not a project.
  workspaces.push({ id: "ws_plain", name: "Suelto", path: join(root, "plain"), preset: "starter", workspaceType: "local" });
  const routes: Route[] = [];
  registerDesignRoutes({
    routes, config: z.custom<ServerConfig>(() => true).parse(config),
    readJsonBody: async (request: Request) => z.record(z.string(), z.unknown()).parse(await request.json()),
    jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
    ensureWritable: () => {},
  });
  const raw = async (method: string, path: string, options: { body?: unknown; raw?: BodyInit; actor?: "host" | "client" } = {}): Promise<Response> => {
    const url = new URL(`http://127.0.0.1:1${path}`);
    const match = matchRoute(routes, method, url.pathname);
    assert.ok(match, `no route for ${method} ${url.pathname}`);
    const body = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
    const request = new Request(url, { method, body, ...(body === undefined ? {} : { duplex: "half" }) });
    const actor = options.actor === "client" ? { type: "remote", scope: "collaborator", tokenHash: "hash_client" } : { type: "host", scope: "owner", tokenHash: "hash_host" };
    const ctx = z.custom<RequestContext>(() => true).parse({ request, url, params: match.params, config, actor });
    try {
      return await match.handler(ctx);
    } catch (error) {
      if (error instanceof ApiError) return new Response(JSON.stringify({ code: error.code }), { status: error.status });
      throw error;
    }
  };
  const call = async (method: string, path: string, options: { body?: unknown; raw?: BodyInit; actor?: "host" | "client" } = {}) => {
    const response = await raw(method, path, options);
    return { status: response.status, json: z.unknown().parse(await response.json()) };
  };
  const route = (method: string, path: string, auth: string) => matchRoute(routes, method, path)?.auth === auth;
  return { root, store, first, second, call, raw, route };
}

const code = (value: unknown) => z.object({ code: z.string() }).parse(value).code;
const designOf = (value: unknown) => designManifestSchema.parse(z.object({ design: z.unknown() }).parse(value).design);

before(async () => {
  for (const name of FLAGS) process.env[name] = "true";
  harness = await setup();
});
after(async () => {
  for (const [name, value] of savedFlags) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  configureDesignSystemContext(null);
  harness.store.close();
  await rm(harness.root, { recursive: true, force: true });
});

test("reads are client routes and writes are host routes", () => {
  const { route } = harness;
  const base = "/designs/ws_first/plan";
  assert.ok(route("GET", "/designs", "client"));
  assert.ok(route("POST", "/designs", "host"));
  assert.ok(route("GET", base, "client"));
  assert.ok(route("PATCH", base, "host"));
  assert.ok(route("DELETE", base, "host"));
  assert.ok(route("GET", `${base}/files`, "client"));
  assert.ok(route("PUT", `${base}/files`, "host"));
  assert.ok(route("POST", `${base}/pages`, "host"));
  assert.ok(route("PUT", `${base}/pages/order`, "host"));
  assert.ok(route("DELETE", `${base}/pages/p-1`, "host"));
  assert.ok(route("PUT", `${base}/thumbnail`, "host"));
  assert.ok(route("GET", `${base}/export`, "client"));
  assert.ok(route("GET", `${base}/chats`, "client"));
  assert.ok(route("POST", `${base}/chats`, "host"));
});

test("create every kind from its template, list and read", async () => {
  const { call, first } = harness;
  const slides = await call("POST", "/designs", { body: { workspaceId: "ws_first", kind: "slides", title: "Plan de lanzamiento" } });
  assert.equal(slides.status, 201);
  const deck = designOf(slides.json);
  assert.equal(deck.id, "plan-de-lanzamiento");
  assert.deepEqual(deck.pages.map(entry => [entry.file, entry.width, entry.height]), [["pages/p-1.html", 1920, 1080]]);
  const folder = join(first, "proyecto", "diseno", deck.id);
  assert.match(await readFile(join(folder, "pages", "p-1.html"), "utf8"), /Plan de lanzamiento/);
  assert.ok(existsSync(join(folder, "assets")));

  const mockup = designOf((await call("POST", "/designs", { body: { workspaceId: "ws_first", kind: "mockup", title: "Plan de lanzamiento" } })).json);
  assert.equal(mockup.id, "plan-de-lanzamiento-2");
  assert.equal(mockup.pages[0]?.width, 1440);
  const system = designOf((await call("POST", "/designs", { body: { workspaceId: "ws_first", kind: "system", title: "Marca" } })).json);
  assert.ok(existsSync(join(first, "proyecto", "diseno", system.id, "tokens.json")));
  const board = designOf((await call("POST", "/designs", { body: { workspaceId: "ws_second", kind: "board", title: "Ideas" } })).json);
  const boardFile = JSON.parse(await readFile(join(harness.second, "proyecto", "diseno", board.id, "board.json"), "utf8"));
  assert.equal(z.object({ elements: z.array(z.object({ type: z.string() })) }).parse(boardFile).elements[0]?.type, "frame");

  const all = await call("GET", "/designs", { actor: "client" });
  const list = z.object({ designs: z.array(designSummarySchema), writable: z.boolean() }).parse(all.json);
  assert.equal(list.designs.length, 4);
  assert.equal(list.writable, false);
  assert.ok(list.designs.every(entry => entry.projectName === (entry.workspaceId === "ws_first" ? "Lanzamiento" : "Marca")));
  const only = z.object({ designs: z.array(designSummarySchema) }).parse((await call("GET", "/designs?workspaceId=ws_second")).json);
  assert.deepEqual(only.designs.map(entry => entry.id), ["ideas"]);

  const one = await call("GET", `/designs/ws_first/${deck.id}`);
  assert.equal(z.object({ writable: z.boolean() }).parse(one.json).writable, true);
  assert.equal(designOf(one.json).title, "Plan de lanzamiento");

  assert.equal(code((await call("POST", "/designs", { body: { workspaceId: "ws_plain", kind: "slides", title: "X" } })).json), "project_not_found");
  assert.equal(code((await call("POST", "/designs", { body: { workspaceId: "ws_first", kind: "video", title: "X" } })).json), "invalid_design");
  assert.equal(code((await call("POST", "/designs", { body: { workspaceId: "ws_first", kind: "slides", title: "x".repeat(DESIGN_LIMITS.titleChars + 1) } })).json), "invalid_design");
  assert.equal(code((await call("GET", "/designs/ws_first/no-existe")).json), "design_not_found");
  assert.equal(code((await call("GET", "/designs/ws_first/..%2Fx")).json), "design_not_found");
});

test("patch title and design system, with updatedAt moving forward", async () => {
  const { call } = harness;
  const before = designOf((await call("GET", "/designs/ws_first/plan-de-lanzamiento")).json);
  const renamed = designOf((await call("PATCH", "/designs/ws_first/plan-de-lanzamiento", { body: { title: "Lanzamiento Q3" } })).json);
  assert.equal(renamed.title, "Lanzamiento Q3");
  assert.ok(renamed.updatedAt > before.updatedAt);
  assert.equal(renamed.id, before.id);
  assert.equal(designOf((await call("PATCH", "/designs/ws_first/plan-de-lanzamiento", { body: { systemId: "marca" } })).json).systemId, "marca");
  assert.equal(code((await call("PATCH", "/designs/ws_first/plan-de-lanzamiento", { body: { systemId: "plan-de-lanzamiento-2" } })).json), "design_system_invalid");
  assert.equal(code((await call("PATCH", "/designs/ws_first/marca", { body: { systemId: "marca" } })).json), "design_system_invalid");
  assert.equal(code((await call("PATCH", "/designs/ws_first/plan-de-lanzamiento", { body: { title: "" } })).json), "invalid_design");
  assert.equal(code((await call("PATCH", "/designs/ws_first/plan-de-lanzamiento", { body: { kind: "board" } })).json), "invalid_design");
});

test("files: read with type and strict policy, write with caps, schema checks and path safety", async () => {
  const { call, raw, first } = harness;
  const base = "/designs/ws_first/plan-de-lanzamiento";
  const html = await raw("GET", `${base}/files?path=pages/p-1.html`, { actor: "client" });
  assert.equal(html.status, 200);
  assert.equal(html.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(html.headers.get("content-security-policy"), DESIGN_CONTENT_SECURITY_POLICY);
  assert.equal(html.headers.get("x-content-type-options"), "nosniff");
  assert.match(await html.text(), /<!doctype html>/);

  const before = designOf((await call("GET", base)).json);
  const put = await call("PUT", `${base}/files?path=assets/logo.svg`, { raw: "<svg xmlns=\"http://www.w3.org/2000/svg\"/>" });
  assert.equal(put.status, 200);
  assert.ok(designOf(put.json).updatedAt > before.updatedAt);
  const svg = await raw("GET", `${base}/files?path=assets/logo.svg`);
  assert.equal(svg.headers.get("content-type"), "image/svg+xml");
  assert.equal(await svg.text(), "<svg xmlns=\"http://www.w3.org/2000/svg\"/>");

  for (const bad of ["../design.json", "/etc/passwd", "assets/.env", "pages\\p.html", ""]) {
    assert.equal(code((await call("PUT", `${base}/files?path=${encodeURIComponent(bad)}`, { raw: "x" })).json), "design_path_invalid", bad);
    assert.equal(code((await call("GET", `${base}/files?path=${encodeURIComponent(bad)}`)).json), "design_path_invalid", bad);
  }
  assert.equal(code((await call("PUT", `${base}/files?path=design.json`, { raw: "{}" })).json), "design_manifest_reserved");
  assert.equal(code((await call("GET", `${base}/files?path=assets/nada.png`)).json), "design_file_not_found");
  const tooBig = new Uint8Array(DESIGN_LIMITS.pageBytes + 1);
  assert.equal(code((await call("PUT", `${base}/files?path=pages/p-9.html`, { raw: tooBig })).json), "design_file_too_large");
  assert.equal(code((await call("PUT", "/designs/ws_second/ideas/files?path=board.json", { raw: "{\"format\":\"openwork.board\",\"version\":1,\"elements\":[{\"type\":\"video\"}]}" })).json), "design_board_invalid");
  assert.equal(code((await call("PUT", `${base}/files?path=tokens.json`, { raw: "no json" })).json), "design_tokens_invalid");

  // A link inside the design folder is never followed, for reading or writing.
  const outside = join(harness.root, "secret.txt");
  await writeFile(outside, "secreto");
  await symlink(outside, join(first, "proyecto", "diseno", "plan-de-lanzamiento", "assets", "link.txt"));
  assert.equal(code((await call("GET", `${base}/files?path=assets/link.txt`)).json), "design_path_invalid");
  assert.equal(code((await call("PUT", `${base}/files?path=assets/link.txt`, { raw: "x" })).json), "design_path_invalid");
  assert.equal(await readFile(outside, "utf8"), "secreto");
  await symlink(harness.root, join(first, "proyecto", "diseno", "plan-de-lanzamiento", "fuera"));
  assert.equal(code((await call("PUT", `${base}/files?path=fuera/x.txt`, { raw: "x" })).json), "design_path_invalid");
  assert.equal(existsSync(join(harness.root, "x.txt")), false);
});

test("a design folder that is a link, or a broken manifest, is refused and left out of the list", async () => {
  const { call, first, root } = harness;
  const elsewhere = join(root, "elsewhere");
  await mkdir(elsewhere, { recursive: true });
  await writeFile(join(elsewhere, "design.json"), JSON.stringify({ format: "openwork.design", version: 1, id: "enlace", kind: "slides", title: "X", createdAt: 1, updatedAt: 1, pages: [] }));
  await symlink(elsewhere, join(first, "proyecto", "diseno", "enlace"));
  assert.equal(code((await call("GET", "/designs/ws_first/enlace")).json), "design_unsafe_path");
  await mkdir(join(first, "proyecto", "diseno", "roto"));
  await writeFile(join(first, "proyecto", "diseno", "roto", "design.json"), "{ nope");
  assert.equal(code((await call("GET", "/designs/ws_first/roto")).json), "design_manifest_invalid");
  const ids = z.object({ designs: z.array(designSummarySchema) }).parse((await call("GET", "/designs?workspaceId=ws_first")).json).designs.map(entry => entry.id);
  assert.ok(!ids.includes("enlace") && !ids.includes("roto"));
});

test("pages: add after, reorder, delete with its file, keep at least one", async () => {
  const { call, first } = harness;
  const base = "/designs/ws_first/plan-de-lanzamiento";
  const added = designOf((await call("POST", `${base}/pages`, { body: { title: "Agenda" } })).json);
  assert.deepEqual(added.pages.map(entry => entry.id), ["p-1", "p-2"]);
  const inserted = designOf((await call("POST", `${base}/pages`, { body: { afterPageId: "p-1", html: "<!doctype html><p>Hola</p>" } })).json);
  assert.deepEqual(inserted.pages.map(entry => entry.id), ["p-1", "p-3", "p-2"]);
  assert.equal(await readFile(join(first, "proyecto", "diseno", "plan-de-lanzamiento", "pages", "p-3.html"), "utf8"), "<!doctype html><p>Hola</p>");
  assert.equal(inserted.pages[1]?.width, 1920);

  const ordered = designOf((await call("PUT", `${base}/pages/order`, { body: { pageIds: ["p-2", "p-1", "p-3"] } })).json);
  assert.deepEqual(ordered.pages.map(entry => entry.id), ["p-2", "p-1", "p-3"]);
  assert.equal(code((await call("PUT", `${base}/pages/order`, { body: { pageIds: ["p-2", "p-1"] } })).json), "design_pages_mismatch");

  const removed = designOf((await call("DELETE", `${base}/pages/p-3`)).json);
  assert.deepEqual(removed.pages.map(entry => entry.id), ["p-2", "p-1"]);
  assert.equal(existsSync(join(first, "proyecto", "diseno", "plan-de-lanzamiento", "pages", "p-3.html")), false);
  assert.equal(code((await call("DELETE", `${base}/pages/p-3`)).json), "design_page_not_found");
  await call("DELETE", `${base}/pages/p-2`);
  assert.equal(code((await call("DELETE", `${base}/pages/p-1`)).json), "design_last_page");
  // The next page never reuses a number still on disk.
  const again = designOf((await call("POST", `${base}/pages`, { body: {} })).json);
  assert.equal(again.pages.at(-1)?.id, "p-2");
});

test("thumbnail must be a PNG and is recorded in the manifest", async () => {
  const { call, raw } = harness;
  const base = "/designs/ws_first/plan-de-lanzamiento";
  assert.equal(code((await call("PUT", `${base}/thumbnail`, { raw: "not a png" })).json), "design_thumbnail_not_png");
  const saved = designOf((await call("PUT", `${base}/thumbnail`, { raw: PNG })).json);
  assert.equal(saved.thumbnail, "thumbnail.png");
  const image = await raw("GET", `${base}/files?path=thumbnail.png`);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.deepEqual(new Uint8Array(await image.arrayBuffer()), PNG);
  const summary = z.object({ designs: z.array(designSummarySchema) }).parse((await call("GET", "/designs?workspaceId=ws_first")).json).designs.find(entry => entry.id === "plan-de-lanzamiento");
  assert.equal(summary?.hasThumbnail, true);
});

test("HTML export is a zip of the folder with an index", async () => {
  const { raw, call } = harness;
  const response = await raw("GET", "/designs/ws_first/plan-de-lanzamiento/export?format=html", { actor: "client" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/zip");
  assert.match(response.headers.get("content-disposition") ?? "", /plan-de-lanzamiento\.zip/);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const names = Object.keys(files).sort();
  assert.ok(names.includes("plan-de-lanzamiento/design.json"));
  assert.ok(names.includes("plan-de-lanzamiento/pages/p-1.html"));
  assert.ok(names.includes("plan-de-lanzamiento/assets/logo.svg"));
  assert.ok(names.includes("plan-de-lanzamiento/index.html"));
  assert.ok(!names.some(name => name.includes("link.txt") || name.includes("/fuera/")));
  assert.match(new TextDecoder().decode(files["plan-de-lanzamiento/index.html"]), /href="pages\/p-1\.html"/);
  assert.equal(code((await call("GET", "/designs/ws_first/plan-de-lanzamiento/export?format=pdf")).json), "design_export_format");
});

test("chats bound to a design receive its guidance, with the design system when set", async () => {
  const { call, first } = harness;
  const base = "/designs/ws_first/plan-de-lanzamiento";
  assert.equal(await designAgentInstructions(first, "ses_free"), null);
  const bound = await call("POST", `${base}/chats`, { body: { sessionId: "ses_design" } });
  assert.deepEqual(z.object({ sessions: z.array(z.string()) }).parse(bound.json).sessions, ["ses_design"]);
  assert.equal(code((await call("POST", `${base}/chats`, { body: { sessionId: "../x" } })).json), "invalid_design_chat");
  const text = await designAgentInstructions(first, "ses_design");
  assert.ok(text);
  assert.match(text, /proyecto\/diseno\/plan-de-lanzamiento\//);
  assert.match(text, /1920×1080/);
  assert.match(text, /nada de red/);
  assert.match(text, /proyecto\/diseno\/marca\/tokens\.json/);
  configureDesignSystemContext(async (_root, systemId) => `Marca de prueba: ${systemId}.`);
  assert.match((await designAgentInstructions(first, "ses_design")) ?? "", /Marca de prueba: marca\./);
  const listed = await call("GET", `${base}/chats`, { actor: "client" });
  assert.deepEqual(z.object({ sessions: z.array(z.string()) }).parse(listed.json).sessions, ["ses_design"]);
});

test("delete removes the folder and its chat bindings", async () => {
  const { call, first } = harness;
  assert.equal((await call("DELETE", "/designs/ws_first/plan-de-lanzamiento-2")).status, 200);
  assert.equal(existsSync(join(first, "proyecto", "diseno", "plan-de-lanzamiento-2")), false);
  await call("DELETE", "/designs/ws_first/plan-de-lanzamiento");
  assert.equal(await designAgentInstructions(first, "ses_design"), null);
  assert.equal(code((await call("DELETE", "/designs/ws_first/plan-de-lanzamiento")).json), "design_not_found");
});

test("the flag off answers 404 design_studio_disabled", async () => {
  process.env.DEN_FEATURE_DESIGN_STUDIO = "false";
  try {
    assert.equal(code((await harness.call("GET", "/designs")).json), "design_studio_disabled");
    assert.equal(code((await harness.call("POST", "/designs", { body: { workspaceId: "ws_first", kind: "slides", title: "X" } })).json), "design_studio_disabled");
  } finally { process.env.DEN_FEATURE_DESIGN_STUDIO = "true"; }
});

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  collapseRoots, containingRoot, createFolderRateLimiter, folderListingSchema, folderNameProblem, visibleFolderNames,
} from "../src/folder-browser.js";

// The web app creates workspaces by browsing the server's folders (docs/features/web-folder-browser).
// Everything runs in a temp HOME so the person's own folders and config are never touched.
const dir = realpathSync(mkdtempSync(join(tmpdir(), "folder-browser-")));
const home = join(dir, "home");
const outside = join(dir, "outside");
const workspace = join(dir, "workspace");
const HOST = "browser-host";
const CLIENT = "browser-client";
const overrides: Record<string, string | undefined> = {
  HOME: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local", "share"),
  XDG_STATE_HOME: join(home, ".local", "state"), XDG_CACHE_HOME: join(home, ".cache"),
  OPENWORK_DATA_DIR: join(dir, "openwork"), OPENWORK_RUNTIME_DB: join(dir, "runtime.sqlite"),
  OPENCODE_DB: join(dir, "v1.db"), OPENWORK_ENGINE_AUTO_UPGRADE: "0",
  OPENWORK_ENV_STORE: join(dir, "env.json"), OPENWORK_FOLDER_BROWSER_ROOTS: undefined,
  DEN_FEATURE_WEB_FOLDER_BROWSER: undefined,
};
const previous = new Map(Object.keys(overrides).map(key => [key, process.env[key]]));
let server: { port: number; stop: () => void | Promise<void> };

before(async () => {
  for (const [key, value] of Object.entries(overrides)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  for (const folder of [join(home, "projects", ".git"), join(home, "app", ".opencode"), join(home, ".hidden"), join(outside, "secret"), workspace]) mkdirSync(folder, { recursive: true });
  writeFileSync(join(home, "notes.txt"), "not a folder");
  symlinkSync(outside, join(home, "escape"));
  symlinkSync(join(home, "projects"), join(home, "inner-link"));
  const { resolveServerConfig } = await import("../src/config.js");
  const { startServer } = await import("../src/server.js");
  const config = await resolveServerConfig({ configPath: join(dir, "server.json"), workspaces: [workspace], port: 0, token: CLIENT, hostToken: HOST, logRequests: false });
  config.approval = { mode: "auto", timeoutMs: 1000 };
  server = await startServer(config);
});
after(async () => {
  await server?.stop();
  for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  rmSync(dir, { recursive: true, force: true });
});

async function call(method: string, path: string, headers: Record<string, string> = {}, body?: unknown) {
  const response = await fetch(`http://127.0.0.1:${server.port}${path}`, { method, headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, json: text ? z.unknown().parse(JSON.parse(text)) : null };
}
const host = { "x-openwork-host-token": HOST };
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const browse = (path?: string, extra = "") => `/folders/browse${path === undefined ? "" : `?path=${encodeURIComponent(path)}`}${extra}`;
const errorCode = (json: unknown) => z.object({ code: z.string() }).parse(json).code;

test("owners list the home folder by default: folders only, no hidden folders, no symlinks", async () => {
  const response = await call("GET", browse(), host);
  assert.equal(response.status, 200);
  const listing = folderListingSchema.parse(response.json);
  assert.equal(listing.path, home);
  assert.equal(listing.root, home);
  assert.equal(listing.parent, null);
  assert.deepEqual(listing.entries.map(entry => entry.name), ["app", "projects"]);
  assert.deepEqual(listing.entries.map(entry => [entry.isGitRepo, entry.hasOpencode]), [[false, true], [true, false]]);
  // The workspace outside home is reachable because it is an authorized root.
  assert.deepEqual(listing.roots, [{ name: "~", path: home }, { name: "workspace", path: workspace }]);
  assert.equal((await call("GET", browse(workspace), host)).status, 200);

  const hidden = folderListingSchema.parse((await call("GET", browse(home, "&hidden=1"), host)).json);
  assert.deepEqual(hidden.entries.map(entry => entry.name), [".hidden", "app", "projects"]);
  const child = folderListingSchema.parse((await call("GET", browse(join(home, "projects")), host)).json);
  assert.equal(child.parent, home);
  // A link that stays inside the root resolves to its real folder.
  assert.equal(folderListingSchema.parse((await call("GET", browse(join(home, "inner-link")), host)).json).path, join(home, "projects"));
});

test("paths outside the roots, traversal and symlink escapes are refused", async () => {
  for (const path of [outside, join(home, "projects", "..", "..", "outside"), join(home, "escape"), join(home, "escape", "secret"), dir, "/"]) {
    const response = await call("GET", browse(path), host);
    assert.equal(response.status, 403, path);
    assert.equal(errorCode(response.json), "folder_outside_roots");
  }
  assert.equal(errorCode((await call("GET", browse("projects"), host)).json), "folder_path_invalid");
  assert.equal(errorCode((await call("GET", browse(join(home, "missing")), host)).json), "folder_not_found");
  assert.equal(errorCode((await call("GET", browse(join(home, "notes.txt")), host)).json), "folder_not_directory");
});

test("owners create a validated subfolder inside the roots only", async () => {
  const created = await call("POST", "/folders/browse", host, { parent: home, name: "Nuevo proyecto" });
  assert.equal(created.status, 201);
  assert.deepEqual(created.json, { path: join(home, "Nuevo proyecto") });
  assert.equal(existsSync(join(home, "Nuevo proyecto")), true);
  assert.equal(errorCode((await call("POST", "/folders/browse", host, { parent: home, name: "Nuevo proyecto" })).json), "folder_exists");
  for (const name of ["../escaped", "..", "a/b", ""]) {
    assert.equal(errorCode((await call("POST", "/folders/browse", host, { parent: home, name })).json), "folder_name_invalid", name);
  }
  const escape = await call("POST", "/folders/browse", host, { parent: join(home, "escape"), name: "planted" });
  assert.equal(escape.status, 403);
  assert.equal(existsSync(join(outside, "planted")), false);
  assert.equal((await call("POST", "/folders/browse", host, { parent: outside, name: "planted" })).status, 403);
  assert.equal(errorCode((await call("POST", "/folders/browse", host, { name: "x" })).json), "invalid_payload");
});

test("collaborators get 401; the host token and paired devices are owners", async () => {
  assert.equal((await call("GET", browse(), bearer(CLIENT))).status, 401);
  assert.equal((await call("GET", browse())).status, 401);
  assert.equal((await call("POST", "/folders/browse", bearer(CLIENT), { parent: home, name: "nope" })).status, 401);
  assert.equal(existsSync(join(home, "nope")), false);

  const { code } = z.object({ code: z.string() }).parse((await call("POST", "/pairing/codes", host)).json);
  const device = z.object({ token: z.string() }).parse((await call("POST", "/pairing/redeem", {}, { code, deviceName: "Celular" })).json);
  assert.equal((await call("GET", browse(), bearer(device.token))).status, 200);
  assert.equal((await call("POST", "/folders/browse", bearer(device.token), { parent: home, name: "Desde el celular" })).status, 201);
});

test("turning the flag off hides both routes", async t => {
  process.env.DEN_FEATURE_WEB_FOLDER_BROWSER = "false";
  t.after(() => { delete process.env.DEN_FEATURE_WEB_FOLDER_BROWSER; });
  const response = await call("GET", browse(), host);
  assert.equal(response.status, 404);
  assert.equal(errorCode(response.json), "web_folder_browser_disabled");
  assert.equal((await call("POST", "/folders/browse", host, { parent: home, name: "off" })).status, 404);
});

test("OPENWORK_FOLDER_BROWSER_ROOTS replaces the default roots", async t => {
  process.env.OPENWORK_FOLDER_BROWSER_ROOTS = join(home, "projects");
  t.after(() => { delete process.env.OPENWORK_FOLDER_BROWSER_ROOTS; });
  const listing = folderListingSchema.parse((await call("GET", browse(), host)).json);
  assert.equal(listing.path, join(home, "projects"));
  assert.equal((await call("GET", browse(home), host)).status, 403);
});

// contracts/folder-browser/v1/vectors.json (docs/rust-readiness.md, R5).
const contractSchema = z.object({
  contract: z.literal("openwork.folder-browser"),
  version: z.literal(1),
  folderNames: z.array(z.object({ name: z.string(), problem: z.string().nullable() })).min(1),
  containment: z.array(z.object({ candidate: z.string(), roots: z.array(z.string()), root: z.string().nullable() })).min(1),
  collapse: z.array(z.object({ roots: z.array(z.string()), expect: z.array(z.string()) })).min(1),
  visible: z.array(z.object({ names: z.array(z.string()), showHidden: z.boolean(), max: z.number().int(), expect: z.array(z.string()), truncated: z.boolean() })).min(1),
});

test("contract vectors: names, containment, root collapsing and visible entries", () => {
  const contract = contractSchema.parse(JSON.parse(readFileSync(new URL("../../../contracts/folder-browser/v1/vectors.json", import.meta.url), "utf8")));
  for (const vector of contract.folderNames) assert.equal(folderNameProblem(vector.name), vector.problem, JSON.stringify(vector.name));
  for (const vector of contract.containment) assert.equal(containingRoot(vector.candidate, vector.roots, "/"), vector.root, vector.candidate);
  for (const vector of contract.collapse) assert.deepEqual(collapseRoots(vector.roots, "/"), vector.expect);
  for (const vector of contract.visible) {
    const result = visibleFolderNames(vector.names, { showHidden: vector.showHidden, max: vector.max });
    assert.deepEqual(result, { names: vector.expect, truncated: vector.truncated });
  }
});

test("folder creation is rate limited per window", () => {
  let now = 0;
  const limiter = createFolderRateLimiter({ limit: 2, windowMs: 1000, now: () => now });
  assert.equal(limiter.take(), true);
  assert.equal(limiter.take(), true);
  assert.equal(limiter.take(), false);
  now = 1000;
  assert.equal(limiter.take(), true);
});

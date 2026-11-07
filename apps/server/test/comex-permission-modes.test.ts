import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { builtinPermissionProfiles, permissionProfileInputSchema, profilePermissionRules } from "@openwork/types/permission-modes";
import { emptyPermissionModes, nextPermissionRules, permissionHash, readNativePermissions, writeNativePermissions } from "../src/comex/permission-modes.js";

test("three initial modes have distinct native behavior, unknown tools ask and sensitive reads keep safeguards", () => {
  assert.deepEqual(builtinPermissionProfiles.map(p => p.name), ["Solicitar aprobación", "Aprobar automáticamente", "Acceso completo"]);
  const approve = profilePermissionRules(builtinPermissionProfiles[0]!); const auto = profilePermissionRules(builtinPermissionProfiles[1]!);
  assert.equal(approve.find(r => r.action === "edit")?.effect, "ask"); assert.equal(auto.find(r => r.action === "edit")?.effect, "allow");
  assert.equal(auto.find(r => r.action === "shell")?.effect, "ask"); assert.equal(auto.find(r => r.resource === "*.env")?.effect, "ask");
  assert.deepEqual(profilePermissionRules(builtinPermissionProfiles[2]!), [{ action: "*", resource: "*", effect: "allow" }]);
  const investigate = { ...builtinPermissionProfiles[0]!, builtin: false, id: "custom-investigate", settings: { ...builtinPermissionProfiles[0]!.settings, read: "deny" as const, edit: "deny" as const } };
  assert.equal(profilePermissionRules(investigate).find(r => r.resource === "*.env")?.effect, "deny");
  assert.equal(profilePermissionRules(investigate)[0]?.effect, "ask");
  assert.equal(permissionProfileInputSchema.safeParse({ name: "", description: "", settings: investigate.settings }).success, false);
});

test("applying modes preserves original restrictions and refuses manual permission changes", () => {
  const baseline = [{ action: "*", resource: "*", effect: "allow" as const }, { action: "shell", resource: "rm *", effect: "deny" as const }];
  const first = nextPermissionRules(emptyPermissionModes(), baseline, builtinPermissionProfiles[0]!);
  assert.deepEqual(first.rules.at(-1), baseline[1]);
  const s = { ...emptyPermissionModes(), baseline, activeId: "approve", appliedHash: permissionHash(first.rules) };
  const full = nextPermissionRules(s, first.rules, builtinPermissionProfiles[2]!);
  assert.deepEqual(full.rules, baseline);
  assert.throws(() => nextPermissionRules(s, [...first.rules, { action: "edit", resource: "*", effect: "deny" }], builtinPermissionProfiles[2]!), /cambiaron/);
});

test("JSONC edits preserve unrelated configuration and detect a concurrent file edit", async t => {
  const root = await mkdtemp(join(tmpdir(), "permission-modes-")); t.after(() => rm(root, { force: true, recursive: true }));
  await mkdir(join(root, ".opencode")); const path = join(root, ".opencode/opencode.json");
  await writeFile(path, '{\n // keep this comment\n "model": "fixture/model", "permissions": []\n}\n');
  const current = await readNativePermissions(root); const rules = profilePermissionRules(builtinPermissionProfiles[0]!);
  await writeNativePermissions(current, rules);
  const raw = await readFile(path, "utf8"); assert.ok(raw.includes("// keep this comment")); assert.ok(raw.includes('"fixture/model"'));
  assert.deepEqual((await readNativePermissions(root)).rules, rules);
  await assert.rejects(writeNativePermissions(current, []), /cambió/);
});

test("unsafe paths, duplicate config keys and invalid rules cannot be replaced", async t => {
  const root = await mkdtemp(join(tmpdir(), "permission-modes-")); const outside = await mkdtemp(join(tmpdir(), "permission-outside-"));
  t.after(async () => { await rm(root, { force: true, recursive: true }); await rm(outside, { force: true, recursive: true }); });
  await symlink(outside, join(root, ".opencode")); await assert.rejects(readNativePermissions(root), /segura/);
  await rm(join(root, ".opencode")); await mkdir(join(root, ".opencode"));
  const path = join(root, ".opencode/opencode.json"); await writeFile(path, '{"permissions": [], "permissions": []}');
  await assert.rejects(readNativePermissions(root), /duplicadas/);
  await writeFile(path, '{"permissions": "allow"}'); await assert.rejects(readNativePermissions(root), /no compatible/);
});

test("profile routes enforce authentication, revisions, activation confirmation, idle guard and immutable defaults", async t => {
  const { registerPermissionModeRoutes } = await import("../src/comex/permission-mode-routes.js");
  const { matchRoute } = await import("../src/routes/registry.js");
  const { ApiError } = await import("../src/errors.js");
  const root = await mkdtemp(join(tmpdir(), "mode-routes-")); const previous = process.env.DEN_FEATURE_COMEX_WORKSPACE;
  process.env.DEN_FEATURE_COMEX_WORKSPACE = "true";
  t.after(async () => { await rm(root, { force: true, recursive: true }); if (previous === undefined) delete process.env.DEN_FEATURE_COMEX_WORKSPACE; else process.env.DEN_FEATURE_COMEX_WORKSPACE = previous; });
  const config: import("../src/types.js").ServerConfig = { host: "127.0.0.1", port: 0, token: "client", hostToken: "host", configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 30000 }, corsOrigins: [], workspaces: [], authorizedRoots: [root], readOnly: false, startedAt: 0, tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false };
  const routes: import("../src/routes/registry.js").Route[] = []; let busy = false; let nativeVisible = true; let approvals = 0;
  registerPermissionModeRoutes({ routes, config, jsonResponse: value => Response.json(value), readJsonBody: request => request.json(), resolveWorkspace: async (_, id) => ({ id, name: "Fixture", path: root, workspaceType: "local" }), supported: () => true, native: async () => nativeVisible, idle: async () => { if (busy) throw new ApiError(409, "busy", "busy"); }, fence: async (_, run) => run(), authorize: async (_, __, apply) => { if (config.readOnly) throw new ApiError(403, "read_only", "read only"); if (apply) approvals++; } });
  const call = async (method: string, suffix = "", body?: unknown) => {
    const path = `/workspace/fixture/permission-modes${suffix}`; const route = matchRoute(routes, method, path); assert.ok(route); assert.equal(route.auth, "client");
    // Dispatcher owns other context fields; handlers use only params and request.
    return route.handler({ params: route.params, request: new Request(`http://localhost${path}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) }) } as import("../src/routes/registry.js").RequestContext);
  };
  const initial = await (await call("GET")).json(); assert.equal(initial.profiles.length, 3); assert.equal(initial.activeId, null); assert.ok(initial.profiles.every((p: { enabled: boolean }) => p.enabled));
  await assert.rejects(readFile(join(root, ".opencode/opencode.json"))); // Listing did not seed or apply any permissions.
  const baseline = [{ action: "*", resource: "*", effect: "allow" as const }, { action: "shell", resource: "rm *", effect: "deny" as const }];
  await mkdir(join(root, ".opencode")); await writeFile(join(root, ".opencode/opencode.json"), JSON.stringify({ permissions: baseline, model: "fixture/model" }));
  const profile = { name: "Investigar", description: "Sources only", settings: { read: "allow", edit: "deny", shell: "ask", web: "allow", external: "ask" } };
  config.readOnly = true; await assert.rejects(call("POST", "", { revision: 0, profile }), e => e instanceof ApiError && e.status === 403); config.readOnly = false;
  const saved = await (await call("POST", "", { revision: 0, profile })).json(); const id = saved.profiles.at(-1).id;
  assert.equal(saved.revision, 1); assert.equal(saved.activeId, null);
  await assert.rejects(call("POST", "", { revision: 0, profile }), /cambiaron/);
  await assert.rejects(call("POST", "", { revision: 1, profile: { ...profile, builtin: true } }), e => e instanceof ApiError && e.status === 422);
  await assert.rejects(call("PUT", "/active", { revision: 1, id }), e => e instanceof ApiError && e.status === 422);
  busy = true; await assert.rejects(call("PUT", "/active", { revision: 1, id, confirmed: true }), /busy/); busy = false;
  nativeVisible = false; await assert.rejects(call("PUT", "/active", { revision: 1, id, confirmed: true }), /restauraron/);
  assert.deepEqual((await readNativePermissions(root)).rules, baseline);
  nativeVisible = true; const applied = await (await call("PUT", "/active", { revision: 1, id, confirmed: true })).json();
  assert.equal(applied.activeId, id); assert.equal(applied.pending, false); assert.equal(approvals, 2);
  assert.equal((await readNativePermissions(root)).rules.find(rule => rule.action === "edit")?.effect, "deny");
  nativeVisible = true; assert.equal((await (await call("GET")).json()).pending, false);
  await assert.rejects(call("DELETE", `/${id}`, { revision: 2 }), /no se pueden eliminar/);
  await assert.rejects(call("DELETE", "/approve", { revision: 2 }), /no se pueden eliminar/);
  await assert.rejects(call("PUT", "/active", { revision: 2, id: null }), e => e instanceof ApiError && e.status === 422);
  busy = true; await assert.rejects(call("PUT", "/active", { revision: 2, id: null, confirmed: true }), /busy/); busy = false;
  nativeVisible = false; await assert.rejects(call("PUT", "/active", { revision: 2, id: null, confirmed: true }), /restauraron/);
  assert.equal((await readNativePermissions(root)).rules.find(rule => rule.action === "edit")?.effect, "deny");
  nativeVisible = true;
  const appliedConfig = await readNativePermissions(root);
  await writeNativePermissions(appliedConfig, [...appliedConfig.rules, { action: "webfetch", resource: "*", effect: "deny" }]);
  await assert.rejects(call("PUT", "/active", { revision: 2, id: null, confirmed: true }), /fuera del selector/);
  await writeNativePermissions(await readNativePermissions(root), appliedConfig.rules);
  const deactivated = await (await call("PUT", "/active", { revision: 2, id: null, confirmed: true })).json();
  assert.equal(deactivated.activeId, null); assert.equal(deactivated.pending, false); assert.equal(deactivated.revision, 3);
  assert.equal(deactivated.profiles.length, 4); assert.deepEqual((await readNativePermissions(root)).rules, baseline);
  const edited = await (await call("POST", "", { revision: 3, id, profile: { ...profile, description: "Edited after deactivation" } })).json();
  assert.equal(edited.profiles.at(-1).description, "Edited after deactivation");
  const again = await (await call("PUT", "/active", { revision: 4, id: null, confirmed: true })).json(); assert.equal(again.revision, 4);
  const hidden = await (await call("POST", "", { revision: 4, id, profile: { ...profile, enabled: false } })).json();
  assert.equal(hidden.profiles.at(-1).enabled, false); assert.equal(hidden.profiles.length, 4);
  await assert.rejects(call("PUT", "/active", { revision: 5, id, confirmed: true }), /desactivado/);
  assert.deepEqual((await readNativePermissions(root)).rules, baseline);
  const defaultInput = { name: builtinPermissionProfiles[0]!.name, description: builtinPermissionProfiles[0]!.description, settings: builtinPermissionProfiles[0]!.settings, enabled: false };
  await assert.rejects(call("POST", "", { revision: 5, id: "approve", profile: { ...defaultInput, settings: profile.settings } }), /duplic/);
  const hiddenDefault = await (await call("POST", "", { revision: 5, id: "approve", profile: defaultInput })).json();
  assert.equal(hiddenDefault.profiles[0].enabled, false);
  const shownDefault = await (await call("POST", "", { revision: 6, id: "approve", profile: { ...defaultInput, enabled: true } })).json();
  assert.equal(shownDefault.profiles[0].enabled, true);
  const shown = await (await call("POST", "", { revision: 7, id, profile: { ...profile, enabled: true } })).json();
  assert.equal(shown.profiles.at(-1).enabled, true); assert.equal(shown.revision, 8);
  const activeAgain = await (await call("PUT", "/active", { revision: 8, id, confirmed: true })).json();
  const activeRules = (await readNativePermissions(root)).rules;
  await assert.rejects(call("POST", "", { revision: 9, id, profile: { ...profile, name: "Changed while active" } }), /modo activo/);
  const hiddenActive = await (await call("POST", "", { revision: 9, id, profile: { ...profile, enabled: false } })).json();
  assert.equal(hiddenActive.activeId, activeAgain.activeId); assert.equal(hiddenActive.profiles.at(-1).enabled, false);
  assert.deepEqual((await readNativePermissions(root)).rules, activeRules);
  process.env.DEN_FEATURE_COMEX_WORKSPACE = "false"; await assert.rejects(call("GET"), e => e instanceof ApiError && e.status === 404);
});

test("native verification rejects agent overrides that weaken a mode", async () => {
  const { agentsRespectMode } = await import("../src/comex/permission-modes.js");
  const rules = profilePermissionRules(builtinPermissionProfiles[0]!);
  assert.equal(agentsRespectMode(rules, { data: [{ permissions: rules }] }), true);
  assert.equal(agentsRespectMode(rules, { data: [{ permissions: [...rules, { action: "shell", resource: "*", effect: "allow" }] }] }), false);
  assert.equal(agentsRespectMode(rules, { data: [{ permissions: [...rules, { action: "browser", resource: "*", effect: "deny" }] }] }), true);
  assert.equal(agentsRespectMode(rules, { data: [{ permissions: [...rules, { action: "read", resource: "*", effect: "allow" }] }] }), false);
  assert.equal(agentsRespectMode(rules, { data: [] }), false);
});

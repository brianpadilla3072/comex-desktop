import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { strToU8, zipSync, type Zippable } from "fflate";
import { z } from "zod";
import { ApiError } from "../src/errors.js";
import { workspaceIdForPath } from "../src/workspaces.js";
import { specialistDirectory, specialistStore } from "../src/specialists/store.js";
import { LIMITS } from "../src/specialists/portability/bundle.js";
import { unsafeEntryReason } from "../src/specialists/portability/archive.js";
import { parseManifest } from "../src/specialists/portability/index.js";
import { prepareSpecialistWorkspace } from "../src/specialists/packs.js";
import { listTasks } from "../src/specialists/tasks.js";
import { registerSpecialistRoutes } from "../src/specialists/routes.js";
import { matchRoute, type RequestContext, type Route } from "../src/routes/registry.js";
import type { ServerConfig } from "../src/types.js";

// Runs contracts/specialist-app-bundle/v1/vectors.json (docs/rust-readiness.md, R5). The same file
// is the acceptance test for any other implementation of POST /specialist-applications/import.
const vectorSchema = z.object({
  name: z.string(),
  bundle: z.unknown(),
  expect: z.object({
    status: z.number().int(),
    code: z.string().optional(),
    projects: z.number().int().optional(),
    files: z.record(z.string(), z.string()).optional(),
    pausedTasks: z.array(z.string()).optional(),
    skippedSections: z.array(z.string()).optional(),
  }),
});
const contractSchema = z.object({ contract: z.literal("openwork.specialist-application"), version: z.literal(1), vectors: z.array(vectorSchema).min(1) });
const contractFile = new URL("../../../contracts/specialist-app-bundle/v1/vectors.json", import.meta.url);
const FLAGS = ["DEN_FEATURE_SPECIALIST_APPLICATIONS", "DEN_FEATURE_SPECIALIST_LIBRARY", "DEN_FEATURE_SCHEDULED_TASKS", "DEN_FEATURE_SPECIALIST_APP_PORTABILITY"];

test("the specialist application bundle contract v1 holds", async () => {
  const contract = contractSchema.parse(JSON.parse(await readFile(contractFile, "utf8")));
  const before = new Map(FLAGS.map(name => [name, process.env[name]]));
  for (const name of FLAGS) process.env[name] = "true";
  try {
    for (const vector of contract.vectors) {
      const root = await mkdtemp(join(tmpdir(), "specialist-contract-"));
      try {
        const config = { configPath: join(root, "server.json"), port: 4711, token: "t", workspaces: [] as Array<{ id: string; path: string; name: string; workspaceType: "local" }> };
        const routes: Route[] = [];
        registerSpecialistRoutes({
          routes, config: config as unknown as ServerConfig,
          readJsonBody: async (request: Request) => z.record(z.string(), z.unknown()).parse(await request.json()),
          jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
          ensureWritable: () => {},
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
        });
        const url = new URL("http://127.0.0.1:1/specialist-applications/import");
        const match = matchRoute(routes, "POST", url.pathname);
        assert.ok(match);
        const request = new Request(url, { method: "POST", body: JSON.stringify({ bundle: vector.bundle, userName: "Persona" }) });
        let status: number; let body: Record<string, unknown>;
        try {
          const response = await match.handler({ request, url, params: match.params, config, actor: { type: "host", scope: "owner" } } as unknown as RequestContext);
          status = response.status; body = z.record(z.string(), z.unknown()).parse(await response.json());
        } catch (error) {
          if (!(error instanceof ApiError)) throw error;
          status = error.status; body = { code: error.code };
        }
        assert.equal(status, vector.expect.status, `${vector.name}: ${JSON.stringify(body)}`);
        if (vector.expect.code) assert.equal(body.code, vector.expect.code, vector.name);
        if (vector.expect.status >= 400) assert.equal(config.workspaces.length, 0, `${vector.name}: nothing is created on rejection`);
        if (vector.expect.projects !== undefined) assert.equal(config.workspaces.length, vector.expect.projects, vector.name);
        if (vector.expect.skippedSections) assert.deepEqual(body.skippedSections, vector.expect.skippedSections, vector.name);
        for (const [path, content] of Object.entries(vector.expect.files ?? {})) {
          assert.equal(await readFile(join(config.workspaces[0]!.path, "proyecto", path), "utf8"), content, `${vector.name}: ${path}`);
        }
        if (vector.expect.pausedTasks) {
          const application = z.object({ id: z.string() }).parse(body.application);
          const tasks = await listTasks(config, application.id);
          assert.deepEqual(tasks.filter(task => !task.enabled).map(task => task.name), vector.expect.pausedTasks, vector.name);
        }
      } finally { await rm(root, { recursive: true, force: true }); }
    }
  } finally {
    for (const [name, value] of before) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});

// Runs contracts/specialist-app-bundle/v2/vectors.json: the `.owapp` archive (feature:
// specialistAppZipBundle). Archives are built here with an independent ZIP writer (fflate).
const entrySchema = z.object({ path: z.string(), utf8: z.string().optional(), base64: z.string().optional(), unixMode: z.number().int().optional() });
const contractV2Schema = z.object({
  contract: z.literal("openwork.specialist-application"),
  version: z.literal(2),
  limits: z.object({ files: z.number(), bytes: z.number(), fileBytes: z.number(), uploadBytes: z.number(), manifestBytes: z.number(), compressionRatio: z.number(), ratioFloorBytes: z.number() }),
  paths: z.array(z.object({ path: z.string(), reason: z.string().nullable() })).min(1),
  manifests: z.array(z.object({ name: z.string(), valid: z.boolean(), manifest: z.unknown() })).min(1),
  archives: z.array(z.object({
    name: z.string(),
    manifest: z.record(z.string(), z.unknown()),
    entries: z.array(entrySchema),
    expect: z.object({
      status: z.number().int(),
      code: z.string().optional(),
      projects: z.number().int().optional(),
      files: z.record(z.string(), z.string()).optional(),
      binaryFiles: z.record(z.string(), z.string()).optional(),
      warningsMention: z.array(z.string()).optional(),
      skippedSections: z.array(z.string()).optional(),
    }),
  })).min(1),
});
const contractV2File = new URL("../../../contracts/specialist-app-bundle/v2/vectors.json", import.meta.url);

test("the specialist application bundle contract v2 (.owapp) holds", async () => {
  const contract = contractV2Schema.parse(JSON.parse(await readFile(contractV2File, "utf8")));
  assert.deepEqual(contract.limits, { ...LIMITS.archive }, "the published limits are the enforced ones");
  for (const vector of contract.paths) assert.equal(unsafeEntryReason(vector.path), vector.reason, vector.path);
  for (const vector of contract.manifests) {
    let valid = true;
    try { parseManifest(vector.manifest); } catch (error) { if (!(error instanceof ApiError)) throw error; valid = false; }
    assert.equal(valid, vector.valid, vector.name);
  }
  const names = [...FLAGS, "DEN_FEATURE_SPECIALIST_APP_ZIP_BUNDLE"];
  const before = new Map(names.map(name => [name, process.env[name]]));
  for (const name of names) process.env[name] = "true";
  try {
    for (const vector of contract.archives) {
      const root = await mkdtemp(join(tmpdir(), "specialist-contract-v2-"));
      try {
        const config = { configPath: join(root, "server.json"), port: 4711, token: "t", workspaces: [] as Array<{ id: string; path: string; name: string; workspaceType: "local" }> };
        const routes: Route[] = [];
        registerSpecialistRoutes({
          routes, config: config as unknown as ServerConfig,
          readJsonBody: async (request: Request) => z.record(z.string(), z.unknown()).parse(await request.json()),
          jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
          ensureWritable: () => {},
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
        });
        const files: Zippable = {};
        const index = [];
        for (const entry of vector.entries) {
          const data = entry.base64 !== undefined ? new Uint8Array(Buffer.from(entry.base64, "base64")) : strToU8(entry.utf8 ?? "");
          files[entry.path] = entry.unixMode === undefined ? data : [data, { os: 3, attrs: entry.unixMode * 0x10000 }];
          index.push({ path: entry.path, size: data.byteLength, sha256: createHash("sha256").update(data).digest("hex") });
        }
        const manifest = "files" in vector.manifest ? vector.manifest : { ...vector.manifest, files: index };
        const bytes = zipSync({ "manifest.json": strToU8(JSON.stringify(manifest)), ...files });
        const url = new URL("http://127.0.0.1:1/specialist-applications/import?userName=Persona");
        const match = matchRoute(routes, "POST", url.pathname);
        assert.ok(match);
        const request = new Request(url, { method: "POST", body: bytes, headers: { "content-type": "application/zip" } });
        let status: number; let body: Record<string, unknown>;
        try {
          const response = await match.handler({ request, url, params: match.params, config, actor: { type: "host", scope: "owner" } } as unknown as RequestContext);
          status = response.status; body = z.record(z.string(), z.unknown()).parse(await response.json());
        } catch (error) {
          if (!(error instanceof ApiError)) throw error;
          status = error.status; body = { code: error.code };
        }
        assert.equal(status, vector.expect.status, `${vector.name}: ${JSON.stringify(body)}`);
        if (vector.expect.code) assert.equal(body.code, vector.expect.code, vector.name);
        if (vector.expect.status >= 400) {
          assert.equal(config.workspaces.length, 0, `${vector.name}: nothing is created on rejection`);
          assert.deepEqual((await readdir(specialistDirectory(config)).catch(() => [])).filter(name => name.startsWith("app_")), [], vector.name);
        }
        if (vector.expect.projects !== undefined) assert.equal(config.workspaces.length, vector.expect.projects, vector.name);
        if (vector.expect.skippedSections) assert.deepEqual(body.skippedSections, vector.expect.skippedSections, vector.name);
        const project = config.workspaces[0]?.path ?? "";
        for (const [path, content] of Object.entries(vector.expect.files ?? {})) {
          assert.equal(await readFile(join(project, path), "utf8"), content, `${vector.name}: ${path}`);
        }
        for (const [path, content] of Object.entries(vector.expect.binaryFiles ?? {})) {
          assert.equal((await readFile(join(project, path))).toString("base64"), content, `${vector.name}: ${path}`);
        }
        // Files that did not travel are named in the import result.
        const warnings = z.array(z.string()).default([]).parse(body.warnings);
        for (const mention of vector.expect.warningsMention ?? []) {
          assert.ok(warnings.some(warning => warning.includes(mention)), `${vector.name}: a warning mentions ${mention}`);
        }
      } finally { await rm(root, { recursive: true, force: true }); }
    }
  } finally {
    for (const [name, value] of before) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { z } from "zod";
import { ApiError } from "../src/errors.js";
import { workspaceIdForPath } from "../src/workspaces.js";
import { specialistDirectory, specialistStore } from "../src/specialists/store.js";
import { prepareSpecialistWorkspace } from "../src/specialists/packs.js";
import { registerSpecialistRoutes } from "../src/specialists/routes.js";
import { matchRoute, type RequestContext, type Route } from "../src/routes/registry.js";
import type { ServerConfig } from "../src/types.js";

// specialistAppZipBundle: the .owapp archive (docs/features/specialist-app-zip-bundle).
const FLAGS = ["DEN_FEATURE_SPECIALIST_APPLICATIONS", "DEN_FEATURE_SPECIALIST_LIBRARY", "DEN_FEATURE_SCHEDULED_TASKS", "DEN_FEATURE_SPECIALIST_APP_PORTABILITY", "DEN_FEATURE_SPECIALIST_APP_ZIP_BUNDLE"];

type Workspace = { id: string; path: string; name: string; workspaceType: "local" };
const jsonObject = z.record(z.string(), z.unknown());

async function machine(label: string) {
  const root = await mkdtemp(join(tmpdir(), `owapp-${label}-`));
  const config = { configPath: join(root, "server.json"), port: 4711, token: "t", workspaces: [] as Workspace[] };
  const routes: Route[] = [];
  registerSpecialistRoutes({
    routes, config: config as unknown as ServerConfig,
    readJsonBody: async (request: Request) => jsonObject.parse(await request.json()),
    jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
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
  const send = async (method: string, path: string, init: { body?: BodyInit; headers?: Record<string, string> } = {}) => {
    const url = new URL(`http://127.0.0.1:1${path}`);
    const match = matchRoute(routes, method, url.pathname);
    assert.ok(match, `${method} ${path}`);
    const request = new Request(url, { method, body: init.body, headers: init.headers });
    try {
      return await match.handler({ request, url, params: match.params, config, actor: { type: "host", scope: "owner" } } as unknown as RequestContext);
    } catch (error) {
      if (error instanceof ApiError) return new Response(JSON.stringify({ code: error.code, message: error.message }), { status: error.status });
      throw error;
    }
  };
  const json = async (method: string, path: string, body?: unknown) => {
    const response = await send(method, path, body === undefined ? {} : { body: JSON.stringify(body) });
    return { status: response.status, json: jsonObject.parse(await response.json()) };
  };
  const importArchive = async (bytes: Uint8Array, userName = "Persona") => {
    const response = await send("POST", `/specialist-applications/import?userName=${encodeURIComponent(userName)}`, { body: bytes, headers: { "content-type": "application/zip" } });
    return { status: response.status, json: jsonObject.parse(await response.json()) };
  };
  return { root, config, send, json, importArchive, store: () => specialistStore(config as unknown as ServerConfig) };
}

async function withFlags(run: () => Promise<void>, overrides: Record<string, string> = {}) {
  const before = new Map(FLAGS.map(name => [name, process.env[name]]));
  for (const name of FLAGS) process.env[name] = overrides[name] ?? "true";
  try { await run(); }
  finally { for (const [name, value] of before) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
}

async function sourcePack(root: string) {
  const pack = join(root, "pack-source");
  await mkdir(join(pack, "agents"), { recursive: true });
  await mkdir(join(pack, "skills", "tono"), { recursive: true });
  await writeFile(join(pack, "agents", "revisor.md"), "---\ndescription: Revisor de prueba.\nmode: subagent\n---\nRevisa evidencia.\n");
  await writeFile(join(pack, "skills", "tono", "SKILL.md"), "---\nname: tono\ndescription: Una skill de prueba.\n---\nAyuda con claridad.\n");
  return pack;
}

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

/** Nothing of a rejected import is left: no application, no workspace, no folder, no scratch. */
async function assertNothingLeft(m: Awaited<ReturnType<typeof machine>>) {
  assert.equal((await m.store()).list().applications.length, 0);
  assert.equal(m.config.workspaces.length, 0);
  const entries = await readdir(specialistDirectory(m.config)).catch(() => []);
  assert.deepEqual(entries.filter(name => name.startsWith("app_")), []);
  assert.deepEqual(await readdir(join(specialistDirectory(m.config), ".portability")).catch(() => []), []);
}

/** A valid archive in the v2 layout, built with an independent ZIP writer. */
function archive(files: Record<string, Uint8Array>, options: { manifest?: (index: Array<{ path: string; size: number; sha256: string }>) => unknown; extra?: Zippable } = {}) {
  const index = Object.entries(files).map(([path, data]) => ({ path, size: data.byteLength, sha256: sha256(data) }));
  const manifest = options.manifest?.(index) ?? {
    format: "openwork.specialist-application", version: 2,
    application: { name: "Zip", specialty: "Pruebas", personality: "", template: "custom" },
    sections: { projects: { projects: [{ name: "P", dataDir: "proyecto" }] }, workFiles: { skipped: [] } },
    files: index,
  };
  return zipSync({ "manifest.json": strToU8(JSON.stringify(manifest)), ...files, ...options.extra });
}

/** Overwrite the uncompressed size of the first central-directory entry named `name`. */
function patchDeclaredSize(zip: Uint8Array, name: string, size: number) {
  const bytes = Buffer.from(zip);
  for (let offset = 0; offset + 46 < bytes.length; offset += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) continue;
    const nameLength = bytes.readUInt16LE(offset + 28);
    if (bytes.toString("utf8", offset + 46, offset + 46 + nameLength) !== name) continue;
    bytes.writeUInt32LE(size, offset + 24);
    return bytes;
  }
  throw new Error(`entry ${name} not found`);
}

test("a .owapp archive moves the application with binary documents and the project's work files", async () => withFlags(async () => {
  const a = await machine("a");
  const b = await machine("b");
  try {
    const created = await a.json("POST", "/specialist-applications", { userName: "Persona", name: "Soja: exportación", specialty: "Exportación de soja", template: "custom", packPath: await sourcePack(a.root) });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const app = z.object({ id: z.string() }).parse(created.json.application);
    const project = a.config.workspaces[0];
    assert.ok(project);
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(48 * 1024), Buffer.from("\n%%EOF\n")]);
    const xlsx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), randomBytes(20 * 1024), Buffer.alloc(4096)]);
    await writeFile(join(project.path, "proyecto", "estado.md"), "# Memoria\nDecisión: puerto de Rosario.\n");
    await mkdir(join(project.path, "proyecto", "fuentes", "local"), { recursive: true });
    await writeFile(join(project.path, "proyecto", "fuentes", "local", "precios.md"), "precios");
    await writeFile(join(project.path, "proyecto", "fuentes", ".borrador.md"), "oculto");
    await writeFile(join(project.path, "proyecto", "fuentes", "index.json"), JSON.stringify([
      { id: "src_ok", provider: "file", title: "Precios", url: null, evidencePath: "proyecto/fuentes/local/precios.md", datasetId: null, retrievedAt: 1, chunks: 1 },
      { id: "src_lost", provider: "file", title: "Borrador", url: null, evidencePath: "proyecto/fuentes/.borrador.md", datasetId: null, retrievedAt: 2, chunks: 1 },
    ]));
    await mkdir(join(project.path, "informes", "2026"), { recursive: true });
    await writeFile(join(project.path, "informes", "2026", "reporte final.pdf"), pdf);
    await writeFile(join(project.path, "planilla.xlsx"), xlsx);
    await writeFile(join(project.path, "notas.md"), "Notas del trabajo\n");
    // Machine state and rebuilt folders never travel.
    await mkdir(join(project.path, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(project.path, "node_modules", "pkg", "index.js"), "x");
    await mkdir(join(project.path, ".git"), { recursive: true });
    await writeFile(join(project.path, ".git", "config"), "[core]");

    const response = await a.send("GET", `/specialist-applications/${app.id}/export`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/zip");
    assert.match(response.headers.get("content-disposition") ?? "", /filename\*=UTF-8''Soja%20exportaci%C3%B3n\.owapp/);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(Number(response.headers.get("content-length")), bytes.byteLength);
    // The export's scratch copy is removed once it was streamed.
    assert.deepEqual(await readdir(join(specialistDirectory(a.config), ".portability")), []);

    // An independent ZIP reader sees real entries, no base64, and an index with checksums.
    const entries = unzipSync(bytes);
    const manifest = z.object({ version: z.literal(2), files: z.array(z.object({ path: z.string(), size: z.number(), sha256: z.string() })), sections: jsonObject }).parse(JSON.parse(Buffer.from(entries["manifest.json"] ?? []).toString("utf8")));
    const paths = Object.keys(entries).sort();
    assert.ok(paths.includes("work/0/informes/2026/reporte final.pdf"));
    assert.ok(paths.includes("work/0/planilla.xlsx"));
    assert.ok(paths.includes("projects/0/estado.md"));
    assert.ok(paths.includes("library/agents/revisor.md"));
    assert.equal(paths.some(path => path.includes("node_modules") || path.includes(".git") || path.startsWith("work/0/proyecto/") || path.includes(".borrador")), false);
    assert.deepEqual(Buffer.from(entries["work/0/informes/2026/reporte final.pdf"] ?? []), pdf);
    for (const file of manifest.files) assert.equal(sha256(entries[file.path] ?? new Uint8Array()), file.sha256, file.path);
    assert.equal(manifest.files.length, paths.length - 1);
    // Personal data and machine paths never travel.
    const text = Buffer.from(bytes).toString("latin1");
    assert.equal(text.includes("Persona"), false);
    assert.equal(text.includes(a.root), false);

    const imported = await b.importArchive(bytes, "Persona B");
    assert.equal(imported.status, 201, JSON.stringify(imported.json));
    const result = z.object({ application: z.object({ id: z.string(), name: z.string(), agentCount: z.number(), skillCount: z.number() }), workspaceId: z.string(), skippedSections: z.array(z.string()), warnings: z.array(z.string()) }).parse(imported.json);
    assert.equal(result.application.name, "Soja: exportación");
    assert.deepEqual([result.application.agentCount, result.application.skillCount], [1, 1]);
    assert.deepEqual(result.skippedSections, []);
    // The source whose evidence did not travel is reported; the one that travelled is not.
    assert.equal(result.warnings.length, 1, JSON.stringify(result.warnings));
    assert.match(result.warnings[0] ?? "", /Borrador/);
    const target = b.config.workspaces.find(workspace => workspace.id === result.workspaceId);
    assert.ok(target);
    assert.deepEqual(await readFile(join(target.path, "informes", "2026", "reporte final.pdf")), pdf);
    assert.deepEqual(await readFile(join(target.path, "planilla.xlsx")), xlsx);
    assert.equal(await readFile(join(target.path, "notas.md"), "utf8"), "Notas del trabajo\n");
    assert.equal(await readFile(join(target.path, "proyecto", "estado.md"), "utf8"), "# Memoria\nDecisión: puerto de Rosario.\n");
    assert.ok((await stat(join(target.path, ".opencode", "agents", "revisor.md"))).isFile());
    await assert.rejects(stat(join(target.path, "node_modules")));
    assert.deepEqual(await readdir(join(specialistDirectory(b.config), ".portability")), []);
  } finally { await rm(a.root, { recursive: true, force: true }); await rm(b.root, { recursive: true, force: true }); }
}));

test("unsafe or inconsistent archives are rejected before anything is written", async () => withFlags(async () => {
  const m = await machine("reject");
  try {
    const reject = async (bytes: Uint8Array, pattern: RegExp, label: string) => {
      const response = await m.importArchive(bytes);
      assert.equal(response.status, 422, `${label}: ${JSON.stringify(response.json)}`);
      assert.equal(response.json.code, "invalid_application_bundle", label);
      assert.match(String(response.json.message), pattern, label);
      await assertNothingLeft(m);
    };
    const doc = strToU8("hola");
    // Zip-slip in every form: parent segments, absolute paths, drive letters, backslashes.
    for (const name of ["../escape.txt", "work/0/../../escape.txt", "/etc/escape.txt", "C:/escape.txt", "work\\0\\escape.txt"]) {
      await reject(archive({ "work/0/ok.txt": doc }, { extra: { [name]: doc } }), /ruta no permitida/, name);
    }
    // A symlink entry (Unix mode 0120777 in the external attributes).
    await reject(archive({ "work/0/ok.txt": doc }, { extra: { "work/0/enlace": [strToU8("/etc/passwd"), { os: 3, attrs: 0o120777 << 16 }] } }), /enlace simbólico/, "symlink");
    // Zip bomb by ratio: 8 MB of zeros compress to a few KB.
    await reject(archive({ "work/0/ceros.bin": new Uint8Array(8 * 1024 * 1024) }), /bomba ZIP/, "ratio");
    // Zip bomb by lying header: the entry inflates past its declared size.
    const lying = archive({ "work/0/ceros.bin": new Uint8Array(512 * 1024) }, { manifest: index => ({ format: "openwork.specialist-application", version: 2, application: { name: "Zip", specialty: "Pruebas", personality: "", template: "custom" }, sections: { projects: { projects: [{ name: "P", dataDir: "proyecto" }] }, workFiles: {} }, files: index.map(file => ({ ...file, size: 1_000 })) }) });
    await reject(patchDeclaredSize(lying, "work/0/ceros.bin", 1_000), /más grande de lo declarado/, "lying size");
    // Oversize entry (declared over 50 MB) and too many entries.
    await reject(patchDeclaredSize(archive({ "work/0/grande.bin": randomBytes(1024) }), "work/0/grande.bin", 51 * 1024 * 1024), /supera los 50 MB/, "oversize");
    const many: Record<string, Uint8Array> = {};
    for (let index = 0; index <= 10_001; index += 1) many[`work/0/f${index}.txt`] = new Uint8Array();
    await reject(zipSync(many), /más de 10.?000 archivos/, "count");
    // The index must match the entries: checksum, unlisted entries, missing entries, schema.
    await reject(archive({ "work/0/a.txt": doc }, { manifest: index => ({ format: "openwork.specialist-application", version: 2, application: { name: "Zip", specialty: "Pruebas", personality: "", template: "custom" }, sections: { projects: { projects: [{ name: "P", dataDir: "proyecto" }] }, workFiles: {} }, files: index.map(file => ({ ...file, sha256: "0".repeat(64) })) }) }), /suma de verificación/, "sha256");
    await reject(archive({ "work/0/a.txt": doc }, { extra: { "work/0/oculto.txt": doc } }), /no figura en su índice/, "unlisted");
    await reject(archive({}, { manifest: () => ({ format: "openwork.specialist-application", version: 2, application: { name: "Zip", specialty: "Pruebas", personality: "", template: "custom" }, sections: {}, files: [{ path: "work/0/falta.txt", size: 1, sha256: "0".repeat(64) }] }) }), /Faltan archivos/, "missing");
    await reject(archive({}, { manifest: () => ({ format: "openwork.specialist-application", version: 2, application: { name: "" }, sections: {}, files: [] }) }), /manifest\.json/, "schema");
    await reject(archive({}, { manifest: () => ({ format: "openwork.specialist-application", version: 3, sections: {}, files: [] }) }), /versión más nueva/, "newer");
    await reject(zipSync({ "otro.txt": doc }), /no tiene manifest\.json/, "no manifest");
    await reject(strToU8("esto no es un zip"), /dañado/, "not a zip");
    // Work files for a project the archive does not have.
    await reject(archive({ "work/3/a.txt": doc }), /no pertenece a ningún proyecto/, "unknown project");
  } finally { await rm(m.root, { recursive: true, force: true }); }
}));

test("a v1 JSON bundle still imports, and turning the flag off keeps the JSON export", async () => {
  const m = await machine("v1");
  try {
    await withFlags(async () => {
      const bundle = { format: "openwork.specialist-application", version: 1, application: { name: "Vieja", specialty: "Pruebas", personality: "", template: "custom" }, sections: { projects: { projects: [{ name: "P", dataDir: "proyecto", files: [{ path: "estado.md", encoding: "utf8", content: "# v1\n" }, { path: "datos.bin", encoding: "base64", content: "AP8B/g==" }] }] } } };
      const imported = await m.json("POST", "/specialist-applications/import", { bundle, userName: "Persona" });
      assert.equal(imported.status, 201, JSON.stringify(imported.json));
      const target = m.config.workspaces[0];
      assert.ok(target);
      assert.equal(await readFile(join(target.path, "proyecto", "estado.md"), "utf8"), "# v1\n");
      assert.deepEqual([...await readFile(join(target.path, "proyecto", "datos.bin"))], [0, 255, 1, 254]);
    });
    await withFlags(async () => {
      const catalog = await m.json("GET", "/specialist-applications");
      assert.equal(catalog.json.zipBundleEnabled, false);
      const id = z.object({ applications: z.array(z.object({ id: z.string() })) }).parse(catalog.json).applications[0]?.id;
      const exported = await m.json("GET", `/specialist-applications/${id}/export`);
      assert.equal(exported.status, 200);
      assert.equal(exported.json.version, 1);
      const rejected = await m.importArchive(archive({}));
      assert.equal(rejected.status, 415);
      assert.equal(rejected.json.code, "application_archive_disabled");
    }, { DEN_FEATURE_SPECIALIST_APP_ZIP_BUNDLE: "false" });
  } finally { await rm(m.root, { recursive: true, force: true }); }
});

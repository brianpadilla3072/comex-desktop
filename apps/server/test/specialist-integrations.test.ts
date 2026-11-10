import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FactoryRegistry, exportPortableDefinitions } from "../src/specialists/factories.js";
import { createPackFactory } from "../src/specialists/integrations/pack-factory.js";
import { inspectSpecialistPack, prepareSpecialistWorkspace, saveSpecialistPack } from "../src/specialists/packs.js";
import { applicationInput, specialistStore } from "../src/specialists/store.js";
import { runTavilyCommand } from "../src/specialists/integrations/tavily.js";
import { createResearchPlugin } from "../src/specialists/integrations/native-plugin.js";
import { syncResearchPlugin } from "../src/specialists/integrations/native.js";
import { providerSchemaProblems } from "../src/opencode-plugins/provider-safe-tool-schema.js";
import type { WorkspaceInfo } from "../src/types.js";

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "specialist-integrations-"));
  const source = join(root, "source");
  await mkdir(join(source, "skills", "fuentes"), { recursive: true });
  await mkdir(join(source, "agents")); await mkdir(join(source, "commands"));
  await writeFile(join(source, "skills", "fuentes", "SKILL.md"), "---\nname: fuentes\ndescription: Verifica fuentes.\n---\nLeé las fuentes originales.\n");
  await writeFile(join(source, "agents", "revisor.md"), "---\ndescription: Revisa el trabajo.\nmode: subagent\n---\nPedí evidencia.\n");
  await writeFile(join(source, "commands", "revisar.md"), "Revisá este trabajo.");
  await writeFile(join(source, "opencode.jsonc"), '{"plugins":["untrusted-plugin"],"provider":{"secret":"NOT_EXPORTED"}}');
  const config = { configPath: join(root, "server.json"), workspaces: new Array<WorkspaceInfo>() };
  const store = await specialistStore(config);
  const pack = await inspectSpecialistPack(source);
  const app = store.create(applicationInput.parse({ userName: "Usuario de prueba", name: "Estudio", specialty: "Investigación", template: "custom", personality: "Clara y verificable" }), { agents: 1, skills: 1 });
  await saveSpecialistPack(config, app.id, pack);
  const project = join(root, "project"); await prepareSpecialistWorkspace(config, app, project);
  store.bind("ws_fixture", app.id, project);
  config.workspaces.push({ id: "ws_fixture", path: project, name: "Proyecto", workspaceType: "local" });
  return { root, config, source, project, app, store, pack, async close() { store.close(); await rm(root, { recursive: true, force: true }); } };
}

test("factories replace providers without changing consumers and reject silent fallback", () => {
  const registry = new FactoryRegistry<{ model: string }, { answer(): string }>([
    { id: "first", label: "Primer motor", create: options => ({ answer: () => `A:${options.model}` }) },
    { id: "replacement", label: "Otro motor", create: options => ({ answer: () => `B:${options.model}` }) },
  ]);
  assert.equal(registry.create("replacement", { model: "local" }).answer(), "B:local");
  assert.throws(() => registry.create("retired", { model: "local" }), /adaptador/);
  assert.throws(() => registry.register({ id: "first", label: "Duplicado", create: () => ({ answer: () => "" }) }), /registrada/);
});

test("OCX export includes portable definitions and commands, excludes account data, and imports again", async () => {
  const f = await setup();
  try {
    const result = await createPackFactory(f.config).exportOcx(f.app.id, f.root);
    const manifest = JSON.parse(await readFile(join(result.folderPath, "specialist-manifest.json"), "utf8"));
    assert.equal(manifest.application.name, "Estudio");
    assert.deepEqual(manifest.definitions.map((item: { kind: string }) => item.kind).sort(), ["agent", "skill"]);
    assert.equal(manifest.definitions.find((item: { kind: string }) => item.kind === "agent").extensions.opencode.mode, "subagent");
    assert.equal(await readFile(join(result.folderPath, "opencode.jsonc"), "utf8"), "{}\n");
    assert.match(await readFile(join(result.folderPath, "AGENTS.md"), "utf8"), /Clara y verificable/);
    const imported = await inspectSpecialistPack(result.folderPath);
    assert.deepEqual(imported.summary.agents, ["revisor"]);
    assert.ok(imported.files.some(file => file.path === "commands/revisar.md"));
    assert.equal(JSON.stringify(imported.files).includes("NOT_EXPORTED"), false);
    assert.equal(exportPortableDefinitions(f.pack.files).length, 2);
    await assert.rejects(() => createPackFactory(f.config).exportOcx(f.app.id, f.root), /otra carpeta/);
  } finally { await f.close(); }
});

test("pack updates preserve project edits, detect stale reviews and propagate intact files", async () => {
  const f = await setup();
  try {
    const factory = createPackFactory(f.config);
    await writeFile(join(f.project, ".opencode/agents/revisor.md"), "Mi edición local");
    await writeFile(join(f.source, "agents/revisor.md"), "---\ndescription: Revisión nueva.\n---\nNueva guía.\n");
    await writeFile(join(f.source, "commands/revisar.md"), "Revisá con referencias.");
    const review = await factory.preview(f.app.id, f.source);
    assert.deepEqual(review.conflicts.map(item => item.path), ["agents/revisor.md"]);
    await writeFile(join(f.source, "commands/revisar.md"), "Revisá con referencias y fechas.");
    await assert.rejects(() => factory.update(f.app.id, f.source, review.fingerprint), /cambiaron/);
    const fresh = await factory.preview(f.app.id, f.source);
    const result = await factory.update(f.app.id, f.source, fresh.fingerprint);
    assert.equal(result.applied, 1); assert.equal(result.preserved.length, 1);
    assert.equal(await readFile(join(f.project, ".opencode/agents/revisor.md"), "utf8"), "Mi edición local");
    assert.match(await readFile(join(f.project, ".opencode/commands/revisar.md"), "utf8"), /fechas/);
  } finally { await f.close(); }
});

test("pack updates reject symlink targets instead of following them", async () => {
  const f = await setup();
  try {
    await writeFile(join(f.source, "commands/revisar.md"), "Nueva versión");
    await rm(join(f.project, ".opencode/commands"), { recursive: true });
    const outside = join(f.root, "outside"); await mkdir(outside);
    await symlink(outside, join(f.project, ".opencode/commands"));
    await assert.rejects(() => createPackFactory(f.config).preview(f.app.id, f.source), /enlace/);
  } finally { await f.close(); }
});

test("research settings stay per profile in SQLite and native tool schemas are provider safe", async () => {
  const f = await setup();
  const original = { specialist: process.env.DEN_FEATURE_SPECIALIST_APPLICATIONS, integrations: process.env.DEN_FEATURE_SPECIALIST_INTEGRATIONS };
  try {
    process.env.DEN_FEATURE_SPECIALIST_APPLICATIONS = "true"; process.env.DEN_FEATURE_SPECIALIST_INTEGRATIONS = "true";
    const other = f.store.create(applicationInput.parse({ name: "Otro", specialty: "Otra", template: "custom" }), { agents: 0, skills: 0 });
    f.store.setResearchEnabled(f.app.id, true);
    assert.equal(f.store.researchEnabled(other.id), false);
    await syncResearchPlugin(f.config, "ws_fixture", f.project);
    const loader = await readFile(join(f.project, ".opencode/plugins/comex-research/server.js"), "utf8");
    const descriptorFile = JSON.parse(loader.match(/createResearchPlugin\((".*")\)/)![1]!);
    const tools: Array<{ name: string; input: unknown; execute(input: unknown, call: { signal: AbortSignal }): Promise<unknown> }> = [];
    let disposed = false;
    const dispose = await createResearchPlugin(descriptorFile).setup({ location: { directory: f.project }, tool: { transform: async callback => { callback({ add: tool => tools.push(tool) }); return { dispose: async () => { disposed = true; } }; } } });
    assert.equal(tools.length, 5);
    for (const tool of tools) assert.deepEqual(providerSchemaProblems(tool.input), []);
    f.store.setResearchEnabled(f.app.id, false);
    await syncResearchPlugin(f.config, "ws_fixture", f.project);
    // A disabled provider reaches the model as text it can read, never as a thrown null result.
    const disabled = await tools[0]!.execute({ query: "test" }, { signal: new AbortController().signal }) as { content?: Array<{ text: string }> };
    assert.match(disabled.content?.[0]?.text ?? "", /desactivada/);
    await dispose?.(); assert.equal(disposed, true);
  } finally {
    if (original.specialist === undefined) delete process.env.DEN_FEATURE_SPECIALIST_APPLICATIONS; else process.env.DEN_FEATURE_SPECIALIST_APPLICATIONS = original.specialist;
    if (original.integrations === undefined) delete process.env.DEN_FEATURE_SPECIALIST_INTEGRATIONS; else process.env.DEN_FEATURE_SPECIALIST_INTEGRATIONS = original.integrations;
    await f.close();
  }
});

test("CLI runner passes shell-looking queries literally and honors cancellation", async () => {
  const result = await runTavilyCommand(process.execPath, ["-e", "process.stdout.write(process.argv[1])", "$(private); literal"], { timeout: 5_000 });
  assert.equal(result.stdout, "$(private); literal");
  const controller = new AbortController();
  const running = runTavilyCommand(process.execPath, ["-e", "setTimeout(()=>{},10000)"], { signal: controller.signal });
  controller.abort(); await assert.rejects(() => running, /canceló/);
});

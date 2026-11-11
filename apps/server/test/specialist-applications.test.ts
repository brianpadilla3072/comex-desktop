import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openSpecialistStore, applicationInput } from "../src/specialists/store.js";
import { builtInComexPack, inspectSpecialistPack, prepareSpecialistWorkspace, saveSpecialistPack } from "../src/specialists/packs.js";
import { specialistInstructions } from "../src/specialists/instructions.js";
import { ensureComexWorkspace, readComexMemory } from "../src/comex/seed.js";

const input = (name: string) => applicationInput.parse({ userName: "Usuario de prueba", name, specialty: `Especialidad ${name}`, personality: `PERSONA_${name}`, template: "custom" });
async function fixturePack(root: string) {
  const pack = join(root, "source");
  await mkdir(join(pack, "skills", "tono", "references"), { recursive: true });
  await mkdir(join(pack, "agents"));
  await mkdir(join(pack, "scripts"));
  await writeFile(join(pack, "skills", "tono", "SKILL.md"), "---\nname: tono\ndescription: Una skill de prueba.\n---\nAyudá con claridad.\n");
  await writeFile(join(pack, "skills", "tono", "references", "datos.csv"), "dato,valor\na,1\n");
  await writeFile(join(pack, "agents", "revisor.md"), "---\ndescription: Revisor de prueba.\nmode: subagent\n---\nRevisá evidencia.\n");
  await writeFile(join(pack, "scripts", "example.txt"), "Recurso de prueba");
  await writeFile(join(pack, ".env"), "SECRET=fixture\n");
  await writeFile(join(pack, "opencode.json"), '{"plugins":["not-loaded"]}');
  return pack;
}

test("profiles, local user and project bindings persist in normalized SQLite tables", async () => {
  const root = await mkdtemp(join(tmpdir(), "specialists-sqlite-"));
  const path = join(root, "profiles.sqlite");
  let store = await openSpecialistStore(path);
  try {
    assert.equal(store.user(), null);
    assert.throws(() => store.create(input("Bad identifier"), { agents: 0, skills: 0 }, "../../outside"));
    assert.equal(store.list().applications.length, 0);
    const a = store.create(input("Alpha"), { agents: 1, skills: 2 });
    const b = store.create(input("Beta"), { agents: 3, skills: 4 });
    store.bind("ws_alpha", a.id, join(root, "alpha"));
    store.bind("ws_beta", b.id, join(root, "beta"));
    assert.throws(() => store.bind("ws_alpha", b.id, join(root, "alpha")), /otra aplicación/);
    assert.throws(() => store.create(input("ALPHA"), { agents: 0, skills: 0 }), /ese nombre/);
    store.activate(a.id);
    store.close();
    store = await openSpecialistStore(path);
    assert.equal(store.user()?.displayName, "Usuario de prueba");
    assert.equal(store.list().activeApplicationId, a.id);
    assert.deepEqual(store.list().applications.find(app => app.id === b.id)?.workspaceIds, ["ws_beta"]);
    assert.equal(store.forWorkspace("ws_alpha")?.personality, "PERSONA_Alpha");
    assert.equal((await readFile(path)).subarray(0, 15).toString(), "SQLite format 3");
    store.update(a.id, { name: "Alpha nueva", specialty: "Diseño", personality: "Clara y concreta" });
    assert.equal(store.forWorkspace("ws_alpha")?.name, "Alpha nueva");
    assert.equal(store.forWorkspace("ws_beta")?.personality, "PERSONA_Beta");
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

test("import validates a snapshot, excludes secrets/config plugins and keeps the source unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "specialists-pack-"));
  try {
    const source = await fixturePack(root);
    const result = await inspectSpecialistPack(source);
    assert.deepEqual(result.summary.agents, ["revisor"]);
    assert.deepEqual(result.summary.skills, ["tono"]);
    assert.equal(result.files.some(file => file.path === ".env" || file.path === "opencode.json"), false);
    assert.equal(await readFile(join(source, ".env"), "utf8"), "SECRET=fixture\n");
    await symlink(join(source, ".env"), join(source, "skills", "tono", "link"));
    await assert.rejects(inspectSpecialistPack(source), /enlace simbólico/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("custom application projects have separate packs, memory and identities without receiving the Comex pack", async () => {
  const root = await mkdtemp(join(tmpdir(), "specialists-isolation-"));
  const config = { configPath: join(root, "server.json") };
  const store = await openSpecialistStore(join(root, "profiles.sqlite"));
  try {
    const source = await fixturePack(root);
    const pack = await inspectSpecialistPack(source);
    const a = store.create(input("Alpha"), { agents: 1, skills: 1 });
    const b = store.create(input("Beta"), { agents: 0, skills: 0 });
    await saveSpecialistPack(config, a.id, pack);
    await saveSpecialistPack(config, b.id, null);
    const projectA = join(root, "project-alpha"); const projectB = join(root, "project-beta");
    await prepareSpecialistWorkspace(config, a, projectA);
    await prepareSpecialistWorkspace(config, b, projectB);
    assert.equal(await ensureComexWorkspace(projectB), false);
    const note = "DECISION_SOLO_ALPHA";
    // A custom application keeps its memory in `proyecto/`, never in the Comex folder.
    await assert.rejects(readFile(join(projectA, "comex", "estado.md")));
    await writeFile(join(projectA, "proyecto", "estado.md"), note);
    await prepareSpecialistWorkspace(config, a, projectA);
    assert.equal(await readFile(join(projectA, "proyecto", "estado.md"), "utf8"), note);
    await assert.rejects(prepareSpecialistWorkspace(config, b, projectA), /otra aplicación/);
    await assert.rejects(readFile(join(projectB, ".opencode", "skills", "tono", "SKILL.md")));
    await assert.rejects(readFile(join(projectB, ".opencode", "skills", "estudio-mercado-internacional", "SKILL.md")));
    const memoryA = await readComexMemory(projectA, "session_a");
    const memoryB = await readComexMemory(projectB, "session_b");
    const promptA = specialistInstructions(a, store.user(), memoryA);
    const promptB = specialistInstructions(b, store.user(), memoryB);
    assert.ok(promptA.includes("PERSONA_Alpha") && promptA.includes(note));
    assert.ok(promptB.includes("PERSONA_Beta") && !promptB.includes(note) && !promptB.includes("PERSONA_Alpha"));
    assert.equal(promptB.includes("encuesta"), false);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

test("invalid skills and oversized pack resources are rejected before a profile is created", async () => {
  const root = await mkdtemp(join(tmpdir(), "specialists-invalid-"));
  try {
    const source = await fixturePack(root);
    await writeFile(join(source, "skills", "tono", "SKILL.md"), "---\nname: otro-nombre\ndescription: Prueba\n---\nTexto\n");
    await assert.rejects(inspectSpecialistPack(source), /YAML/);
    await rm(join(source, "skills"), { recursive: true });
    await writeFile(join(source, "scripts", "large.bin"), Buffer.alloc(5 * 1024 * 1024 + 1));
    await assert.rejects(inspectSpecialistPack(source), /límites/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the bundled Comex pack parses as valid native YAML and imports all 4 agents and 12 skills", async () => {
  const pack = await inspectSpecialistPack(builtInComexPack());
  assert.equal(pack.summary.agents.length, 4);
  assert.equal(pack.summary.skills.length, 12);
});

test("the specialist instructions point to Tavily research only when it is connected", () => {
  const app = { id: "app_x", name: "Comercio", specialty: "Soja", personality: "Clara", template: "custom" as const, agentCount: 0, skillCount: 0, createdAt: 1, workspaceIds: [] };
  const memory = { continuity: null } as never;
  const withResearch = specialistInstructions(app, null, memory, null, false, false, true, false, true, false, true);
  assert.match(withResearch, /tavily_search/);
  assert.match(withResearch, /nunca inventes URLs/);
  const without = specialistInstructions(app, null, memory, null, false, false, true, false, true, false, false);
  assert.doesNotMatch(without, /tavily_search/);
  // Even disconnected, the model must say a search failed out loud instead of inventing.
  assert.match(without, /decilo en voz alta/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, symlink, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedComexPack, ensureComexWorkspace, ensureComexSession, readComexMemory, sessionMemoryPath } from "../src/comex/seed.js";
import { comexWorkspaceEnabled } from "../src/comex/features.js";

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "comex-seed-"));
  const pack = await mkdtemp(join(tmpdir(), "comex-pack-"));
  await mkdir(join(pack, "skills/example"), { recursive: true });
  await mkdir(join(pack, "agents"));
  await writeFile(join(pack, "skills/example/SKILL.md"), "version 1");
  await writeFile(join(pack, "agents/example.md"), "agent 1");
  return { root, pack };
}

test("seed updates official files and preserves edits over two updates", async () => {
  const { root, pack } = await setup();
  await seedComexPack(root, pack);
  await writeFile(join(root, ".opencode/skills/example/SKILL.md"), "user edit");
  await writeFile(join(pack, "skills/example/SKILL.md"), "version 2");
  await writeFile(join(pack, "agents/example.md"), "agent 2");
  await seedComexPack(root, pack);
  assert.equal(await readFile(join(root, ".opencode/agents/example.md"), "utf8"), "agent 2");
  assert.equal(await readFile(join(root, ".opencode/skills/example/SKILL.md.nuevo"), "utf8"), "version 2");
  await writeFile(join(pack, "skills/example/SKILL.md"), "version 3");
  await seedComexPack(root, pack);
  assert.equal(await seedComexPack(root, pack), false);
  assert.equal(await readFile(join(root, ".opencode/skills/example/SKILL.md"), "utf8"), "user edit");
  assert.equal(await readFile(join(root, ".opencode/skills/example/SKILL.md.nuevo"), "utf8"), "version 2");
});

test("seed refuses symlink destinations and never writes outside project", async () => {
  const { root, pack } = await setup();
  const outside = await mkdtemp(join(tmpdir(), "comex-outside-"));
  await symlink(outside, join(root, ".opencode"), "dir");
  await assert.rejects(seedComexPack(root, pack), /enlaces simbólicos/);
});

test("project and session notes survive reopen and do not mix sessions", async () => {
  process.env.DEN_FEATURE_COMEX_WORKSPACE = "true";
  const { root, pack } = await setup();
  await ensureComexWorkspace(root, pack);
  await writeFile(join(root, "comex/estado.md"), "decision confirmed");
  await ensureComexSession(root, "ses_one");
  await writeFile(join(root, sessionMemoryPath("ses_one")), "first session");
  await ensureComexSession(root, "ses_two");
  await ensureComexWorkspace(root, pack);
  await ensureComexSession(root, "ses_one");
  assert.equal(await readFile(join(root, "comex/estado.md"), "utf8"), "decision confirmed");
  assert.equal(await readFile(join(root, sessionMemoryPath("ses_one")), "utf8"), "first session");
  assert.match(await readFile(join(root, sessionMemoryPath("ses_two")), "utf8"), /Sin notas/);
  assert.equal((await readFile(join(root, "AGENTS.md"), "utf8")).match(/<!-- comex-memory-v1 -->/g)?.length, 1);
  const memory = await readComexMemory(root, "ses_two");
  assert.equal(memory.project.text, "decision confirmed");
  assert.equal(memory.session.text.includes("first session"), false);
  assert.throws(() => sessionMemoryPath("../../outside"));
  delete process.env.DEN_FEATURE_COMEX_WORKSPACE;
});

test("operator kill switch wins and cloud is unavailable", () => {
  assert.equal(comexWorkspaceEnabled({}), true);
  assert.equal(comexWorkspaceEnabled({ DEN_FEATURE_COMEX_WORKSPACE: "false" }), false);
  assert.equal(comexWorkspaceEnabled({ DEN_FEATURE_COMEX_WORKSPACE: "true" }), true);
  assert.equal(comexWorkspaceEnabled({ DEN_DEPLOYMENT: "cloud", DEN_FEATURE_COMEX_WORKSPACE: "true" }), false);
});

test("concurrent initialization is idempotent and preserves existing project instructions", async () => {
  const { root, pack } = await setup();
  await writeFile(join(root, "AGENTS.md"), "# Existing project rules\n");
  await Promise.all(Array.from({ length: 5 }, () => ensureComexWorkspace(root, pack)));
  const instructions = await readFile(join(root, "AGENTS.md"), "utf8");
  assert.ok(instructions.startsWith("# Existing project rules\n"));
  assert.equal(instructions.match(/<!-- comex-memory-v1 -->/g)?.length, 1);
  assert.equal(await ensureComexWorkspace(root, pack), false);
});

test("corrupt seed metadata fails without overwriting personalized skills", async () => {
  const { root, pack } = await setup();
  await seedComexPack(root, pack);
  await writeFile(join(root, ".opencode/skills/example/SKILL.md"), "personalized");
  await writeFile(join(root, ".opencode/.comex-pack-hashes.json"), '{"bad":null}');
  await assert.rejects(seedComexPack(root, pack), /Registro del pack inválido/);
  assert.equal(await readFile(join(root, ".opencode/skills/example/SKILL.md"), "utf8"), "personalized");
});

test("memory injection is bounded and rejects links outside the project", async () => {
  const { root, pack } = await setup();
  await ensureComexWorkspace(root, pack);
  await ensureComexSession(root, "ses_bounded");
  await writeFile(join(root, "comex/estado.md"), "x".repeat(13_000));
  await writeFile(join(root, sessionMemoryPath("ses_bounded")), "s".repeat(7_000));
  const bounded = await readComexMemory(root, "ses_bounded");
  assert.equal(bounded.project.text.length, 12_000);
  assert.equal(bounded.session.text.length, 6_000);
  assert.equal(bounded.project.truncated, true);
  assert.equal(bounded.session.truncated, true);
  await writeFile(join(root, "comex/estado.md"), "private".repeat(30_000));
  const tooLarge = await readComexMemory(root, "ses_bounded");
  assert.equal(tooLarge.project.text.includes("private"), false);
  assert.equal(tooLarge.project.truncated, true);
  await symlink(join(root, "AGENTS.md"), join(root, sessionMemoryPath("ses_link")));
  await assert.rejects(readComexMemory(root, "ses_link"), /enlaces simbólicos/);
});

test("Python runtime caches never enter the installed pack", async () => {
  const { root, pack } = await setup();
  await mkdir(join(pack, "skills/example/__pycache__"));
  await writeFile(join(pack, "skills/example/__pycache__/script.cpython.pyc"), "cache");
  await writeFile(join(pack, "skills/example/script.pyc"), "cache");
  await seedComexPack(root, pack);
  await assert.rejects(access(join(root, ".opencode/skills/example/script.pyc")));
  await assert.rejects(access(join(root, ".opencode/skills/example/__pycache__")));
});

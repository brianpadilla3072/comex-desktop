import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workspaceIdForPath } from "../src/workspaces.js";
import { runLibraryTool, syncLibraryToolPlugin } from "../src/specialists/library-tool-api.js";
import { applicationInput, specialistStore } from "../src/specialists/store.js";
import { inspectSpecialistPack, prepareSpecialistWorkspace, saveSpecialistPack } from "../src/specialists/packs.js";
import { readArtifact } from "../src/specialists/artifacts.js";

const input = (name: string) => applicationInput.parse({
  userName: "Usuario de prueba", name, specialty: "Comercio exterior", personality: "PROBE", template: "custom",
});

test("the specialist tool bridge exposes the sheet family end to end", async () => {
  const root = await mkdtemp(join(tmpdir(), "sheet-tool-bridge-"));
  const config = { configPath: join(root, "server.json"), port: 4711, workspaces: [] as Array<{ id: string; path: string }> };
  const store = await specialistStore(config);
  try {
    const pack = join(root, "source");
    await mkdir(join(pack, "agents"), { recursive: true });
    await writeFile(join(pack, "agents", "revisor.md"), "---\ndescription: Revisor de prueba.\nmode: subagent\n---\nRevisa evidencia.\n");
    const app = store.create(input("Alpha"), { agents: 1, skills: 0 });
    await saveSpecialistPack(config, app.id, await inspectSpecialistPack(pack));
    const project = join(root, "project");
    await prepareSpecialistWorkspace(config, app, project);
    const workspaceId = workspaceIdForPath(project);
    config.workspaces.push({ id: workspaceId, path: project });
    store.bind(workspaceId, app.id, project);
    await syncLibraryToolPlugin(config, workspaceId, project);

    const plugin = await readFile(join(project, ".opencode", "plugins", "comex-library", "server.js"), "utf8");
    assert.match(plugin, /createSpecialistLibraryPlugin/);
    const descriptors = await readdir(join(root, "specialists", "tool"));
    const descriptor = JSON.parse(await readFile(join(root, "specialists", "tool", descriptors[0]!), "utf8")) as { token: string; url: string };
    assert.ok(descriptor.token.length >= 16 && descriptor.url.endsWith("/specialist-tool"));

    const created = await runLibraryTool(config, project, "specialist_sheet_create", {
      title: "Presupuesto", sheetName: "Hoja1", rows: [["item", "valor"], ["Soja", "10"]],
    }) as { artifactId: string };
    assert.match(created.artifactId, /^art-/);

    const written = await runLibraryTool(config, project, "specialist_sheet_write", {
      artifactId: created.artifactId, cells: { B3: "=B2*2" },
    }) as { changed: number };
    assert.equal(written.changed, 1);
    const read = await runLibraryTool(config, project, "specialist_sheet_read", {
      artifactId: created.artifactId, range: "B3",
    }) as { cells: Array<{ computed: number }> };
    assert.equal(read.cells[0]!.computed, 20);

    const stored = await readArtifact(project, created.artifactId);
    assert.equal(stored.meta.type, "sheet");
    assert.equal(stored.meta.versions.length, 2);

    await assert.rejects(
      runLibraryTool(config, join(root, "elsewhere"), "specialist_sheet_list", {}),
      /aplicación especialista/,
    );
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

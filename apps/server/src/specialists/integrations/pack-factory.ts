import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { ApiError } from "../../errors.js";
import { inspectSpecialistPack } from "../packs.js";
import { specialistDirectory, specialistStore } from "../store.js";
import type { ServerConfig } from "../../types.js";
import { exportPortableDefinitions } from "../factories.js";

type Config = Pick<ServerConfig, "configPath" | "workspaces">;
type Pack = Awaited<ReturnType<typeof inspectSpecialistPack>>;
const hash = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
export const packFactories = [
  { id: "folder", name: "Carpeta de agentes y skills" },
  { id: "ocx", name: "Perfil OCX 3", version: "3.0.0-alpha.1" },
];
const digest = (pack: Pack) => hash(pack.files.map(file => `${file.path}\0${hash(file.data)}`).sort().join("\n"));
async function readOptional(path: string): Promise<Buffer | null> {
  try { const stat = await lstat(path); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(); return await readFile(path); }
  catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null; throw new ApiError(409, "unsafe_pack_target", "Una carpeta o archivo del pack fue reemplazado por un enlace o tipo incompatible."); }
}
async function safeParents(root: string, relative: string, create = false) {
  let current = root;
  for (const part of ["", ...relative.split("/").slice(0, -1)]) {
    current = part ? join(current, part) : current;
    try { const stat = await lstat(current); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") { if (create) await mkdir(current); }
      else throw new ApiError(409, "unsafe_pack_target", "El destino del pack contiene un enlace o una carpeta incompatible.");
    }
  }
}

/** One import factory for native folders and ordinary OCX profile directories.
 * Provider credentials, runtime configs and OCX executable hooks are never imported. */
export function createPackFactory(config: Config) {
  async function plan(id: string, sourcePath: string) {
    const store = await specialistStore(config); const app = store.application(id);
    const next = await inspectSpecialistPack(sourcePath);
    const packRoot = join(specialistDirectory(config), id, "pack");
    const before = app.agentCount || app.skillCount ? await inspectSpecialistPack(packRoot) : { files: [], summary: { agents: [], skills: [], fileCount: 0, bytes: 0 } };
    const previous = new Map(before.files.map(file => [file.path, file.data]));
    const incoming = new Map(next.files.map(file => [file.path, file.data]));
    const paths = [...new Set([...previous.keys(), ...incoming.keys()])].filter(path => {
      const a = previous.get(path), b = incoming.get(path); return !a || !b || hash(a) !== hash(b);
    }).sort();
    const changes = paths.map(path => ({ path, action: !previous.has(path) ? "add" : !incoming.has(path) ? "remove" : "update" }));
    const projects = config.workspaces.filter(workspace => store.forWorkspace(workspace.id)?.id === id);
    const conflicts: Array<{ workspaceId: string; path: string }> = [];
    const targets: Array<{ root: string; workspaceId: string; path: string; expected: string | null; data?: Uint8Array }> = [];
    for (const project of projects) for (const path of paths) {
      const root = join(project.path, ".opencode");
      await safeParents(project.path, `.opencode/${path}`);
      const actual = await readOptional(join(root, path));
      const base = previous.get(path);
      const incomingData = incoming.get(path);
      if (actual && incomingData && hash(actual) === hash(incomingData)) continue;
      if (base ? !actual || hash(base) !== hash(actual) : actual !== null) { conflicts.push({ workspaceId: project.id, path }); continue; }
      targets.push({ root, workspaceId: project.id, path, expected: actual ? hash(actual) : null, data: incomingData });
    }
    const fingerprint = hash(JSON.stringify({ next: digest(next), before: digest(before), targets: targets.map(({ root, path, expected }) => ({ root, path, expected })), conflicts }));
    return { next, packRoot, targets, summary: { fingerprint, changes, conflicts, pack: next.summary } };
  }
  return {
    inspect: inspectSpecialistPack,
    preview: async (id: string, sourcePath: string) => (await plan(id, sourcePath)).summary,
    async update(id: string, sourcePath: string, expectedFingerprint: string) {
      const value = await plan(id, sourcePath);
      if (value.summary.fingerprint !== expectedFingerprint) throw new ApiError(409, "pack_changed", "El pack o los proyectos cambiaron desde la revisión. Revisá los cambios otra vez.");
      const stage = `${value.packRoot}.next-${randomUUID()}`, backup = `${value.packRoot}.previous-${randomUUID()}`;
      await mkdir(stage, { recursive: true });
      let moved = false;
      try {
        for (const file of value.next.files) { const path = join(stage, file.path); await mkdir(dirname(path), { recursive: true }); await writeFile(path, file.data, { flag: "wx", mode: 0o600 }); }
        await rename(value.packRoot, backup); moved = true;
        await rename(stage, value.packRoot);
        (await specialistStore(config)).updatePackCounts(id, { agents: value.next.summary.agents.length, skills: value.next.summary.skills.length });
      } catch (error) { if (moved) { await rm(value.packRoot, { recursive: true, force: true }); await rename(backup, value.packRoot); } throw error; }
      finally { await rm(stage, { recursive: true, force: true }); }
      const skipped = [...value.summary.conflicts];
      let applied = 0;
      for (const target of value.targets) {
        try {
          await safeParents(target.root, target.path, true);
          const path = join(target.root, target.path), actual = await readOptional(path);
          if ((actual ? hash(actual) : null) !== target.expected) { skipped.push({ workspaceId: target.workspaceId, path: target.path }); continue; }
          if (target.data) {
            const temporary = `${path}.comex-${randomUUID()}.tmp`;
            try { await writeFile(temporary, target.data, { flag: "wx", mode: 0o600 }); await rename(temporary, path); }
            finally { await rm(temporary, { force: true }); }
          } else await rm(path);
          applied++;
        } catch { skipped.push({ workspaceId: target.workspaceId, path: target.path }); }
      }
      await rm(backup, { recursive: true, force: true });
      return { applied, preserved: skipped, pack: value.next.summary };
    },
    async exportOcx(id: string, destination: string) {
      if (!isAbsolute(destination)) throw new ApiError(422, "invalid_export_folder", "Elegí una carpeta con ruta absoluta.");
      const app = (await specialistStore(config)).application(id);
      const root = join(destination, `specialist-${app.id.slice(4)}`);
      await safeParents(destination, "placeholder");
      try { await mkdir(root, { mode: 0o700 }); }
      catch { throw new ApiError(409, "export_exists", "No se pudo crear la carpeta de exportación. Elegí otra carpeta vacía."); }
      try {
        const pack = app.agentCount || app.skillCount ? await inspectSpecialistPack(join(specialistDirectory(config), id, "pack")) : null;
        for (const file of pack?.files ?? []) { const target = join(root, file.path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, file.data, { flag: "wx", mode: 0o600 }); }
        const instructions = `# ${app.name}\n\n${app.specialty}\n\n${app.personality}\n\n`;
        const original = await readOptional(join(root, "AGENTS.md"));
        await writeFile(join(root, "AGENTS.md"), instructions + (original?.toString() ?? ""), { mode: 0o600 });
        await writeFile(join(root, "ocx.jsonc"), JSON.stringify({ $schema: "https://ocx.kdco.dev/schemas/v3/profile.json", projectConfig: "ignore", registries: {} }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
        await writeFile(join(root, "opencode.jsonc"), "{}\n", { flag: "wx", mode: 0o600 });
        await writeFile(join(root, "specialist-manifest.json"), JSON.stringify({ format: "specialist-application", version: 1, application: { name: app.name, specialty: app.specialty, personality: app.personality }, definitions: exportPortableDefinitions(pack?.files ?? []) }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
        return { folderPath: root, agentCount: app.agentCount, skillCount: app.skillCount };
      } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
    },
  };
}

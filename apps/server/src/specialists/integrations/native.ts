import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { specialistApplicationsEnabled, specialistIntegrationsEnabled } from "../../comex/features.js";
import { specialistDirectory, specialistStore } from "../store.js";
import { createResearchProvider } from "./research-factory.js";
import type { ServerConfig } from "../../types.js";

const MARKER = "// Managed by Comex: specialist-research-v1\n";
/** Idempotent project-only installation. No global OpenCode config or accounts change. */
export async function syncResearchPlugin(config: Pick<ServerConfig, "configPath" | "workspaces">, workspaceId: string, directory: string) {
  if (!specialistApplicationsEnabled()) return;
  const store = await specialistStore(config), app = store.forWorkspace(workspaceId);
  if (!app) return;
  const enabled = specialistIntegrationsEnabled() && store.researchEnabled(app.id);
  const canonical = await realpath(directory);
  const descriptor = join(specialistDirectory(config), "integrations", "projects", createHash("sha256").update(canonical).digest("hex") + ".json");
  if (!enabled) { try { await writeFile(descriptor, "{}", { mode: 0o600 }); } catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; } return; }
  const adapter = createResearchProvider("tavily", config);
  await mkdir(dirname(descriptor), { recursive: true, mode: 0o700 });
  const value = JSON.stringify({ directory: canonical, provider: "tavily", enabled, ...await adapter.runtime() });
  let before: string | undefined;
  try { before = await readFile(descriptor, "utf8"); } catch {}
  if (before !== value) await writeFile(descriptor, value, { mode: 0o600 });
  let folder = canonical;
  for (const part of [".opencode", "plugins", "comex-research"]) {
    folder = join(folder, part); await mkdir(folder, { recursive: true });
    const stat = await lstat(folder); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("La conexión de investigación no admite carpetas enlazadas.");
  }
  const path = join(folder, "server.js");
  const module = new URL(import.meta.url.endsWith(".ts") ? "./native-plugin.ts" : "./native-plugin.js", import.meta.url).href;
  const source = `${MARKER}import { createResearchPlugin } from ${JSON.stringify(module)};\nexport default createResearchPlugin(${JSON.stringify(descriptor)});\n`;
  try {
    const stat = await lstat(path); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("La conexión de investigación no es un archivo regular.");
    const existing = await readFile(path, "utf8"); if (!existing.startsWith(MARKER)) throw new Error("El proyecto ya tiene una conexión de investigación personalizada; se conservó sin cambios.");
    if (existing !== source) await writeFile(path, source, { mode: 0o600 });
  } catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") await writeFile(path, source, { mode: 0o600, flag: "wx" }); else throw error; }
}

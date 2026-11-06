import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runtimeStorageDir } from "../runtime-db.js";
import { createV2BrowserBridge } from "../opencode-v2-browser-bridge.js";
import type { ServerConfig } from "../types.js";

const MARKER = "// Managed by Comex: installed-browser-v1\n";
export function createInstalledBrowserIntegration(config: Pick<ServerConfig, "configPath" | "workspaces">) {
  let bridge: ReturnType<typeof createV2BrowserBridge> | undefined;
  const descriptors = new Set<string>();
  const pending = new Map<string, Promise<void>>();
  async function install(directory: string) {
    if (!config.workspaces.some(workspace => (workspace.workspaceType ?? "local") === "local" && workspace.path === directory)) return;
    const canonical = await realpath(directory);
    let task = pending.get(canonical);
    if (task) return task;
    task = (async () => {
      bridge ??= createV2BrowserBridge();
      const live = await bridge;
      const descriptor = join(runtimeStorageDir(config), "installed-browser", createHash("sha256").update(canonical).digest("hex") + ".json");
      await mkdir(dirname(descriptor), { recursive: true, mode: 0o700 });
      await writeFile(descriptor, JSON.stringify({ directory: canonical, url: live.url, token: live.token }), { mode: 0o600 });
      descriptors.add(descriptor);
      let folder = canonical;
      for (const segment of [".opencode", "plugins", "comex-browser"]) {
        folder = join(folder, segment);
        await mkdir(folder, { recursive: true });
        if ((await lstat(folder)).isSymbolicLink() || !(await lstat(folder)).isDirectory()) throw new Error("El puente de navegador no admite carpetas enlazadas.");
      }
      const file = join(folder, "server.js");
      const plugin = new URL(import.meta.url.endsWith(".ts") ? "./installed-browser-plugin.ts" : "./installed-browser-plugin.js", import.meta.url).href;
      const source = `${MARKER}import { installedBrowserPlugin } from ${JSON.stringify(plugin)};\nexport default installedBrowserPlugin(${JSON.stringify(descriptor)});\n`;
      let previous: string | undefined;
      try { const stat = await lstat(file); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("El puente de navegador existente no es un archivo regular."); previous = await readFile(file, "utf8"); }
      catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
      if (previous !== undefined && previous !== source) throw new Error("Este proyecto tiene otro puente de navegador o una copia modificada. No se sobrescribió.");
      if (previous === undefined) await writeFile(file, source, { flag: "wx", mode: 0o600 });
    })();
    pending.set(canonical, task);
    try { await task; } catch (error) { pending.delete(canonical); throw error; }
  }
  return { install, async close() {
    await Promise.allSettled([...pending.values()]);
    await Promise.allSettled([...descriptors].map(file => writeFile(file, "{}", { mode: 0o600 })));
    if (bridge) await (await bridge.catch(() => undefined))?.close();
  } };
}

import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { runtimeStorageDir } from "../runtime-db.js";
import { createV2BrowserBridge } from "../opencode-v2-browser-bridge.js";
import type { ServerConfig } from "../types.js";

const MARKER = "// Managed by Comex: installed-browser-v1\n";
const MANAGED_SOURCE = /^\/\/ Managed by Comex: installed-browser-v1\nimport \{ installedBrowserPlugin \} from ("(?:[^"\\]|\\.)*");\nexport default installedBrowserPlugin\(("(?:[^"\\]|\\.)*")\);\n$/;
export function isManagedBrowserSource(source: string): boolean {
  const match = MANAGED_SOURCE.exec(source);
  if (!match) return false;
  try {
    const plugin: unknown = JSON.parse(match[1]);
    const descriptor: unknown = JSON.parse(match[2]);
    return typeof plugin === "string" && plugin.startsWith("file://")
      && /\/(?:installed-browser-plugin\.(?:js|ts)|installed-browser\/plugin\.mjs)$/.test(plugin)
      && typeof descriptor === "string";
  } catch { return false; }
}
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
      const stateRoot = join(runtimeStorageDir(config), "installed-browser");
      const descriptor = join(stateRoot, createHash("sha256").update(canonical).digest("hex") + ".json");
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
      // The standalone engine reads this import path later, possibly from
      // another run. Packaged AppImages mount under a different random folder
      // every start and paths inside app.asar are invisible to it, so the
      // plugin is referenced from a stable copy under runtime storage.
      let plugin: string;
      if (import.meta.url.endsWith(".ts")) {
        plugin = new URL("./installed-browser-plugin.ts", import.meta.url).href;
      } else {
        const bundled = new URL("../opencode-plugins/comex-installed-browser-plugin.js", import.meta.url);
        const stable = join(stateRoot, "plugin.mjs");
        try {
          const bytes = await readFile(bundled);
          let current: Buffer | undefined;
          try { current = await readFile(stable); } catch { /* Fresh install. */ }
          if (!current || !current.equals(bytes)) await writeFile(stable, bytes, { mode: 0o600 });
          plugin = pathToFileURL(stable).href;
        } catch {
          // Single-file npm bundles keep importing from the module tree.
          plugin = bundled.href;
        }
      }
      const source = `${MARKER}import { installedBrowserPlugin } from ${JSON.stringify(plugin)};\nexport default installedBrowserPlugin(${JSON.stringify(descriptor)});\n`;
      let previous: string | undefined;
      try { const stat = await lstat(file); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("El puente de navegador existente no es un archivo regular."); previous = await readFile(file, "utf8"); }
      catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
      if (previous !== undefined && previous !== source) {
        // Exact generated wrappers may point to a still-existing older version
        // or another profile's descriptor. Extra or altered code stays protected.
        if (!isManagedBrowserSource(previous)) throw new Error("Este proyecto tiene otro puente de navegador o una copia modificada. No se sobrescribió.");
      }
      if (previous !== source) await writeFile(file, source, { flag: previous === undefined ? "wx" : "w", mode: 0o600 });
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

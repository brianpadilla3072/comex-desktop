import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { fetchOpencodeV2Json, type OpencodeV2Connection } from "../managed-opencode-v2.js";
import type { EngineV2Preview, EngineV2PreviewStatus } from "../engine-v2-preview.js";

const serviceSchema = z.object({ url: z.string(), password: z.string().min(1), pid: z.number().int().positive() });
const infoSchema = z.object({ version: z.string().regex(/^2\./), pid: z.number().int().positive() });
const providersSchema = z.object({ data: z.array(z.object({ id: z.string() })) });
const modelsSchema = z.object({ data: z.array(z.object({ id: z.string(), providerID: z.string() })) });
const unavailable = "No se pudo conectar al OpenCode instalado. Iniciá su servicio con «opencode service start» y volvé a intentar. Comex no cambió a otro motor.";

/** The service receipt contains a local transport password, never provider keys.
 * Read it again after a service restart; do not persist it or send it to the UI. */
export function readInstalledOpencodeConnection(file: string): OpencodeV2Connection & { pid: number } {
  try {
    if (!isAbsolute(file)) throw new Error();
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.size > 16_384 || (process.getuid && stat.uid !== process.getuid())) throw new Error();
    const receipt = serviceSchema.parse(JSON.parse(readFileSync(file, "utf8")));
    const url = new URL(receipt.url);
    if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname)
      || !url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error();
    return { url: url.origin, username: "opencode", password: receipt.password, pid: receipt.pid };
  } catch {
    // Parser and fetch errors must never include receipt contents or credentials.
    throw new Error(unavailable);
  }
}

/** Attach only: OpenCode continues owning accounts, configuration and history.
 * No migration, global provider mirror, config rewrite or child-process shutdown. */
export function createInstalledOpencodeEngine(file: string, deferStart = false, browser?: { install(directory: string): Promise<void>; close(): Promise<void> }): EngineV2Preview {
  let stopped = false;
  let pending: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let cached: OpencodeV2Connection | undefined;
  const state: EngineV2PreviewStatus = {
    engineOrigin: "manual", engineForced: false, forceUpgradePending: false,
    enabled: true, chatRouting: true, liveProviderSync: false, running: false, v2Only: false,
    connectionSource: "installed", mirroredProviderIds: [], skippedProviderIds: [], catalogModelIds: [],
    v1UnavailableReason: "Comex está conectado al servicio de OpenCode instalado.",
    lastWarning: "Las herramientas y conexiones pertenecen al OpenCode instalado. Los complementos privados del motor administrado de Comex no se inyectan en este servicio.",
  };
  const status = () => ({ ...state, mirroredProviderIds: [...state.mirroredProviderIds], catalogModelIds: [...state.catalogModelIds] });
  async function probe(directory?: string): Promise<void> {
    if (stopped) throw new Error(unavailable);
    if (!directory && pending) return pending;
    const job = (async () => {
      try {
        const connection = readInstalledOpencodeConnection(file);
        const request = (path: string) => fetchOpencodeV2Json(connection, path, { directory, timeoutMs: 8_000, maxResponseBytes: 8_000_000 });
        const info = await request("/api/info");
        const parsed = infoSchema.parse(info.json);
        if (info.status !== 200 || parsed.pid !== connection.pid) throw new Error();
        const [providers, models] = await Promise.all([request("/api/provider"), request("/api/model")]);
        if (providers.status !== 200 || models.status !== 200) throw new Error();
        const providerIds = providersSchema.parse(providers.json).data.map(provider => provider.id);
        const modelIds = modelsSchema.parse(models.json).data.map(model => `${model.providerID}/${model.id}`);
        if (stopped) throw new Error();
        cached = connection;
        Object.assign(state, { running: true, version: parsed.version, pid: parsed.pid,
          mirroredProviderIds: providerIds, catalogModelIds: modelIds, lastError: undefined, lastMirroredAt: new Date().toISOString() });
      } catch {
        cached = undefined;
        state.running = false;
        state.lastError = unavailable;
        throw new Error(unavailable);
      }
    })();
    if (!directory) pending = job;
    try { await job; } finally { if (pending === job) pending = undefined; }
  }
  function start() {
    if (stopped) return;
    void probe().catch(() => undefined);
    if (!timer) {
      timer = setInterval(() => { void probe().catch(() => undefined); }, 15_000);
      timer.unref?.();
    }
  }
  async function keepV2(enabled: boolean) {
    if (!enabled) throw new Error("Para dejar de usar OpenCode instalado, iniciá Comex con OPENWORK_COMEX_OPENCODE_MODE=managed.");
    await probe();
    return status();
  }
  async function unsupportedMcp() {
    throw new Error("Administrá las conexiones MCP desde tu OpenCode instalado. Comex no modifica su configuración.");
  }
  async function ensureWorkspaceReady(directory: string) {
    if (browser) {
      await browser.install(directory);
    }
    await probe(directory);
    if (browser) {
      const result = await fetchOpencodeV2Json(readInstalledOpencodeConnection(file), "/api/plugin", { directory, timeoutMs: 8_000 });
      const plugins = z.object({ data: z.array(z.object({ id: z.string().optional(), state: z.object({ status: z.string() }) })) }).safeParse(result.json);
      if (result.status !== 200 || !plugins.success || !plugins.data.data.some(plugin => plugin.id === "comex.browser" && plugin.state.status === "active")) {
        throw new Error("El puente del navegador todavía no está disponible en OpenCode. Volvé a intentar en unos segundos.");
      }
      state.lastWarning = "Navegador de Comex conectado mediante un puente local por proyecto. Las cuentas y conexiones MCP siguen perteneciendo a tu OpenCode instalado.";
    }
  }
  if (!deferStart) start();
  return {
    start, status, setEnabled: keepV2, setChatRouting: keepV2,
    setForcePolicy: () => status(), setV2Only: async () => status(),
    connection: () => {
      if (!cached || stopped) return undefined;
      try { return readInstalledOpencodeConnection(file); }
      catch { cached = undefined; state.running = false; state.lastError = unavailable; return undefined; }
    },
    refreshProviders: () => probe(), ensureWorkspaceReady,
    syncWorkspaceMcp: unsupportedMcp, settleWorkspaceMcp: unsupportedMcp,
    warmWorkspace: (_id, directory) => { void ensureWorkspaceReady(directory).catch(() => undefined); },
    settleWorkspaceSkills: async () => {},
    stop: async () => { stopped = true; if (timer) clearInterval(timer); timer = undefined; cached = undefined; state.running = false; await pending?.catch(() => undefined); await browser?.close(); },
  };
}

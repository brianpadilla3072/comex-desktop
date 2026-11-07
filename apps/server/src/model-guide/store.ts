import { createHash } from "node:crypto";
import { chmod } from "node:fs/promises";
import { openRuntimeSqliteDatabase } from "../runtime-db.js";
import { guideDiscoverySchema, guideObservationSchema, modelGuideCatalogSchema, type GuideSnapshot, type ModelGuideCatalog } from "@openwork/types/model-guide";
import bundledJson from "./catalog.json" with { type: "json" };

export const bundledCatalog = modelGuideCatalogSchema.parse(bundledJson);
const DAY = 86_400_000;
const MAX_BYTES = 2_000_000;
function validateUpdateUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("La URL del catálogo debe ser HTTPS, sin credenciales ni fragmentos.");
  return url.href;
}

/** Local observations never leave this database. Downloads are anonymous GETs to one operator-configured URL. */
export async function openModelGuideStore(path: string, options: { bundled?: ModelGuideCatalog; updateUrl?: string | null; fetch?: typeof fetch; now?: () => number } = {}) {
  const bundled = modelGuideCatalogSchema.parse(options.bundled ?? bundledCatalog);
  const configuredUrl = options.updateUrl === undefined ? bundled.updateUrl : options.updateUrl;
  const now = options.now ?? Date.now;
  const runtime = await openRuntimeSqliteDatabase(path);
  await chmod(path, 0o600);
  const sql = runtime.kind === "bun" ? {
    exec: (statement: string) => { runtime.sqlite.run(statement); },
    run: (statement: string, args: (string | number | null)[] = []) => { runtime.sqlite.query(statement).run(...args); },
    get: (statement: string, args: (string | number | null)[] = []): unknown => runtime.sqlite.query(statement).get(...args),
    all: (statement: string, args: (string | number | null)[] = []): unknown[] => runtime.sqlite.query(statement).all(...args),
  } : {
    exec: (statement: string) => { runtime.sqlite.exec(statement); },
    run: (statement: string, args: (string | number | null)[] = []) => { runtime.sqlite.prepare(statement).run(...args); },
    get: (statement: string, args: (string | number | null)[] = []): unknown => runtime.sqlite.prepare(statement).get(...args),
    all: (statement: string, args: (string | number | null)[] = []): unknown[] => runtime.sqlite.prepare(statement).all(...args),
  };
  sql.exec("PRAGMA journal_mode = WAL");
  sql.exec("PRAGMA busy_timeout = 5000");
  sql.exec("CREATE TABLE IF NOT EXISTS model_guide_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  sql.exec("CREATE TABLE IF NOT EXISTS model_guide_observations (scope TEXT NOT NULL, provider_id TEXT NOT NULL, model_id TEXT NOT NULL, data TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, available INTEGER NOT NULL, PRIMARY KEY(scope, provider_id, model_id))");
  sql.exec("CREATE TABLE IF NOT EXISTS model_guide_catalog_versions (revision INTEGER PRIMARY KEY, data TEXT NOT NULL, source TEXT NOT NULL, imported_at TEXT NOT NULL)");
  sql.exec("CREATE TABLE IF NOT EXISTS model_guide_observation_history (id INTEGER PRIMARY KEY, scope TEXT NOT NULL, provider_id TEXT NOT NULL, model_id TEXT NOT NULL, data TEXT NOT NULL, detected_at TEXT NOT NULL)");
  const rowSchema = guideObservationSchema.extend({ firstSeen: guideObservationSchema.shape.name, lastSeen: guideObservationSchema.shape.name, available: guideObservationSchema.shape.freeVerified });
  const value = (key: string): string | null => {
    const row = sql.get("SELECT value FROM model_guide_state WHERE key = ?", [key]);
    return row && typeof row === "object" && "value" in row && typeof row.value === "string" ? row.value : null;
  };
  const set = (key: string, data: string) => sql.run("INSERT INTO model_guide_state VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key, data]);
  const hashScope = (scope: string) => createHash("sha256").update(scope).digest("hex");
  const transaction = (work: () => void) => { sql.exec("BEGIN IMMEDIATE"); try { work(); sql.exec("COMMIT"); } catch (error) { sql.exec("ROLLBACK"); throw error; } };
  let catalog = bundled;
  const saved = value("catalog");
  if (saved) {
    try { const parsed = modelGuideCatalogSchema.parse(JSON.parse(saved)); if (parsed.revision > bundled.revision) catalog = parsed; } catch { /* Restore a valid shipped catalog after local corruption. */ }
  }
  if (catalog === bundled) transaction(() => { set("catalog", JSON.stringify(bundled)); set("source", "bundled"); set("updatedAt", new Date(now()).toISOString()); });
  sql.run("INSERT OR IGNORE INTO model_guide_catalog_versions VALUES (?, ?, ?, ?)", [catalog.revision, JSON.stringify(catalog), value("source") ?? "bundled", value("updatedAt") ?? bundled.publishedAt]);
  let inFlight: Promise<void> | null = null;
  const snapshot = (scope: string): GuideSnapshot => ({
    catalog,
    observations: sql.all("SELECT data, first_seen, last_seen, available FROM model_guide_observations WHERE scope=? ORDER BY provider_id, model_id", [hashScope(scope)]).flatMap(row => {
      if (!row || typeof row !== "object" || !("data" in row) || typeof row.data !== "string") return [];
      try {
        const parsed = rowSchema.safeParse({ ...JSON.parse(row.data), firstSeen: "first_seen" in row ? row.first_seen : null, lastSeen: "last_seen" in row ? row.last_seen : null, available: "available" in row && row.available === 1 });
        return parsed.success ? [parsed.data] : [];
      } catch { return []; }
    }),
    status: { source: value("source") === "remote" ? "remote" : "bundled", checkedAt: value("checkedAt"), updatedAt: value("updatedAt") ?? bundled.publishedAt, error: value("error"), remoteConfigured: Boolean(configuredUrl) },
  });
  const discover = (input: unknown) => {
    const parsed = guideDiscoverySchema.parse(input); const date = new Date(now()).toISOString(); const scope = hashScope(parsed.scope);
    transaction(() => {
      sql.run("UPDATE model_guide_observations SET available=0 WHERE scope=?", [scope]);
      for (const model of parsed.models) {
        const data = JSON.stringify(model);
        const previous = sql.get("SELECT data FROM model_guide_observations WHERE scope=? AND provider_id=? AND model_id=?", [scope, model.providerID, model.modelID]);
        if (!previous || typeof previous !== "object" || !("data" in previous) || previous.data !== data) sql.run("INSERT INTO model_guide_observation_history (scope, provider_id, model_id, data, detected_at) VALUES (?, ?, ?, ?, ?)", [scope, model.providerID, model.modelID, data, date]);
        sql.run("INSERT INTO model_guide_observations VALUES (?, ?, ?, ?, ?, ?, 1) ON CONFLICT(scope, provider_id, model_id) DO UPDATE SET data=excluded.data, last_seen=excluded.last_seen, available=1", [scope, model.providerID, model.modelID, data, date, date]);
      }
    });
    return snapshot(parsed.scope);
  };
  async function download() {
    if (!configuredUrl) return;
    const checked = new Date(now()).toISOString();
    try {
      const url = validateUpdateUrl(configuredUrl);
      const response = await (options.fetch ?? fetch)(url, { signal: AbortSignal.timeout(8000), redirect: "error", credentials: "omit", headers: { Accept: "application/json" } });
      if (!response.ok || !response.body) throw new Error("Catálogo remoto no disponible.");
      if (Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("El catálogo excede el tamaño permitido.");
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
      try { for (;;) { const { done, value: chunk } = await reader.read(); if (done) break; bytes += chunk.byteLength; if (bytes > MAX_BYTES) throw new Error("El catálogo excede el tamaño permitido."); chunks.push(chunk); } }
      finally { await reader.cancel().catch(() => undefined); }
      const next = modelGuideCatalogSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      if (new Date(next.publishedAt).getTime() > now() + DAY) throw new Error("La fecha del catálogo es inválida.");
      if (next.revision < catalog.revision) throw new Error("Se conservó el catálogo más reciente.");
      if (next.revision === catalog.revision && JSON.stringify(next) !== JSON.stringify(catalog)) throw new Error("Incrementá la revisión para publicar cambios.");
      if (next.revision > catalog.revision) {
        transaction(() => { set("catalog", JSON.stringify(next)); set("source", "remote"); set("updatedAt", checked); sql.run("INSERT INTO model_guide_catalog_versions VALUES (?, ?, ?, ?)", [next.revision, JSON.stringify(next), "remote", checked]); });
        catalog = next;
      }
      transaction(() => { set("checkedAt", checked); sql.run("DELETE FROM model_guide_state WHERE key='error'"); });
    } catch (error) {
      transaction(() => { set("checkedAt", checked); set("error", error instanceof Error && error.message.startsWith("La URL") ? error.message : "No se pudo actualizar el catálogo. Se conserva la última versión válida."); });
    }
  }
  const refresh = (force = false): Promise<void> => {
    if (inFlight) return inFlight;
    const last = Date.parse(value("checkedAt") ?? "");
    if (!configuredUrl || (!force && Number.isFinite(last) && now() - last < DAY)) return Promise.resolve();
    inFlight = download().finally(() => { inFlight = null; });
    return inFlight;
  };
  return { snapshot, discover, refresh, close: runtime.close };
}

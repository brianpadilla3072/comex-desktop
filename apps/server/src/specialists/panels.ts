import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { specialistDirectory } from "./store.js";
import { listDatasets, readLatestSnapshot } from "./datasets.js";
import { statOrNull } from "./digest.js";
import type { ServerConfig } from "../types.js";

/** Declarative data panels ([3] del plan): a spec file per application that the app renders
 *  over a dataset or a workspace file. Deterministic render — the panel never runs AI-authored
 *  code and never queries sources itself; it reads what datasets already saved. Storage lives
 *  beside the library (specialists/<app>/panels/); resolution happens per project so each
 *  project paints its own snapshots. */

const PANEL_LIMIT = 20;
const SPEC_LIMIT = 64 * 1024;
const DATA_LIMIT = 2 * 1024 * 1024;

const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("stat"), field: z.string().min(1).max(120), agg: z.enum(["last", "first", "sum", "avg", "count", "min", "max"]).default("last"), title: z.string().max(120).optional(), format: z.enum(["number", "percent", "currency"]).optional() }),
  z.object({ type: z.literal("line"), x: z.string().min(1).max(120), y: z.array(z.string().min(1).max(120)).min(1).max(8), title: z.string().max(120).optional() }),
  z.object({ type: z.literal("bar"), x: z.string().min(1).max(120), y: z.array(z.string().min(1).max(120)).min(1).max(8), title: z.string().max(120).optional() }),
  z.object({ type: z.literal("table"), limit: z.number().int().min(1).max(500).default(50), sort: z.object({ by: z.string().min(1).max(120), desc: z.boolean().default(false) }).optional(), columns: z.array(z.string().min(1).max(120)).max(40).optional() }),
  z.object({ type: z.literal("markdown"), text: z.string().min(1).max(2000) }),
]);

/** The authored part of a panel (what a person or the AI sends); `panel` is set from the file name. */
export const panelBodySchema = z.object({
  title: z.string().min(1).max(200),
  source: z.union([
    z.object({ dataset: z.string().min(1).max(120) }),
    z.object({ file: z.string().min(1).max(500) }),
  ]),
  blocks: z.array(blockSchema).min(1).max(12),
});

export const panelSpecSchema = panelBodySchema.extend({ panel: z.string().min(1).max(64) });
export type SpecialistPanelSpec = z.infer<typeof panelSpecSchema>;

export const panelNameSchema = z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "kebab-case").max(64);

const failure = (message: string) => new ApiError(422, "invalid_panel", message);
const panelsRoot = (config: Pick<ServerConfig, "configPath">, id: string) => join(specialistDirectory(config), id, "panels");
const panelPath = (config: Pick<ServerConfig, "configPath">, id: string, name: string) => join(panelsRoot(config, id), `${name}.panel.json`);

export type SpecialistPanelEntry = { name: string; title: string; source: string; updatedAt: number; bytes: number };

export async function listPanels(config: Pick<ServerConfig, "configPath">, id: string): Promise<SpecialistPanelEntry[]> {
  let names: string[] = [];
  try { const { readdir } = await import("node:fs/promises"); names = (await readdir(panelsRoot(config, id))).filter(name => name.endsWith(".panel.json")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const entries = await Promise.all(names.map(async name => {
    const file = join(panelsRoot(config, id), name);
    try {
      const [info, raw] = await Promise.all([stat(file), readFile(file, "utf8")]);
      const spec = panelSpecSchema.safeParse(JSON.parse(raw));
      return {
        name: name.slice(0, -".panel.json".length),
        title: spec.success ? spec.data.title : "(inválido)",
        source: spec.success ? ("dataset" in spec.data.source ? `dataset:${spec.data.source.dataset}` : `file:${spec.data.source.file}`) : "?",
        updatedAt: info.mtimeMs, bytes: info.size,
      };
    } catch { return { name: name.slice(0, -".panel.json".length), title: "(ilegible)", source: "?", updatedAt: 0, bytes: 0 }; }
  }));
  return entries.sort((left, right) => right.updatedAt - left.updatedAt);
}

const parsePanelName = (name: string) => {
  const parsed = panelNameSchema.safeParse(name);
  if (!parsed.success) throw failure("El nombre del panel debe ser kebab-case (minúsculas, números y guiones).");
  return parsed.data;
};

export async function readPanelSpec(config: Pick<ServerConfig, "configPath">, id: string, name: string) {
  const parsed = parsePanelName(name);
  const raw = await readFile(panelPath(config, id, parsed), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw new ApiError(404, "panel_not_found", "Ese panel no existe.");
    throw error;
  });
  const spec = panelSpecSchema.safeParse(JSON.parse(raw));
  if (!spec.success) throw failure("El panel guardado no valida contra el esquema; reescribilo.");
  return spec.data;
}

export async function writePanel(config: Pick<ServerConfig, "configPath">, id: string, name: string, specInput: unknown) {
  const parsed = parsePanelName(name);
  const file = panelPath(config, id, parsed);
  const existing = await statOrNull(file);
  if (Buffer.byteLength(JSON.stringify(specInput)) > SPEC_LIMIT) throw failure("La especificación del panel supera 64 KB.");
  const spec = panelBodySchema.safeParse(specInput);
  if (!spec.success) throw failure("Revisá title, source (dataset o file) y blocks (stat|line|bar|table|markdown).");
  const panels = await listPanels(config, id);
  if (!existing && panels.length >= PANEL_LIMIT) throw new ApiError(409, "panel_limit", `Hay ${PANEL_LIMIT} paneles; borrá alguno antes de crear otro.`);
  const final = { ...spec.data, panel: parsed };
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(final, null, 2), { mode: 0o600 });
  await rename(temporary, file);
  return { name: parsed, spec: final, created: !existing };
}

export async function deletePanel(config: Pick<ServerConfig, "configPath">, id: string, name: string) {
  const parsed = parsePanelName(name);
  const file = panelPath(config, id, parsed);
  if (!(await statOrNull(file))) throw new ApiError(404, "panel_not_found", "Ese panel no existe.");
  await rm(file, { force: true });
  return parsed;
}

export type PanelResolution =
  | { ok: true; spec: SpecialistPanelSpec; data: unknown; sourceLabel: string }
  | { ok: false; error: string; spec?: SpecialistPanelSpec };

/** Resolve a panel against ONE project: datasets via their LATEST snapshot, files by relative
 *  path inside the project. Failures are loud and specific ([3]: nunca pantalla blanca). */
export async function resolvePanel(config: Pick<ServerConfig, "configPath">, id: string, name: string, directory: string): Promise<PanelResolution> {
  let spec: SpecialistPanelSpec;
  try { spec = await readPanelSpec(config, id, name); }
  catch (error) { return { ok: false, error: error instanceof ApiError ? error.message : "El panel no se pudo leer." }; }
  if ("dataset" in spec.source) {
    const wanted = spec.source.dataset;
    const datasets = await listDatasets(directory).catch(() => []);
    const match = datasets.find(entry => entry.id === wanted || entry.name === wanted);
    if (!match) return { ok: false, spec, error: `El dataset "${wanted}" no existe en este proyecto.` };
    if (match.lastSnapshotAt === null) return { ok: false, spec, error: `El dataset "${match.name}" nunca tuvo una corrida.` };
    try {
      const data = await readLatestSnapshot(directory, match.id);
      return { ok: true, spec, data, sourceLabel: `dataset:${match.id}` };
    } catch {
      return { ok: false, spec, error: "El snapshot del dataset está dañado." };
    }
  }
  const target = resolve(directory, spec.source.file);
  if (!target.startsWith(resolve(directory) + "/")) return { ok: false, spec, error: "La ruta del archivo sale del proyecto." };
  const info = await statOrNull(target);
  if (!info || !info.isFile()) return { ok: false, spec, error: `El archivo "${spec.source.file}" no existe en este proyecto.` };
  if (info.size > DATA_LIMIT) return { ok: false, spec, error: `El archivo supera 2 MB; achicalo o derivá un dataset.` };
  const raw = await readFile(target, "utf8").catch(() => null);
  if (raw === null) return { ok: false, spec, error: "El archivo no se pudo leer como texto." };
  const data = spec.source.file.endsWith(".json") ? (JSON.parse(raw) as unknown) : raw;
  return { ok: true, spec, data, sourceLabel: `file:${spec.source.file}` };
}

/** Extract one rows-array out of a payload that panels can plot. Tolerant: arrays pass, records
 *  with a single object-array field use it (typical provider shapes). */
export function panelRows(data: unknown): { rows: Array<Record<string, unknown>>; error?: string } {
  if (Array.isArray(data) && data.every(entry => typeof entry === "object" && entry !== null && !Array.isArray(entry))) {
    return { rows: data as Array<Record<string, unknown>> };
  }
  if (typeof data === "object" && data !== null) {
    const record = data as Record<string, unknown>;
    for (const value of Object.values(record)) {
      const nested = panelRows(value);
      if (nested.rows.length) return nested;
    }
  }
  return { rows: [], error: "Los datos no tienen forma de tabla (array de objetos)." };
}

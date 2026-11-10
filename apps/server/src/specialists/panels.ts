import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { specialistDirectory } from "./store.js";
import { listDatasets, readLatestDiff, readLatestSnapshot } from "./datasets.js";
import { statOrNull } from "./digest.js";
import type { ServerConfig } from "../types.js";

/** Declarative data panels ([3] del plan): a spec file per application that the app renders
 *  over a dataset or a workspace file. Deterministic render — the panel never runs AI-authored
 *  code and never queries sources itself; it reads what datasets already saved. Storage lives
 *  beside the library (specialists/<app>/panels/); resolution happens per project so each
 *  project paints its own snapshots. Mutations are serialized per application (same doctrine
 *  as tasks.ts: the awaits between read and write are where concurrency would lose updates). */

const PANEL_LIMIT = 20;
const SPEC_LIMIT = 64 * 1024;
const DATA_LIMIT = 2 * 1024 * 1024;

const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("stat"), field: z.string().min(1).max(120), agg: z.enum(["last", "first", "sum", "avg", "count", "min", "max"]).default("last"), title: z.string().max(120).optional(), format: z.enum(["number", "percent", "currency"]).optional() }).strict(),
  z.object({ type: z.literal("line"), x: z.string().min(1).max(120), y: z.array(z.string().min(1).max(120)).min(1).max(8), title: z.string().max(120).optional() }).strict(),
  z.object({ type: z.literal("bar"), x: z.string().min(1).max(120), y: z.array(z.string().min(1).max(120)).min(1).max(8), title: z.string().max(120).optional() }).strict(),
  z.object({ type: z.literal("table"), limit: z.number().int().min(1).max(500).default(50), sort: z.object({ by: z.string().min(1).max(120), desc: z.boolean().default(false) }).optional(), columns: z.array(z.string().min(1).max(120)).max(40).optional() }).strict(),
  z.object({ type: z.literal("markdown"), text: z.string().min(1).max(2000) }).strict(),
  z.object({ type: z.literal("changes"), title: z.string().max(120).optional() }).strict(),
]);

/** The authored part of a panel (what a person or the AI sends); `panel` is set from the file
 *  name. STRICT on purpose: an unknown field (a typo, or a future option the local app does
 *  not render yet) fails loudly instead of being silently dropped by zod. */
export const panelBodySchema = z.object({
  title: z.string().min(1).max(200),
  source: z.union([
    z.object({ dataset: z.string().min(1).max(120) }),
    z.object({ file: z.string().min(1).max(500) }),
  ]),
  /** Live repaint when the source snapshot changes (the renderer's watch contract). */
  refresh: z.object({ watch: z.literal("latest") }).optional(),
  blocks: z.array(blockSchema).min(1).max(12),
}).strict();

export const panelSpecSchema = panelBodySchema.extend({ panel: z.string().min(1).max(64) });
export type SpecialistPanelSpec = z.infer<typeof panelSpecSchema>;

export const panelNameSchema = z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "kebab-case").max(64);

const failure = (message: string) => new ApiError(422, "invalid_panel", message);

/** Zod, in the words of the person reading the chat: which field, and what is wrong with it. */
function panelIssues(error: z.ZodError): string {
  return error.issues.slice(0, 6).map(issue => {
    const path = issue.path.length ? issue.path.join(".") : "la raíz";
    if (issue.code === "unrecognized_keys") return `${path} tiene campos que no van (${issue.keys.join(", ")})`;
    if (issue.code === "invalid_type") return `${path} debería ser ${issue.expected}`;
    return `${path}: ${issue.message}`;
  }).join("; ");
}
const panelsRoot = (config: Pick<ServerConfig, "configPath">, id: string) => join(specialistDirectory(config), id, "panels");
const panelPath = (config: Pick<ServerConfig, "configPath">, id: string, name: string) => join(panelsRoot(config, id), `${name}.panel.json`);

const chains = new Map<string, Promise<unknown>>();
function serialize<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  const current = previous.then(work, work);
  chains.set(key, current.then(() => undefined, () => undefined));
  return current;
}

export type SpecialistPanelEntry = { name: string; title: string; source: string; updatedAt: number; bytes: number };

/** Lists every spec (budget: PANEL_LIMIT × SPEC_LIMIT ≈ 1.3 MB worst case, read in parallel;
 *  an index.json like datasets.ts is the natural upgrade if limits grow an order). */
export async function listPanels(config: Pick<ServerConfig, "configPath">, id: string): Promise<SpecialistPanelEntry[]> {
  let names: string[] = [];
  try { names = (await readdir(panelsRoot(config, id))).filter(name => name.endsWith(".panel.json")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const entries = await Promise.all(names.map(async name => {
    const file = join(panelsRoot(config, id), name);
    try {
      const info = await stat(file);
      if (!info.isFile()) return null; // never follow a symlinked panel into an unread entry
      const raw = await readFile(file, "utf8");
      let parsed: unknown = null;
      try { parsed = JSON.parse(raw); } catch { /* ilegible → "(ilegible)" abajo */ }
      let title = "(ilegible)";
      let source = "?";
      if (parsed !== null) {
        const spec = panelSpecSchema.safeParse(parsed);
        if (spec.success) {
          title = spec.data.title;
          source = "dataset" in spec.data.source ? `dataset:${spec.data.source.dataset}` : `file:${spec.data.source.file}`;
        } else title = "(inválido)";
      }
      return { name: name.slice(0, -".panel.json".length), title, source, updatedAt: info.mtimeMs, bytes: info.size };
    } catch { return { name: name.slice(0, -".panel.json".length), title: "(ilegible)", source: "?", updatedAt: 0, bytes: 0 }; }
  }));
  return entries.filter((entry): entry is SpecialistPanelEntry => entry !== null).sort((left, right) => right.updatedAt - left.updatedAt);
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
  let payload: unknown;
  try { payload = JSON.parse(raw); }
  catch { throw failure("El panel guardado está dañado (no es JSON); reescribilo."); }
  const spec = panelSpecSchema.safeParse(payload);
  if (!spec.success) throw failure(`El panel guardado no valida contra el esquema: ${panelIssues(spec.error)}. Reescribilo.`);
  return spec.data;
}

export async function writePanel(config: Pick<ServerConfig, "configPath">, id: string, name: string, specInput: unknown) {
  const parsed = parsePanelName(name);
  if (Buffer.byteLength(JSON.stringify(specInput)) > SPEC_LIMIT) throw failure("La especificación del panel supera 64 KB.");
  const spec = panelBodySchema.safeParse(specInput);
  // Name the exact failing path: a generic "revisá el esquema" made a model rewrite the same
  // broken spec four times, and would leave a person guessing which field is wrong.
  if (!spec.success) throw failure(`Revisá el panel: ${panelIssues(spec.error)}. Los campos válidos son title, source {dataset|file}, refresh y blocks (stat|line|bar|table|markdown|changes).`);
  return serialize(id, async () => {
    const file = panelPath(config, id, parsed);
    const existing = await statOrNull(file);
    if (!existing) {
      const names = await readdir(panelsRoot(config, id)).catch(() => [] as string[]);
      if (names.filter(name => name.endsWith(".panel.json")).length >= PANEL_LIMIT) {
        throw new ApiError(409, "panel_limit", `Hay ${PANEL_LIMIT} paneles; borrá alguno antes de crear otro.`);
      }
    }
    const final = { ...spec.data, panel: parsed };
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(final, null, 2), { mode: 0o600 });
    await rename(temporary, file);
    return { name: parsed, spec: final, created: !existing };
  });
}

export async function deletePanel(config: Pick<ServerConfig, "configPath">, id: string, name: string) {
  const parsed = parsePanelName(name);
  return serialize(id, async () => {
    const file = panelPath(config, id, parsed);
    if (!(await statOrNull(file))) throw new ApiError(404, "panel_not_found", "Ese panel no existe.");
    await rm(file, { force: true });
    return parsed;
  });
}

export type PanelResolution =
  | { ok: true; spec: SpecialistPanelSpec; data: unknown; sourceLabel: string; diff: unknown }
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
      // The "cambios" block reads the latest F2 diff of this dataset (null = no refresh yet).
      const diff = await readLatestDiff(directory, match.id).catch(() => null);
      return { ok: true, spec, data, sourceLabel: `dataset:${match.id}`, diff };
    } catch {
      return { ok: false, spec, error: "El snapshot del dataset está dañado." };
    }
  }
  // Lexical containment that is correct on every OS, then physical containment: an intermediate
  // directory symlink (datos -> /etc) must not smuggle the read outside the project.
  const root = resolve(directory);
  const target = resolve(root, spec.source.file);
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return { ok: false, spec, error: "La ruta del archivo sale del proyecto." };
  const realRoot = await realpath(root).catch(() => null);
  const realTarget = await realpath(target).catch(() => null);
  if (realRoot === null || realTarget === null) return { ok: false, spec, error: `El archivo "${spec.source.file}" no existe en este proyecto.` };
  const realRel = relative(realRoot, realTarget);
  if (!realRel || realRel.startsWith("..") || isAbsolute(realRel)) return { ok: false, spec, error: "La ruta del archivo sale del proyecto (enlace simbólico intermedio)." };
  const info = await statOrNull(realTarget);
  if (!info || !info.isFile()) return { ok: false, spec, error: `El archivo "${spec.source.file}" no es un archivo regular.` };
  if (info.size > DATA_LIMIT) return { ok: false, spec, error: `El archivo supera 2 MB; achicalo o derivá un dataset.` };
  const raw = await readFile(realTarget, "utf8").catch(() => null);
  if (raw === null) return { ok: false, spec, error: "El archivo no se pudo leer como texto." };
  if (/\.json$/i.test(spec.source.file)) {
    try { return { ok: true, spec, data: JSON.parse(raw) as unknown, sourceLabel: `file:${spec.source.file}`, diff: null }; }
    catch { return { ok: false, spec, error: "El archivo .json no es JSON válido." }; }
  }
  // A CSV in the project is the everyday case outside research (a measurement sheet, a content
  // calendar, a stock list). Returned as raw text, every block failed with "los datos no tienen
  // forma de tabla" even though the table was right there.
  if (/\.(csv|tsv)$/i.test(spec.source.file)) {
    const rows = parseDelimited(raw);
    if (!rows.length) return { ok: false, spec, error: `El archivo ${spec.source.file} no tiene filas con encabezado para dibujar.` };
    return { ok: true, spec, data: rows, sourceLabel: `file:${spec.source.file}`, diff: null };
  }
  return { ok: true, spec, data: raw, sourceLabel: `file:${spec.source.file}`, diff: null };
}

/** One row per line, header as keys. Handles quoted fields (a comma inside a cell), CRLF and the
 *  semicolon/tab dialects exported by spreadsheets. Numbers stay numbers so stat/avg work, except
 *  codes with a leading zero ("007"), which would silently change meaning. */
export function parseDelimited(text: string): Array<Record<string, unknown>> {
  const body = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n").filter(line => line.trim() !== "");
  if (body.length < 2) return [];
  const headerLine = body[0]!;
  const delimiter = ["\t", ";", ","].map(candidate => ({ candidate, count: (headerLine.match(new RegExp(candidate === "\t" ? "\\t" : `\\${candidate}`, "g")) ?? []).length })).sort((left, right) => right.count - left.count)[0]!;
  if (!delimiter.count) return [];
  const split = (line: string) => {
    const cells: string[] = [];
    let current = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index]!;
      if (quoted) {
        if (char === '"' && line[index + 1] === '"') { current += '"'; index += 1; }
        else if (char === '"') quoted = false;
        else current += char;
        continue;
      }
      if (char === '"' && !current.trim()) { quoted = true; continue; }
      if (char === delimiter.candidate) { cells.push(current.trim()); current = ""; continue; }
      current += char;
    }
    cells.push(current.trim());
    return cells;
  };
  const header = split(headerLine);
  const rows: Array<Record<string, unknown>> = [];
  for (const line of body.slice(1)) {
    const cells = split(line);
    const row: Record<string, unknown> = {};
    header.forEach((key, index) => {
      const value = cells[index] ?? "";
      row[key] = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) ? Number(value) : value;
    });
    rows.push(row);
  }
  return rows;
}

/** Extract one rows-array out of a payload that panels can plot. Tolerant: the FIRST object
 *  array found (arrays pass directly; records are searched breadth-first in key order). */
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

/** The ONE aggregation semantics the app renderer and the future ui:// compiler must share —
 *  exported pure so the two implementations can never diverge ([3]/[4] determinism rule).
 *  MUST MATCH apps/app library-dialog.tsx panelAggregate: change both together. */
export function panelAggregate(rows: Array<Record<string, unknown>>, field: string, agg: "last" | "first" | "sum" | "avg" | "count" | "min" | "max"): number | string | null {
  const column = rows.map(row => row[field]);
  if (agg === "count") return column.length;
  // last/first pass scalars only: an object/array renders "—" downstream, never a crash.
  if (agg === "last") { const value = column.at(-1); return typeof value === "number" || typeof value === "string" ? value : null; }
  if (agg === "first") { const value = column[0]; return typeof value === "number" || typeof value === "string" ? value : null; }
  const numbers = column.map(entry => typeof entry === "number" ? entry : typeof entry === "string" && entry.trim() !== "" && Number.isFinite(Number(entry)) ? Number(entry) : null).filter((entry): entry is number => entry !== null);
  if (!numbers.length) return null; // non-numeric column: null renders as "—" (loud in the UI, never a fabricated 0)
  if (agg === "sum") return numbers.reduce((total, value) => total + value, 0);
  if (agg === "avg") return numbers.reduce((total, value) => total + value, 0) / numbers.length;
  if (agg === "min") return Math.min(...numbers);
  return Math.max(...numbers);
}

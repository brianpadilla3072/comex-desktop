import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";

/** Datasets give research queries an identity: the query is stored as data so it can be
 *  re-run (by a person, a task or the scheduler) and each execution leaves an immutable snapshot.
 *  Everything lives as files inside the workspace: comex/datasets/<id>/. */

const DATASET_LIMIT = 60;
const SNAPSHOT_LIMIT = 50;

export const datasetMetaSchema = z.object({
  id: z.string(),
  name: z.string(),
  question: z.string(),
  provider: z.string(),
  operation: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastSnapshotAt: z.number().nullable(),
  snapshots: z.number().int().nonnegative(),
  /** When this dataset was derived by cleaning another one, the source id. */
  derivedFrom: z.string().nullable().default(null),
});
export type SpecialistDatasetMeta = z.infer<typeof datasetMetaSchema>;

export const datasetQuerySchema = z.object({
  provider: z.string(),
  operation: z.string(),
  input: z.record(z.string(), z.unknown()),
});
export type SpecialistDatasetQuery = z.infer<typeof datasetQuerySchema>;

const failure = (message: string) => new ApiError(422, "invalid_dataset", message);

const datasetsRoot = (directory: string) => join(directory, "comex", "datasets");
const datasetDir = (directory: string, id: string) => {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) throw failure("El id del dataset no es válido.");
  return join(datasetsRoot(directory), id);
};

/** Same symlink hardening as the research evidence folder: never follow, never trust a link. */
async function ensureFolder(path: string) {
  await mkdir(path, { recursive: true });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure("La carpeta de datasets no puede ser un enlace simbólico.");
  return path;
}

async function readIndex(directory: string): Promise<SpecialistDatasetMeta[]> {
  try {
    const value: unknown = JSON.parse(await readFile(join(datasetsRoot(directory), "index.json"), "utf8"));
    if (!Array.isArray(value)) return [];
    return value.flatMap(entry => { try { return [datasetMetaSchema.parse(entry)]; } catch { return []; } });
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

async function writeIndex(directory: string, datasets: SpecialistDatasetMeta[]) {
  await ensureFolder(datasetsRoot(directory));
  const file = join(datasetsRoot(directory), "index.json");
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(datasets, null, 2), { mode: 0o600 });
  await rename(temporary, file);
}

export async function listDatasets(directory: string) {
  return readIndex(directory);
}

const slugify = (value: string) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

const sameQuery = (left: SpecialistDatasetQuery, right: SpecialistDatasetQuery) =>
  left.provider === right.provider && left.operation === right.operation && JSON.stringify(left.input) === JSON.stringify(right.input);

/** Register one execution. Returns the dataset it belongs to; creates it the first time the exact query appears. */
export async function recordDatasetRun(directory: string, query: SpecialistDatasetQuery, evidencePath: string) {
  await ensureFolder(datasetsRoot(directory));
  const datasets = await readIndex(directory);
  const queries = new Map<string, SpecialistDatasetQuery>();
  for (const meta of datasets) {
    try { queries.set(meta.id, datasetQuerySchema.parse(JSON.parse(await readFile(join(datasetDir(directory, meta.id), "query.json"), "utf8")))); }
    catch { /* a dataset without a readable query stays in the list but never matches */ }
  }
  let meta = datasets.find(entry => { const value = queries.get(entry.id); return value !== undefined && sameQuery(value, query); });
  const id = meta?.id ?? `ds-${slugify(`${query.operation}-${(query.input as { query?: string; url?: string }).query ?? (query.input as { query?: string; url?: string }).url ?? "consulta"}`) || "consulta"}-${randomUUID().slice(0, 8)}`;
  const dir = await ensureFolder(datasetDir(directory, id));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snapshotFile = join(dir, "snapshots");
  await ensureFolder(snapshotFile);
  await cp(join(directory, evidencePath), join(snapshotFile, `${stamp}.json`));
  const now = Date.now();
  // Retention: keep the newest SNAPSHOT_LIMIT, remove the rest.
  const entries = (await readdir(snapshotFile)).filter(name => name.endsWith(".json")).sort();
  for (const name of entries.slice(0, Math.max(0, entries.length - SNAPSHOT_LIMIT))) await rm(join(snapshotFile, name), { force: true });
  await writeFile(join(dir, "LATEST"), `${stamp}.json\n`, { mode: 0o600 });
  const question = typeof (query.input as { query?: string }).query === "string" ? String((query.input as { query?: string }).query) : typeof (query.input as { url?: string }).url === "string" ? String((query.input as { url?: string }).url) : query.operation;
  if (!meta) {
    if (datasets.length >= DATASET_LIMIT) throw new ApiError(409, "dataset_limit", `Hay ${DATASET_LIMIT} datasets; depurá antes de registrar otro.`);
    meta = { id, name: id.replace(/^ds-/, "").replace(/-[a-z0-9]{8}$/, ""), question, provider: query.provider, operation: query.operation, createdAt: now, updatedAt: now, lastSnapshotAt: now, snapshots: 1, derivedFrom: null };
    await writeFile(join(dir, "dataset.json"), JSON.stringify(meta, null, 2), { mode: 0o600 });
    await writeFile(join(dir, "query.json"), JSON.stringify(query, null, 2), { mode: 0o600 });
    await writeIndex(directory, [meta, ...datasets]);
  } else {
    const next = { ...meta, updatedAt: now, lastSnapshotAt: now, snapshots: Math.min(SNAPSHOT_LIMIT, entries.length) };
    meta = next;
    await writeFile(join(dir, "dataset.json"), JSON.stringify(next, null, 2), { mode: 0o600 });
    await writeIndex(directory, datasets.map(entry => entry.id === next.id ? next : entry));
  }
  return { dataset: meta, created: queries.get(meta.id) === undefined };
}

export async function readDatasetQuery(directory: string, id: string) {
  return datasetQuerySchema.parse(JSON.parse(await readFile(join(datasetDir(directory, id), "query.json"), "utf8")));
}

export async function readLatestSnapshot(directory: string, id: string) {
  const dir = datasetDir(directory, id);
  const name = (await readFile(join(dir, "LATEST"), "utf8")).trim();
  if (!/^[0-9TZ.-]+\.json$/.test(name)) throw failure("El puntero LATEST del dataset está corrupto.");
  return JSON.parse(await readFile(join(dir, "snapshots", name), "utf8")) as unknown;
}

export async function listSnapshotDates(directory: string, id: string) {
  const dir = datasetDir(directory, id);
  try { return (await readdir(join(dir, "snapshots"))).filter(name => name.endsWith(".json")).sort().reverse(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

/** Re-run the stored query. The runner is injected so datasets never import providers directly. */
export async function refreshDataset(directory: string, id: string, run: (query: SpecialistDatasetQuery) => Promise<{ evidencePath: string }>) {
  const query = await readDatasetQuery(directory, id);
  const { evidencePath } = await run(query);
  return recordDatasetRun(directory, query, evidencePath);
}

export async function deleteDataset(directory: string, id: string) {
  const datasets = await readIndex(directory);
  if (!datasets.some(entry => entry.id === id)) throw new ApiError(404, "dataset_not_found", "Ese dataset no existe.");
  await rm(datasetDir(directory, id), { recursive: true, force: true });
  await writeIndex(directory, datasets.filter(entry => entry.id !== id));
}

/** A cleaned/transformed view of a source dataset: no re-runnable query (the derivation is the
 *  script the person's agent keeps in the project), one snapshot per regeneration, lineage kept. */
export async function registerDerivedDataset(directory: string, sourceId: string, name: string, payload: unknown) {
  const datasets = await readIndex(directory);
  const source = datasets.find(entry => entry.id === sourceId);
  if (!source) throw new ApiError(404, "dataset_not_found", "El dataset de origen no existe.");
  const slug = slugify(name);
  if (!slug) throw failure("Dale un nombre legible al dataset derivado.");
  const id = `ds-${slug}-${randomUUID().slice(0, 8)}`;
  if (datasets.length >= DATASET_LIMIT) throw new ApiError(409, "dataset_limit", `Hay ${DATASET_LIMIT} datasets; depurá antes de registrar otro.`);
  const dir = datasetDir(directory, id);
  const snapshotFolder = await ensureFolder(join(dir, "snapshots"));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await writeFile(join(snapshotFolder, `${stamp}.json`), JSON.stringify(payload), { mode: 0o600 });
  await writeFile(join(dir, "LATEST"), `${stamp}.json\n`, { mode: 0o600 });
  const meta: SpecialistDatasetMeta = {
    id, name: slug, question: `Derivado de ${source.question}`, provider: "local", operation: "derived",
    createdAt: Date.now(), updatedAt: Date.now(), lastSnapshotAt: Date.now(), snapshots: 1, derivedFrom: sourceId,
  };
  await writeFile(join(dir, "dataset.json"), JSON.stringify(meta, null, 2), { mode: 0o600 });
  await writeIndex(directory, [meta, ...datasets]);
  return meta;
}

/** The dataset a query belongs to, without registering a run (read-side lookup). */
export async function findDatasetForQuery(directory: string, query: SpecialistDatasetQuery) {
  const datasets = await readIndex(directory);
  for (const meta of datasets) {
    try { if (sameQuery(datasetQuerySchema.parse(JSON.parse(await readFile(join(datasetDir(directory, meta.id), "query.json"), "utf8"))), query)) return meta; }
    catch { /* unreadable query: skip like recordDatasetRun does */ }
  }
  return null;
}

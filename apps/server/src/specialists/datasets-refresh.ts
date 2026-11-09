import { ApiError } from "../errors.js";
import { diffSnapshots } from "./diffs.js";
import { findDatasetForQuery, listDatasets, readDatasetQuery, readLatestSnapshot, writeDatasetDiff, type SpecialistDatasetMeta } from "./datasets.js";
import { createResearchProvider, executeTavily, isResearchOperation } from "./integrations/research-factory.js";
import type { ServerConfig } from "../types.js";

/** Re-run a stored dataset query through the same research path that recorded it, so a person,
 *  a task or the chat refresh button all leave an identical snapshot. executeTavily already records
 *  the run; the dataset is re-read (never re-recorded here). The provider import lives in this file
 *  so datasets.ts stays runner-agnostic. If the provider isn't ready the error bubbles: the refresh
 *  fails out loud and never invents data. */
export async function refreshDatasetThroughResearch(config: Pick<ServerConfig, "configPath">, directory: string, id: string, signal?: AbortSignal): Promise<SpecialistDatasetMeta> {
  const known = (await listDatasets(directory)).find(entry => entry.id === id);
  if (!known) throw new ApiError(404, "dataset_not_found", "Ese dataset no existe.");
  // Only queries captured from Tavily can re-run; derived and local datasets have no query to repeat.
  if (known.provider !== "tavily" || !isResearchOperation(known.operation)) {
    throw new ApiError(409, "dataset_not_rerunnable", "Este dataset no se puede volver a ejecutar: solo los que nacieron de una consulta de investigación con Tavily admiten refresh.");
  }
  let query;
  try { query = await readDatasetQuery(directory, id); }
  catch { throw new ApiError(409, "dataset_not_rerunnable", "Este dataset no tiene una consulta guardada que se pueda volver a ejecutar."); }
  if (query.provider !== "tavily" || !isResearchOperation(query.operation)) {
    throw new ApiError(409, "dataset_not_rerunnable", "La consulta guardada no corresponde a una investigación con Tavily que se pueda repetir.");
  }
  // Snapshot BEFORE the provider runs: F2 diffs before/after, and recordDatasetRun (inside
  // executeTavily) moves LATEST, so after the call only the new snapshot exists.
  const beforeSnapshot = known.lastSnapshotAt === null ? undefined : await readLatestSnapshot(directory, id).catch(() => undefined);
  let result: Awaited<ReturnType<typeof executeTavily>>;
  try {
    const runtime = await createResearchProvider("tavily", config).runtime();
    result = await executeTavily(runtime, query.operation, query.input, directory, signal);
  } catch (error) {
    // Honest provider failures must reach the person as a readable 502 — never a 500 "Unexpected server error".
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, "dataset_refresh_provider", error instanceof Error ? error.message : "El proveedor de investigación no está disponible; conectalo desde Herramientas y fuentes.");
  }
  // Trust the dataset the capture itself recorded; re-matching the raw stored query could
  // silently point at (or create) a different dataset when query.json drifted from canonical.
  const refreshed = result.dataset ? (await listDatasets(directory)).find(entry => entry.id === result.dataset?.id) : await findDatasetForQuery(directory, query);
  if (!refreshed) throw new ApiError(502, "dataset_refresh_failed", "La consulta corrió pero no quedó registrada como dataset. Revisá el disco del proyecto.");
  // A periodic refresh is only a story if it says what changed (F2): diff previous and current
  // snapshots into comex/datasets/<id>/diffs/<stamp>.json. Best-effort — the refresh never fails for diagnostics.
  try {
    const afterSnapshot = await readLatestSnapshot(directory, refreshed.id).catch(() => undefined);
    if (beforeSnapshot !== undefined && afterSnapshot !== undefined) {
      await writeDatasetDiff(directory, refreshed.id, { at: refreshed.lastSnapshotAt, diff: diffSnapshots(beforeSnapshot, afterSnapshot) });
    }
  } catch { /* diagnostics only */ }
  return refreshed;
}

import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { modelGuideCatalogSchema } from "../packages/types/src/model-guide.ts";

export const CATALOG_SOURCE = "https://models.dev/api.json";
const isRecord = value => typeof value === "object" && value !== null && !Array.isArray(value);
const amount = value => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Exact provider/model matches only. Never changes assessments, routing or credentials. */
export function refreshCatalog(input, upstream, now = new Date()) {
  const current = modelGuideCatalogSchema.parse(input);
  if (!isRecord(upstream) || !Object.keys(upstream).length) throw new Error("Catálogo de origen inválido.");
  const changes = [];
  const models = current.models.map(model => {
    const provider = upstream[model.providerID];
    const found = isRecord(provider) && isRecord(provider.models) ? provider.models[model.modelID] : null;
    const cost = isRecord(found) && found.id === model.modelID && isRecord(found.cost) ? found.cost : null;
    // Unknown tiers and missing cache charges stay unknown, never flattened or made zero.
    if (!cost || !amount(cost.input) || !amount(cost.output) || Object.keys(cost).some(key => !["input", "output", "cache_read", "cache_write"].includes(key))) return model;
    // Do not overwrite prices curated from a different source.
    if (model.pricing && model.pricing.source.url !== CATALOG_SOURCE) return model;
    const pricing = { currency: "USD", input: cost.input, output: cost.output,
      ...(amount(cost.cache_read) ? { cacheRead: cost.cache_read } : {}),
      ...(amount(cost.cache_write) ? { cacheWrite: cost.cache_write } : {}),
      source: { label: "models.dev · coincidencia exacta", url: CATALOG_SOURCE, checkedAt: now.toISOString() } };
    const values = value => value ? [value.input, value.output, value.cacheRead, value.cacheWrite] : null;
    const expired = !model.pricing || now.getTime() - Date.parse(model.pricing.source.checkedAt) >= 7 * 86400000;
    if (!expired && JSON.stringify(values(model.pricing)) === JSON.stringify(values(pricing))) return model;
    changes.push({ providerID: model.providerID, modelID: model.modelID, before: values(model.pricing), after: values(pricing) });
    return { ...model, pricing };
  });
  const catalog = changes.length ? { ...current, revision: current.revision + 1, publishedAt: now.toISOString(), models } : current;
  return { catalog: modelGuideCatalogSchema.parse(catalog), changes };
}

export async function fetchCatalog(fetchImpl = fetch) {
  const response = await fetchImpl(CATALOG_SOURCE, { redirect: "error", credentials: "omit", signal: AbortSignal.timeout(30000), headers: { Accept: "application/json" } });
  if (!response.ok || !response.body) throw new Error("No se pudo consultar el catálogo de origen.");
  const reader = response.body.getReader();
  const chunks = []; let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 32 * 1024 * 1024) throw new Error("El origen excede 32 MiB.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const file = new URL("../apps/server/src/model-guide/catalog.json", import.meta.url);
    const original = await readFile(file, "utf8");
    const result = refreshCatalog(JSON.parse(original), await fetchCatalog());
    await writeFile("model-catalog-review.json", JSON.stringify({ source: CATALOG_SOURCE, revision: result.catalog.revision, changes: result.changes, assessmentsChanged: false }, null, 2) + "\n");
    if (result.changes.length) {
      const temporary = new URL(`catalog.${randomUUID()}.tmp`, file);
      try {
        await writeFile(temporary, JSON.stringify(result.catalog, null, 2) + "\n", { flag: "wx" });
        if (await readFile(file, "utf8") !== original) throw new Error("El catálogo cambió durante la consulta.");
        await rename(temporary, file);
      } finally { await rm(temporary, { force: true }); }
    }
    console.log(`${result.changes.length} precios propuestos; revisión humana requerida.`);
  } catch { console.error("No se completó la actualización del catálogo. Revisá la conexión y los cambios locales."); process.exitCode = 1; }
}

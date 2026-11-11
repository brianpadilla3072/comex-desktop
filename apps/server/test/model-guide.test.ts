import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importNodeSqlite } from "../src/runtime-db.js";
import { openModelGuideStore as openStore, bundledCatalog as releaseCatalog } from "../src/model-guide/store.js";
import { modelGuideCatalogSchema, type GuideObservation, type ModelGuideCatalog } from "@openwork/types/model-guide";

// Storage tests use a stable fixture, independent of the editorial release revision.
const bundledCatalog: ModelGuideCatalog = { ...releaseCatalog, revision: 1, publishedAt: "2026-11-06T14:00:00Z", models: [] };
const openModelGuideStore: typeof openStore = (path, options = {}) => openStore(path, { bundled: bundledCatalog, ...options });

const observed: GuideObservation = { providerID: "private-provider", modelID: "fixture", name: "Fixture", providerName: "Local fixture", pricing: null, freeVerified: false, tools: true, reasoning: null, input: ["text"], context: 4096, efforts: [] };
const url = "https://catalog.example/catalog.json";
const epoch = Date.parse("2026-11-06T15:00:00Z");
async function database(t: { after(fn: () => Promise<void>): void }) { const dir = await mkdtemp(join(tmpdir(), "model-guide-")); t.after(() => rm(dir, { force: true, recursive: true })); return join(dir, "catalog.sqlite"); }
function next(revision: number): ModelGuideCatalog { return { ...bundledCatalog, revision, updateUrl: "https://untrusted.example/never-follow-this", models: [] }; }

test("discoveries persist by offering and scope, preserve first seen, retain retired rows and unknown prices", async t => {
  const path = await database(t); let clock = epoch;
  let store = await openModelGuideStore(path, { now: () => clock });
  store.discover({ scope: "a", models: [observed, { ...observed, providerID: "other" }] });
  clock += 1000;
  store.discover({ scope: "a", models: [{ ...observed, name: "Updated" }] });
  assert.equal(store.snapshot("a").observations.length, 2);
  assert.equal(store.snapshot("a").observations.find(row => row.providerID === "other")?.available, false);
  assert.equal(store.snapshot("a").observations.find(row => row.providerID === observed.providerID)?.firstSeen, new Date(epoch).toISOString());
  assert.equal(store.snapshot("a").observations[1]?.pricing, null);
  assert.equal(store.snapshot("b").observations.length, 0);
  assert.throws(() => store.discover({ scope: "a", models: [{ ...observed, apiKey: "never-store-this" }] }));
  assert.equal(store.snapshot("a").observations.filter(row => row.available).length, 1);
  store.close();
  store = await openModelGuideStore(path);
  assert.equal(store.snapshot("a").observations.length, 2);
  store.discover({ scope: "a", models: [{ ...observed, name: "Updated" }] });
  store.close();
  const { DatabaseSync } = await importNodeSqlite(); const audit = new DatabaseSync(path);
  assert.equal(audit.prepare("SELECT count(*) AS count FROM model_guide_observation_history").get()?.count, 3);
  assert.equal(audit.prepare("SELECT count(*) AS count FROM model_guide_catalog_versions").get()?.count, 1);
  audit.close();
  if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test("static updates are anonymous, coalesced, throttled, and never follow remote update URLs", async t => {
  const path = await database(t); let clock = epoch; let calls = 0;
  const store = await openModelGuideStore(path, { updateUrl: url, now: () => clock, fetch: async (input, init) => {
    calls++; assert.equal(input, url); assert.equal(init?.redirect, "error"); assert.equal(init?.credentials, "omit"); assert.equal(init?.method, undefined);
    assert.deepEqual(init?.headers, { Accept: "application/json" }); assert.equal(init?.body, undefined);
    return Response.json(next(calls + 1));
  } });
  t.after(async () => store.close());
  store.discover({ scope: "private-workspace", models: [observed] });
  await Promise.all([store.refresh(), store.refresh(), store.refresh()]);
  assert.equal(calls, 1); assert.equal(store.snapshot("private-workspace").catalog.revision, 2);
  await store.refresh(); assert.equal(calls, 1);
  clock += 86_400_001; await store.refresh(); assert.equal(calls, 2);
  assert.equal(store.snapshot("private-workspace").observations.length, 1);
});

test("bad JSON, invalid or duplicate records, oversize, rollback and changed same revision preserve the last valid catalog", async t => {
  const path = await database(t); let response = Response.json(next(3));
  const store = await openModelGuideStore(path, { updateUrl: url, now: () => epoch, fetch: async () => response });
  t.after(async () => store.close()); await store.refresh(true);
  const invalidResponses = [
    new Response("<html>not JSON</html>"), Response.json({ ...next(4), schemaVersion: 2 }),
    Response.json({ ...next(4), providers: [bundledCatalog.providers[0], bundledCatalog.providers[0]] }),
    new Response("{}", { headers: { "content-length": "2000001" } }),
    new Response("x".repeat(2_000_001)), Response.json(next(2)), Response.json({ ...next(3), providers: [] }),
    Response.json({ ...next(4), publishedAt: "2099-01-01T00:00:00Z" }),
  ];
  for (response of invalidResponses) { await store.refresh(true); assert.equal(store.snapshot("x").catalog.revision, 3); assert.ok(store.snapshot("x").status.error); }
  response = Response.json(next(4)); await store.refresh(true); assert.equal(store.snapshot("x").status.error, null);
});

test("releases replace older remote catalogs, remote catalogs survive restart, and missing URL performs no network calls", async t => {
  const path = await database(t);
  let store = await openModelGuideStore(path, { updateUrl: url, now: () => epoch, fetch: async () => Response.json(next(2)) });
  await store.refresh(true); store.close();
  store = await openModelGuideStore(path, { now: () => epoch });
  assert.equal(store.snapshot("x").catalog.revision, 2); assert.equal(store.snapshot("x").status.remoteConfigured, false);
  store.close();
  store = await openModelGuideStore(path, { bundled: next(3), updateUrl: null, fetch: async () => { throw new Error("Must not fetch"); } });
  await store.refresh(true); assert.equal(store.snapshot("x").catalog.revision, 3); assert.equal(store.snapshot("x").status.source, "bundled"); store.close();
});

test("unknown scores remain absent; assessments require evidence, exact benchmark version, effort and methodology", () => {
  assert.equal(bundledCatalog.models.length, 0);
  const source = bundledCatalog.providers[0]!.source;
  const model = { providerID: "fixture", modelID: "fixture", source, reasoning: { level: 4 } };
  assert.equal(modelGuideCatalogSchema.safeParse({ ...bundledCatalog, models: [model] }).success, false);
  assert.equal(modelGuideCatalogSchema.safeParse({ ...bundledCatalog, models: [{ providerID: "fixture", modelID: "fixture", source }] }).success, true);
});

test("a non-HTTPS update URL never starts a request", async t => {
  const path = await database(t); let calls = 0;
  const store = await openModelGuideStore(path, { updateUrl: "http://catalog.example/models.json", fetch: async () => { calls++; return Response.json(next(2)); } });
  await store.refresh(true); assert.equal(calls, 0); assert.ok(store.snapshot("x").status.error); store.close();
});

test("release catalog keeps benchmark measurements separate from sourced editorial estimates and unknown identities", () => {
  assert.ok(releaseCatalog.models.filter(model => model.reasoning).length >= 18);
  assert.ok(releaseCatalog.revision >= 2);
  for (const model of releaseCatalog.models) {
    if (!model.reasoning) {
      if (model.reasoningEstimate) {
        assert.ok(model.reasoningEstimate.sources.length > 0);
        assert.ok(model.reasoningEstimate.rangeLow <= model.reasoningEstimate.level);
        assert.ok(model.reasoningEstimate.rangeHigh >= model.reasoningEstimate.level);
        assert.ok(!("score" in model.reasoningEstimate));
      } else assert.ok(model.summary?.includes("No se encontró evidencia"));
      continue;
    }
    assert.equal(model.reasoning.level, Math.min(6, Math.floor(model.reasoning.score / 10) + 1));
    assert.equal(model.reasoning.benchmarkVersion, "5.0.1");
    assert.equal(model.reasoning.measuredAt, null);
    assert.ok(model.reasoning.source.url.startsWith("https://artificialanalysis.ai/models/"));
    if (model.modelID.endsWith("-free")) assert.equal(model.assessmentScope, "base-reference");
  }
  assert.equal(releaseCatalog.models.filter(row => row.reasoningEstimate).length, 22);
  for (const id of ["big-pickle", "pulse-alpha-free"]) {
    const model = releaseCatalog.models.find(row => row.modelID === id);
    assert.ok(model); assert.equal(model.reasoning, undefined); assert.equal(model.reasoningEstimate, undefined);
  }
});

test("estimates require sources, uncertainty bounds and a separate format from measurements", () => {
  const model = releaseCatalog.models.find(row => row.reasoningEstimate);
  assert.ok(model?.reasoningEstimate);
  for (const patch of [{ sources: [] }, { rangeLow: 6, level: 2 }, { rangeHigh: 1, level: 2 }, { confidence: "high" }, { score: 99 }]) {
    assert.equal(modelGuideCatalogSchema.safeParse({ ...bundledCatalog, models: [{ ...model, reasoningEstimate: { ...model.reasoningEstimate, ...patch } }] }).success, false);
  }
});

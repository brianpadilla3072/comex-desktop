import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fetchCatalog, refreshCatalog } from "./refresh-model-catalog.mjs";

const original = JSON.parse(await readFile(new URL("../apps/server/src/model-guide/catalog.json", import.meta.url), "utf8"));
delete original.models[0].pricing;
const first = original.models[0];
const upstream = cost => ({ [first.providerID]: { models: { [first.modelID]: { id: first.modelID, cost } } } });
test("refresh matches exact identities, preserves assessments and is idempotent", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  const next = refreshCatalog(original, upstream({ input: 1, output: 4 }), now);
  assert.equal(next.catalog.revision, original.revision + 1);
  assert.deepEqual(next.catalog.models[0].reasoning, first.reasoning);
  assert.equal(next.catalog.updateUrl, original.updateUrl);
  assert.equal(next.catalog.models[0].pricing.cacheRead, undefined);
  assert.equal(refreshCatalog(next.catalog, upstream({ input: 1, output: 4 }), now).changes.length, 0);
  assert.equal(original.models[0].pricing, undefined);
});
test("missing IDs, tiers, invalid costs and differently named providers cannot overwrite a price", () => {
  for (const cost of [[{ input: 1, output: 2 }], { input: -1, output: 2 }, { output: 1 }]) assert.equal(refreshCatalog(original, upstream(cost)).changes.length, 0);
  assert.equal(refreshCatalog(original, { other: upstream({ input: 1, output: 1 }) }).changes.length, 0);
  assert.throws(() => refreshCatalog(original, []));
});
test("a rejected response leaves the caller without any replacement catalog", async () => {
  await assert.rejects(fetchCatalog(async () => new Response("bad", { status: 500 })));
  await assert.rejects(fetchCatalog(async () => new Response("not json")));
});

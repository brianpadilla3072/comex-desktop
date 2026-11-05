import { afterEach, expect, spyOn, test } from "bun:test";
import type { ModelOption } from "../src/app/types";
import { modelGroups } from "../src/react-app/domains/models/model-catalog";
import { runtimeModelOptions } from "../src/react-app/domains/models/catalog";
import { createClientV2 } from "../src/app/lib/opencode-v2-adapter";

function option(modelID: string, isFree: boolean, disabled = false): ModelOption {
  return { providerID: "fixture", modelID, title: modelID, description: "Fixture",
    behaviorTitle: "Effort", behaviorLabel: "Default", behaviorDescription: "", behaviorValue: null, isFree, disabled };
}
test("Comex lists verified free models before paid pins and never duplicates free favorites or recents", () => {
  const free = option("Free", true);
  const paid = option("Paid", false);
  const groups = modelGroups([paid, free, option("Unavailable", true, true)], [paid, free], [free], "", true);
  expect(groups.map(group => group.value)).toEqual(["Gratis", "Pinned"]);
  expect(groups[0]?.items).toEqual([free]);
  expect(groups.flatMap(group => group.items).filter(model => model.modelID === "Free")).toHaveLength(1);
});
test("turning Comex off retains the existing favorites and provider ordering", () => {
  const free = option("Free", true); const paid = option("Paid", false);
  expect(modelGroups([free, paid], [paid], [], "", false).map(group => group.value)).toEqual(["Pinned", "Fixture"]);
});
let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; });
test("native missing prices, paid tiers and cache charges are never advertised as free", async () => {
  const rows = [
    { id: "free", cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }] },
    { id: "paid", cost: [{ input: 0.1, output: 0.5 }] },
    { id: "unknown" },
    { id: "empty", cost: [] },
    { id: "paid-tier", cost: [{ input: 0, output: 0 }, { input: 1, output: 2 }] },
    { id: "cache-charge", cost: [{ input: 0, output: 0, cache: { read: 1, write: 0 } }] },
  ].map(row => ({ ...row, providerID: "fixture", modelID: row.id, name: row.id }));
  const mock = spyOn(globalThis, "fetch").mockImplementation(async input => {
    const url = input instanceof Request ? input.url : String(input);
    const path = new URL(url).pathname;
    return Response.json({ data: path.endsWith("/api/model") ? rows : path.endsWith("/api/provider") ? [{ id: "fixture", name: "Fixture" }] : [] });
  });
  restore = () => mock.mockRestore();
  const result = await createClientV2("http://localhost:8787/opencode2", "/fixture", {}).provider.list();
  if (!result.data) throw new Error("Missing provider catalog");
  const models = runtimeModelOptions(result.data);
  expect(models.filter(model => model.isFree).map(model => model.modelID)).toEqual(["free"]);
});

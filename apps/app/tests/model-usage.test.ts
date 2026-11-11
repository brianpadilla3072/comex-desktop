import { test } from "node:test";
import assert from "node:assert/strict";
import { modelUsageHints } from "../src/react-app/domains/models/model-guide-usage";
test("unknown models do not receive capability or task-performance claims", () => {
  assert.deepEqual(modelUsageHints(), []);
});
test("capability hints do not claim measured agent autonomy", () => {
  const hints = modelUsageHints(undefined, { providerID: "fixture", modelID: "fixture", name: "Fixture", providerName: "Fixture", pricing: null, freeVerified: false, tools: true, reasoning: null, input: ["image"], context: null, efforts: [] });
  assert.deepEqual(hints, ["Trabajar con imágenes adjuntas", "Usar herramientas del proyecto"]);
  assert.ok(!hints.join(" ").includes("autónomo"));
});

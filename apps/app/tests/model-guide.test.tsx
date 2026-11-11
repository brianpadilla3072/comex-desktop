import { readFileSync } from "node:fs";
import { modelGuideCatalogSchema, type GuideSnapshot } from "@openwork/types/model-guide";
import { prioritizeAssessedModels } from "../src/react-app/domains/models/model-guide-order";
import React from "react";
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { guideBillingLabel, ModelGuideBody, ReasoningBars } from "../src/react-app/domains/models/model-guide-details";
import { modelGuideObservations } from "../src/react-app/domains/models/use-model-guide";
import { runtimeModelOptions } from "../src/react-app/domains/models/catalog";
import { createClientV2 } from "../src/app/lib/opencode-v2-adapter";
import type { ModelOption } from "../src/app/types";

const option: ModelOption = { providerID: "opencode-go", modelID: "fixture", title: "Fixture", description: "OpenCode Go", behaviorTitle: "Effort", behaviorLabel: "Default", behaviorDescription: "", behaviorValue: null, isFree: true };

test("Go is a subscription even if the engine advertises a zero price; no verified entitlement is claimed", () => {
  assert.equal(guideBillingLabel("opencode-go"), "Go · suscripción");
  const markup = renderToStaticMarkup(<ModelGuideBody option={option} />);
  assert.ok(markup.includes("Go · suscripción"));
  assert.ok(markup.includes("Sin evaluar"));
  assert.ok(!markup.includes("Incluido en Go"));
});
test("missing assessments have an explicit accessible state without a fake empty meter", () => {
  const markup = renderToStaticMarkup(<ReasoningBars />);
  assert.ok(markup.includes("sin evaluar"));
  assert.equal((markup.match(/bg-muted-foreground\/25/g) ?? []).length, 0);
  const rated = renderToStaticMarkup(<ReasoningBars level={4} />);
  assert.equal((rated.match(/bg-muted-foreground\/25/g) ?? []).length, 2);
  assert.ok(rated.includes("4 de 6"));
});
test("saved observations never include credentials and unknown costs never become zero", () => {
  const rows = modelGuideObservations([option]);
  assert.equal(rows[0]?.pricing, null);
  assert.equal(rows[0]?.freeVerified, false);
  assert.equal(rows[0]?.tools, null);
});
test("native provider discovery retains explicit prices and capabilities but does not flatten tiered or missing prices", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.endsWith("/api/provider")) return Response.json({ data: [{ id: "fixture", name: "Fixture" }] });
    if (url.pathname.endsWith("/api/model")) return Response.json({ data: [
      { id: "unknown", providerID: "fixture" },
      { id: "tiered", providerID: "fixture", cost: [{ input: 0, output: 0 }, { input: 2, output: 8 }] },
      { id: "paid", providerID: "fixture", cost: [{ input: 2, output: 8 }], capabilities: { tools: true, input: ["text", "image"], output: ["text", "reasoning"] }, limit: { context: 32000 }, variants: [{ id: "high", settings: {} }] },
    ] });
    return Response.json({ data: [] });
  };
  try {
    const response = await createClientV2("http://localhost:8787/opencode2", "/fixture", {}).provider.list();
    assert.ok(response.data);
    const options = runtimeModelOptions(response.data);
    const rows = modelGuideObservations(options);
    assert.equal(rows.find(row => row.modelID === "unknown")?.pricing, null);
    assert.equal(rows.find(row => row.modelID === "tiered")?.pricing, null);
    const paid = rows.find(row => row.modelID === "paid");
    assert.equal(paid?.pricing?.output, 8); assert.equal(paid?.tools, true);
    assert.equal(paid?.context, 32000); assert.deepEqual(paid?.efforts, ["high"]);
    assert.equal(paid?.reasoning, true); assert.equal(paid?.freeVerified, false);
  } finally { globalThis.fetch = previous; }
});

test("base-model references are marked and unknown values stay separate from a low score", () => {
  const reference = renderToStaticMarkup(<ReasoningBars level={3} reference />);
  assert.ok(!reference.includes("3/6"));
  assert.ok(reference.includes("Referencia del modelo base"));
  const unknown = renderToStaticMarkup(<ReasoningBars />);
  assert.ok(unknown.includes("Sin datos"));
  assert.ok(!unknown.includes("0/6"));
});


test("assessed models come first inside providers without mixing billing groups, pins, recents or search relevance", () => {
  const catalog = modelGuideCatalogSchema.parse(JSON.parse(readFileSync(new URL("../../server/src/model-guide/catalog.json", import.meta.url), "utf8")));
  const snapshot: GuideSnapshot = { catalog, observations: [], status: { source: "bundled", checkedAt: null, updatedAt: catalog.publishedAt, error: null, remoteConfigured: false } };
  const unknown = { ...option, modelID: "unknown" };
  const scored = { ...option, modelID: "gpt-6-luna" };
  const wrongProvider = { ...scored, providerID: "another-provider" };
  const na = { ...option, modelID: "kimi-k3" };
  const items = [unknown, scored, wrongProvider, na];
  const groups = ["OpenCode Go", "Pinned", "Recent", "Search results"].map(value => ({ value, items }));
  const result = prioritizeAssessedModels(groups, snapshot);
  assert.deepEqual(result[0]?.items, [scored, na, unknown, wrongProvider]);
  assert.deepEqual(groups[0]?.items, items);
  for (const group of result.slice(1)) assert.deepEqual(group.items, items);
  assert.deepEqual(prioritizeAssessedModels(groups), groups);
});

test("estimates are visibly approximate, disclose uncertainty and do not fabricate a benchmark score", () => {
  const catalog = modelGuideCatalogSchema.parse(JSON.parse(readFileSync(new URL("../../server/src/model-guide/catalog.json", import.meta.url), "utf8")));
  for (const row of catalog.models) delete row.pricing; // fixed cost fixtures are independent of live price refreshes
  const model = catalog.models.find(row => row.modelID === "kimi-k3");
  assert.ok(model?.reasoningEstimate);
  const bars = renderToStaticMarkup(<ReasoningBars level={model.reasoningEstimate.level} estimated />);
  assert.ok(!bars.includes("4/6")); assert.ok(bars.includes("Estimación de capacidad general"));
  const markup = renderToStaticMarkup(<ModelGuideBody option={option} model={model} />);
  for (const text of ["Estimación", "Rango 3–5/6", "Confianza media", "Ver criterio y fuentes", "Moonshot", "No predice puntos AA"]) assert.ok(markup.includes(text), text);
  assert.ok(!markup.includes("puntos AA. Esfuerzo"));
  const measured = catalog.models.find(row => row.modelID === "gpt-6-luna");
  assert.ok(measured?.reasoning);
  const measuredMarkup = renderToStaticMarkup(<ModelGuideBody option={option} model={{ ...model, reasoning: measured.reasoning }} />);
  assert.ok(measuredMarkup.includes("puntos AA. Esfuerzo"));
  assert.ok(!measuredMarkup.includes("Capacidad general: ≈"));
});

test("value comparison uses a fixed token workload and never invents a price or mixes providers", async () => {
  const { referenceCost, modelValueComparison, ModelValueGraphic } = await import("../src/react-app/domains/models/model-guide-value");
  assert.equal(referenceCost({ input: 1, output: 4 }), 2);
  assert.equal(referenceCost(null), null);
  const catalog = modelGuideCatalogSchema.parse(JSON.parse(readFileSync(new URL("../../server/src/model-guide/catalog.json", import.meta.url), "utf8")));
  for (const row of catalog.models) delete row.pricing; // fixed cost fixtures are independent of live price refreshes
  const model = catalog.models.find(row => row.modelID === "glm-5.3-flash");
  const peer = catalog.models.find(row => row.modelID === "hy4");
  assert.ok(model); assert.ok(peer);
  const observation = { ...modelGuideObservations([option])[0]!, providerID: model.providerID, modelID: model.modelID, pricing: { input: 1, output: 4 } };
  const snapshot: GuideSnapshot = { catalog, observations: [
    { ...observation, name: "Hy4", modelID: peer.modelID, pricing: { input: 0.1, output: 0.4 }, firstSeen: catalog.publishedAt, lastSeen: catalog.publishedAt, available: true },
    { ...observation, name: "Other provider", providerID: "other", firstSeen: catalog.publishedAt, lastSeen: catalog.publishedAt, available: true },
  ], status: { source: "bundled", checkedAt: null, updatedAt: catalog.publishedAt, error: null, remoteConfigured: false } };
  const result = modelValueComparison({ ...option, ...model }, model, observation, snapshot);
  assert.equal(result.cost, 2); assert.equal(result.peers.length, 1); assert.equal(result.alternative?.name, "Hy4");
  const markup = renderToStaticMarkup(<ModelValueGraphic option={option} model={model} snapshot={snapshot} />);
  assert.ok(markup.includes("Falta un precio comparable")); assert.ok(!markup.includes("<svg"));
});

test("overlapping editorial ranges never assert a better-value alternative", async () => {
  const { modelValueComparison } = await import("../src/react-app/domains/models/model-guide-value");
  const catalog = modelGuideCatalogSchema.parse(JSON.parse(readFileSync(new URL("../../server/src/model-guide/catalog.json", import.meta.url), "utf8")));
  for (const row of catalog.models) delete row.pricing; // fixed cost fixtures are independent of live price refreshes
  const model = catalog.models.find(row => row.modelID === "kimi-k3");
  const peer = catalog.models.find(row => row.modelID === "deepseek-v4.1-flash");
  assert.ok(model); assert.ok(peer);
  const observation = { ...modelGuideObservations([option])[0]!, providerID: model.providerID, modelID: model.modelID, pricing: { input: 3, output: 15 } };
  const snapshot: GuideSnapshot = { catalog, observations: [{ ...observation, modelID: peer.modelID, name: "DeepSeek", pricing: { input: 0.15, output: 0.6 }, firstSeen: catalog.publishedAt, lastSeen: catalog.publishedAt, available: true }], status: { source: "bundled", checkedAt: null, updatedAt: catalog.publishedAt, error: null, remoteConfigured: false } };
  const result = modelValueComparison({ ...option, ...model }, model, observation, snapshot);
  assert.equal(result.peers.length, 1); assert.equal(result.alternative, undefined);
});

test("a cheaper model in the same six-bar band is not presented as equally capable when its published score is lower", async () => {
  const { modelValueComparison } = await import("../src/react-app/domains/models/model-guide-value");
  const catalog = modelGuideCatalogSchema.parse(JSON.parse(readFileSync(new URL("../../server/src/model-guide/catalog.json", import.meta.url), "utf8")));
  for (const row of catalog.models) delete row.pricing; // fixed cost fixtures are independent of live price refreshes
  const model = catalog.models.find(row => row.modelID === "hy4");
  const peer = catalog.models.find(row => row.modelID === "mimo-v2.6-pro");
  assert.ok(model?.reasoning); assert.ok(peer?.reasoning);
  assert.equal(model.reasoning.level, peer.reasoning.level);
  assert.ok(model.reasoning.score > peer.reasoning.score);
  const observation = { ...modelGuideObservations([option])[0]!, providerID: model.providerID, modelID: model.modelID, pricing: { input: 1, output: 4 } };
  const snapshot: GuideSnapshot = { catalog, observations: [{ ...observation, modelID: peer.modelID, name: "MiMo Pro", pricing: { input: 0.1, output: 0.4 }, firstSeen: catalog.publishedAt, lastSeen: catalog.publishedAt, available: true }], status: { source: "bundled", checkedAt: null, updatedAt: catalog.publishedAt, error: null, remoteConfigured: false } };
  const result = modelValueComparison({ ...option, ...model }, model, observation, snapshot);
  assert.equal(result.alternative, undefined);
  assert.equal(result.cheaper[0]?.name, "MiMo Pro");
});

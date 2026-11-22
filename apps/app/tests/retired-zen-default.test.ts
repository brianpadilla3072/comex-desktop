import { expect, test } from "bun:test";

import { AUTO_MODEL_ID, AUTO_PROVIDER_ID, retiredZenDefaultReplacement } from "../src/react-app/domains/models/model-catalog";

const zenDefault = { providerID: "opencode", modelID: "big-pickle" };
const freeAuto = { providerID: AUTO_PROVIDER_ID, modelID: AUTO_MODEL_ID };
const go = { providerID: "opencode-go", modelID: "beam-free" };

// Comex keeps OpenCode Zen allowed for Console accounts, so the "Zen is
// blocked" replacement never ran there. The built-in default stayed on the
// retired opencode/big-pickle and every new chat showed "Model no longer
// available" although free models were connected.
test("in Comex a Zen default the catalog no longer has moves to free Auto", () => {
  expect(retiredZenDefaultReplacement({ current: zenDefault, available: [go, freeAuto], zenBlocked: false })).toEqual(freeAuto);
  expect(retiredZenDefaultReplacement({ current: zenDefault, available: [go], zenBlocked: false })).toEqual(go);
});

test("in Comex a Zen default the catalog still has, a loading catalog, or no default stays put", () => {
  expect(retiredZenDefaultReplacement({ current: zenDefault, available: [zenDefault, freeAuto], zenBlocked: false })).toBeUndefined();
  expect(retiredZenDefaultReplacement({ current: zenDefault, available: [], zenBlocked: false })).toBeUndefined();
  expect(retiredZenDefaultReplacement({ current: null, available: [freeAuto], zenBlocked: false })).toBeUndefined();
});

test("a disabled Zen entry does not count as available", () => {
  expect(retiredZenDefaultReplacement({ current: zenDefault, available: [{ ...zenDefault, disabled: true }, freeAuto], zenBlocked: false })).toEqual(freeAuto);
});

test("non-Zen defaults are never touched, and blocked Zen keeps moving as before", () => {
  expect(retiredZenDefaultReplacement({ current: go, available: [freeAuto], zenBlocked: false })).toBeUndefined();
  expect(retiredZenDefaultReplacement({ current: go, available: [freeAuto], zenBlocked: true })).toBeUndefined();
  expect(retiredZenDefaultReplacement({ current: zenDefault, available: [go, freeAuto], zenBlocked: true })).toEqual(freeAuto);
  expect(retiredZenDefaultReplacement({ current: null, available: [go], zenBlocked: true })).toEqual(go);
});

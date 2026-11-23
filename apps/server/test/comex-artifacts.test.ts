import { test } from "node:test";
import assert from "node:assert/strict";
import { comexArtifactsEnabled } from "../src/comex/features.js";

test("comexArtifacts is on by default in self-hosted and lockable by the operator", () => {
  assert.equal(comexArtifactsEnabled({}), true);
  assert.equal(comexArtifactsEnabled({ DEN_FEATURE_COMEX_ARTIFACTS: "true" }), true);
  assert.equal(comexArtifactsEnabled({ DEN_FEATURE_COMEX_ARTIFACTS: "false" }), false);
  assert.equal(comexArtifactsEnabled({ DEN_DEPLOYMENT: "cloud", DEN_FEATURE_COMEX_ARTIFACTS: "true" }), false);
});

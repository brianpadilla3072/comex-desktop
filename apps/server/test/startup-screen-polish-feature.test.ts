import { test } from "node:test";
import assert from "node:assert/strict";
import { startupScreenPolishEnabled } from "../src/comex/features.js";

test("the startup screen polish is on by default and follows the operator switch", () => {
  assert.equal(startupScreenPolishEnabled({}), true);
  assert.equal(startupScreenPolishEnabled({ DEN_FEATURE_STARTUP_SCREEN_POLISH: "false" }), false);
  assert.equal(startupScreenPolishEnabled({ DEN_FEATURE_STARTUP_SCREEN_POLISH: "true" }), true);
});

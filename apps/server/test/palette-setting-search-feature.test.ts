import { test } from "node:test";
import assert from "node:assert/strict";
import { paletteSettingSearchEnabled } from "../src/comex/features.js";

test("palette setting search is on by default and follows the operator switch", () => {
  assert.equal(paletteSettingSearchEnabled({}), true);
  assert.equal(paletteSettingSearchEnabled({ DEN_FEATURE_PALETTE_SETTING_SEARCH: "false" }), false);
  assert.equal(paletteSettingSearchEnabled({ DEN_FEATURE_PALETTE_SETTING_SEARCH: "true" }), true);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { webNotificationsEnabled } from "../src/comex/features.js";

test("web notifications are on by default and follow the operator switch", () => {
  assert.equal(webNotificationsEnabled({}), true);
  assert.equal(webNotificationsEnabled({ DEN_FEATURE_WEB_NOTIFICATIONS: "false" }), false);
  assert.equal(webNotificationsEnabled({ DEN_FEATURE_WEB_NOTIFICATIONS: "true" }), true);
});

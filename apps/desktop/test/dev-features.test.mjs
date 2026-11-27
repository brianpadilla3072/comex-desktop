import { test } from "node:test";
import assert from "node:assert/strict";
import { desktopDevFeatureEnvironment } from "../scripts/dev-features.mjs";
import { desktopLocalWebEnabled } from "../electron/desktop-local-web.mjs";

test("a fresh development launch enables connected web without a machine-specific URL", () => {
  assert.equal(desktopLocalWebEnabled(desktopDevFeatureEnvironment({})), true);
  // The packaged desktop policy must remain opt-in.
  assert.equal(desktopLocalWebEnabled({}), false);
});

test("development respects operator disable and feature validation", () => {
  for (const value of ["false", "true", "invalid", ""]) {
    const env = desktopDevFeatureEnvironment({ DEN_FEATURE_DESKTOP_LOCAL_WEB: value });
    assert.equal(env.DEN_FEATURE_DESKTOP_LOCAL_WEB, value);
    assert.equal(desktopLocalWebEnabled(env), value === "true");
  }
});

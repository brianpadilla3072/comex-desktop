import { test } from "node:test";
import assert from "node:assert/strict";
import { appSessionRouteFromUrl } from "../electron/app-session-link.mjs";

const current = "http://localhost:40707/#/workspace/ws_current/session/ses_current";

test("app links use the same origin and only session routes", () => {
  assert.equal(appSessionRouteFromUrl("http://localhost:40707/#/workspace/ws_target/session/ses_target", current), "/workspace/ws_target/session/ses_target");
  assert.equal(appSessionRouteFromUrl("http://localhost:40707/workspace/ws_target/session", current), "/workspace/ws_target/session");
  assert.equal(appSessionRouteFromUrl("https://example.com/#/workspace/ws_target/session/ses_target", current), null);
  assert.equal(appSessionRouteFromUrl("http://localhost:40707/welcome", current), null);
  assert.equal(appSessionRouteFromUrl("http://localhost:40707/#/workspace/%ZZ/session/ses_target", current), null);
});

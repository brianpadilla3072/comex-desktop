import { expect, test } from "bun:test";
import { appSessionRouteFromUrl } from "../src/app/lib/app-session-link";

const current = "http://localhost:40707/#/workspace/ws_current/session/ses_current";

test("hash and path links to this renderer become desktop session routes", () => {
  expect(appSessionRouteFromUrl("http://localhost:40707/#/workspace/ws_target/session/ses_target", current))
    .toBe("/workspace/ws_target/session/ses_target");
  expect(appSessionRouteFromUrl("http://localhost:40707/workspace/ws_target/session/ses_target", current))
    .toBe("/workspace/ws_target/session/ses_target");
  expect(appSessionRouteFromUrl("http://localhost:40707/#/workspace/ws_target/session", current))
    .toBe("/workspace/ws_target/session");
});

test("foreign origins, non-session routes and malformed escapes are ignored", () => {
  expect(appSessionRouteFromUrl("https://example.com/#/workspace/ws_target/session/ses_target", current)).toBeNull();
  expect(appSessionRouteFromUrl("http://localhost:40707/welcome", current)).toBeNull();
  expect(appSessionRouteFromUrl("http://localhost:40707/#/workspace/%ZZ/session/ses_target", current)).toBeNull();
  expect(appSessionRouteFromUrl("not a url", current)).toBeNull();
});

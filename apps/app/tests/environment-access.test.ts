import { expect, test } from "bun:test";

import { OpenworkServerError } from "../src/app/lib/openwork-server";
import { isEnvironmentAccessDenied } from "../src/react-app/domains/settings/pages/environment-variable-provider";

// Hive QA w5-3: the web app showed the raw "Invalid host token", retried each /env call ~9 times
// and then claimed "No environment variables yet". A denial is now its own, final state.
test("only an authorization failure counts as denied access", () => {
  expect(isEnvironmentAccessDenied(new OpenworkServerError(401, "unauthorized", "Invalid host token"))).toBe(true);
  expect(isEnvironmentAccessDenied(new OpenworkServerError(403, "forbidden", "No"))).toBe(true);
  expect(isEnvironmentAccessDenied(new OpenworkServerError(500, "internal", "boom"))).toBe(false);
  expect(isEnvironmentAccessDenied(new Error("offline"))).toBe(false);
});

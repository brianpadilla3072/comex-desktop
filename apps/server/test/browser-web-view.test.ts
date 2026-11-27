import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatchBrowserWebView } from "../src/routes/browser-web-view.js";
import { ApiError } from "../src/errors.js";

test("web view proves workspace/session ownership before forwarding to the desktop", async () => {
  const previous = process.env.DEN_FEATURE_DESKTOP_LOCAL_WEB;
  process.env.DEN_FEATURE_DESKTOP_LOCAL_WEB = "true";
  let forwarded = 0;
  const options = {
    config: { host: "127.0.0.1", desktopWebRoot: "/synthetic/web" },
    raw: { sessionId: "ses_example", operation: "state" }, workspaceId: "ws_example", signal: new AbortController().signal,
    assertSession: async (workspace: string, session: string) => {
      if (workspace !== "ws_example" || session !== "ses_example") throw new ApiError(404, "session_not_found", "Not found");
    },
    forward: async () => { forwarded++; return { version: 1, ok: false, code: "browser_tab_not_found", error: "No tab" }; },
  };
  try {
    assert.equal((await dispatchBrowserWebView(options)).ok, false);
    assert.equal(forwarded, 1);
    await assert.rejects(dispatchBrowserWebView({ ...options, workspaceId: "ws_other" }), error => error instanceof ApiError && error.code === "session_not_found");
    assert.equal(forwarded, 1);
    await assert.rejects(dispatchBrowserWebView({ ...options, raw: { ...options.raw, operation: "evaluate" } }), error => error instanceof ApiError && error.code === "invalid_browser_view_request");
    await assert.rejects(dispatchBrowserWebView({ ...options, config: { ...options.config, host: "0.0.0.0" } }), error => error instanceof ApiError && error.code === "desktop_web_disabled");
    process.env.DEN_FEATURE_DESKTOP_LOCAL_WEB = "false";
    await assert.rejects(dispatchBrowserWebView(options), error => error instanceof ApiError && error.code === "desktop_web_disabled");
    assert.equal(forwarded, 1, "disabled and foreign requests never reach the desktop");
  } finally {
    if (previous === undefined) delete process.env.DEN_FEATURE_DESKTOP_LOCAL_WEB;
    else process.env.DEN_FEATURE_DESKTOP_LOCAL_WEB = previous;
  }
});

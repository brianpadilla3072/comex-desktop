import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserTaskHost } from "./browser-task.mjs";

const LINK = "http://localhost:40707/#/workspace/ws_1/session/ses_1";

function makeHost({ handoff = true } = {}) {
  let currentUrl = "about:blank";
  const tab = {
    tabId: "handoff-tab",
    webMcpRevision: 0,
    view: { webContents: {
      isDestroyed: () => false,
      getURL: () => currentUrl,
      getTitle: () => "",
      stop() {},
      executeJavaScriptInIsolatedWorld: async () => "",
    } },
  };
  const host = createBrowserTaskHost({
    getTab: (id) => id === tab.tabId ? tab : undefined,
    tabsFor: () => [tab],
    ownerOf: () => "chat",
    activeFor: () => tab.tabId,
    isVisible: () => true,
    enabled: () => true,
    allowed: async () => true,
    changed: () => {},
    openTab: async (_url, _sessionId, _signal, beforeLoad) => {
      if (handoff) tab.appSessionHandoff = LINK;
      await beforeLoad?.(tab);
      return tab;
    },
    navigate: async (_tab, url) => { currentUrl = url; },
  });
  return { host, tab };
}

test("opening an app link returns a terminal handoff receipt, not next: observe", async () => {
  const { host } = makeHost();
  const result = await host.request({ sessionId: "chat", operation: "open", args: { url: LINK, provider: "builtin" } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.handoff, true);
  assert.equal(result.next, "none");
  assert.equal(result.url, LINK);
});

test("observe on a handed-off tab reports the handoff instead of invalid_url", async () => {
  const { host, tab } = makeHost();
  await host.request({ sessionId: "chat", operation: "open", args: { url: LINK, provider: "builtin" } });
  const observed = await host.request({ sessionId: "chat", operation: "observe", args: { tabId: tab.tabId } });
  assert.equal(observed.ok, false, JSON.stringify(observed));
  assert.equal(observed.code, "app_link_handed_off");
});

test("navigating a handed-off tab recovers it for the browser tool", async () => {
  const { host, tab } = makeHost();
  await host.request({ sessionId: "chat", operation: "open", args: { url: LINK, provider: "builtin" } });
  const navigated = await host.request({ sessionId: "chat", operation: "navigate", args: { tabId: tab.tabId, url: "https://example.org/" } });
  assert.equal(navigated.ok, true, JSON.stringify(navigated));
  assert.equal(tab.appSessionHandoff, null);
});

test("a normal website open still asks for an observation", async () => {
  const { host } = makeHost({ handoff: false });
  const result = await host.request({ sessionId: "chat", operation: "open", args: { url: "https://example.org/", provider: "builtin" } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.handoff, undefined);
  assert.equal(result.next, "observe");
});

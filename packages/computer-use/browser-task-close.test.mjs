import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserTaskHost } from "./browser-task.mjs";

function makeTab(tabId, title = "Home") {
  return { tabId, webMcpRevision: 0, view: { webContents: {
    isDestroyed: () => false, getURL: () => "https://example.com/", getTitle: () => title,
    stop() {}, executeJavaScriptInIsolatedWorld: async () => "",
  } } };
}

test("close frees the shared tab limit for this conversation's tabs only", async () => {
  const mine = [makeTab("a"), makeTab("b")];
  const theirs = makeTab("other");
  const allTabs = [...mine, theirs];
  const closed = [];
  const host = createBrowserTaskHost({
    getTab: id => allTabs.find(tab => tab.tabId === id),
    tabsFor: sessionId => sessionId === "chat" ? mine : [theirs],
    ownerOf: id => id === "other" ? "someone-else" : "chat",
    activeFor: () => "a",
    isVisible: () => true, enabled: () => true, allowed: async () => true, changed: () => {},
    openTab: async () => { throw new Error("not used"); },
    navigate: async () => {},
    closeTab: async tab => { closed.push(tab.tabId); },
  });
  const result = await host.request({ sessionId: "chat", operation: "close", args: { all: true } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.closed.sort(), ["a", "b"]);
  assert.ok(result.closed.every(id => id !== "other"), "must not close another conversation's tab");
  assert.equal(closed.sort().join(","), "a,b");
});

test("close with a tabId refuses a tab owned by another conversation", async () => {
  const tab = makeTab("other");
  const host = createBrowserTaskHost({
    getTab: id => id === "other" ? tab : undefined,
    tabsFor: () => [tab], ownerOf: () => "someone-else", activeFor: () => "other",
    isVisible: () => true, enabled: () => true, allowed: async () => true, changed: () => {},
    openTab: async () => { throw new Error("not used"); }, navigate: async () => {},
    closeTab: async () => { throw new Error("must not be called"); },
  });
  const result = await host.request({ sessionId: "chat", operation: "close", args: { tabId: "other" } });
  assert.equal(result.ok, false);
  assert.equal(result.code, "wrong_conversation");
});

test("close reports unavailable on a host without a closeTab callback", async () => {
  const tab = makeTab("a");
  const host = createBrowserTaskHost({
    getTab: () => tab, tabsFor: () => [tab], ownerOf: () => "chat", activeFor: () => "a",
    isVisible: () => true, enabled: () => true, allowed: async () => true, changed: () => {},
    openTab: async () => { throw new Error("not used"); }, navigate: async () => {},
  });
  const result = await host.request({ sessionId: "chat", operation: "close", args: { tabId: "a" } });
  assert.equal(result.ok, false);
  assert.equal(result.code, "close_unavailable");
});

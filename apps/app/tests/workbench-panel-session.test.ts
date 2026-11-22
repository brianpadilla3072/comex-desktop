import { describe, expect, test } from "bun:test";

import { panelSessionForChatItem, sessionPagePanelSessionFor } from "../src/react-app/domains/session/chat/workbench-panel-session";
import { NO_SESSION_SIDE_PANEL_KEY } from "../src/react-app/domains/session/panel/side-panel-session";

describe("panelSessionForChatItem", () => {
  const link = {
    sourceSessionId: "side",
    panelSessionId: "main",
    primarySessionId: "main",
    primaryWorkspaceId: "ws",
    split: { workspaceId: "ws", sessionId: "side" },
    splitTakesPanel: false,
  };

  test("shows a split pane file in the main chat's panel when that is the only panel", () => {
    expect(panelSessionForChatItem(link)).toBe("main");
  });

  test("opens the split pane chat's own panel when it can take the panel", () => {
    expect(panelSessionForChatItem({ ...link, splitTakesPanel: true })).toBe("side");
  });

  test("opens the main chat's panel for a main chat file while the split pane's panel shows", () => {
    expect(panelSessionForChatItem({ ...link, sourceSessionId: "main", panelSessionId: "side", splitTakesPanel: true })).toBe("main");
  });

  test("uses the panel on screen for a file from its own chat or from no chat", () => {
    expect(panelSessionForChatItem({ ...link, sourceSessionId: "main" })).toBe("main");
    expect(panelSessionForChatItem({ ...link, sourceSessionId: null })).toBe("main");
  });

  test("keeps a file from another workspace with its own chat", () => {
    expect(panelSessionForChatItem({ ...link, split: { workspaceId: "other", sessionId: "side" } })).toBe("side");
  });

  test("a split pane draft never takes the panel", () => {
    expect(panelSessionForChatItem({ ...link, splitTakesPanel: true, split: { ...link.split, draftDestination: { kind: "new" } } })).toBe("main");
  });

  // Fork case: the main pane has no chat yet, so the panel on screen is the
  // no-session panel. A split pane file still lands there.
  test("shows a split pane file in the no-session panel when the main pane has no chat", () => {
    expect(panelSessionForChatItem({ ...link, primarySessionId: null, panelSessionId: NO_SESSION_SIDE_PANEL_KEY })).toBe(NO_SESSION_SIDE_PANEL_KEY);
  });
});

// What the session page hands to its chats: in this fork the split chat never
// has a panel of its own, so its files and app previews land in the main one.
describe("sessionPagePanelSessionFor", () => {
  const page = { selectedSessionId: "main", selectedWorkspaceId: "ws", split: { workspaceId: "ws", sessionId: "side" } };

  test("sends an item from the split chat to the main chat's panel", () => {
    expect(sessionPagePanelSessionFor(page)("side")).toBe("main");
  });

  test("keeps an item from the main chat in its own panel", () => {
    expect(sessionPagePanelSessionFor(page)("main")).toBe("main");
  });

  test("uses the no-session panel when the main pane has no chat", () => {
    expect(sessionPagePanelSessionFor({ ...page, selectedSessionId: null })("side")).toBe(NO_SESSION_SIDE_PANEL_KEY);
    expect(sessionPagePanelSessionFor({ ...page, selectedSessionId: null })(null)).toBe(NO_SESSION_SIDE_PANEL_KEY);
  });

  test("leaves a split chat from another workspace with its own chat", () => {
    expect(sessionPagePanelSessionFor({ ...page, split: { workspaceId: "other", sessionId: "side" } })("side")).toBe("side");
  });

  test("leaves chats alone without a split view", () => {
    expect(sessionPagePanelSessionFor({ ...page, split: null })("other")).toBe("other");
  });
});

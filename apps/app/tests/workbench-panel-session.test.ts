import { describe, expect, test } from "bun:test";

import { panelSessionForFileLink } from "../src/react-app/domains/session/chat/workbench-panel-session";
import { NO_SESSION_SIDE_PANEL_KEY } from "../src/react-app/domains/session/panel/side-panel-session";

describe("panelSessionForFileLink", () => {
  const link = {
    sourceSessionId: "side",
    panelSessionId: "main",
    primarySessionId: "main",
    primaryWorkspaceId: "ws",
    split: { workspaceId: "ws", sessionId: "side" },
    splitTakesPanel: false,
  };

  test("shows a split pane file in the main chat's panel when that is the only panel", () => {
    expect(panelSessionForFileLink(link)).toBe("main");
  });

  test("opens the split pane chat's own panel when it can take the panel", () => {
    expect(panelSessionForFileLink({ ...link, splitTakesPanel: true })).toBe("side");
  });

  test("opens the main chat's panel for a main chat file while the split pane's panel shows", () => {
    expect(panelSessionForFileLink({ ...link, sourceSessionId: "main", panelSessionId: "side", splitTakesPanel: true })).toBe("main");
  });

  test("uses the panel on screen for a file from its own chat or from no chat", () => {
    expect(panelSessionForFileLink({ ...link, sourceSessionId: "main" })).toBe("main");
    expect(panelSessionForFileLink({ ...link, sourceSessionId: null })).toBe("main");
  });

  test("keeps a file from another workspace with its own chat", () => {
    expect(panelSessionForFileLink({ ...link, split: { workspaceId: "other", sessionId: "side" } })).toBe("side");
  });

  test("a split pane draft never takes the panel", () => {
    expect(panelSessionForFileLink({ ...link, splitTakesPanel: true, split: { ...link.split, draftDestination: { kind: "new" } } })).toBe("main");
  });

  // Fork case: the main pane has no chat yet, so the panel on screen is the
  // no-session panel. A split pane file still lands there.
  test("shows a split pane file in the no-session panel when the main pane has no chat", () => {
    expect(panelSessionForFileLink({ ...link, primarySessionId: null, panelSessionId: NO_SESSION_SIDE_PANEL_KEY })).toBe(NO_SESSION_SIDE_PANEL_KEY);
  });
});

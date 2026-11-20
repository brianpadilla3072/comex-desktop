import { getSidePanelSessionKey } from "../panel/side-panel-session";

// Which chat's side panel shows an item (a file, an app preview) opened from a
// chat. In a split view only one panel is on screen, so an item from the split
// chat goes to that panel unless the split chat can take the panel itself.
export function panelSessionForChatItem(input: {
  sourceSessionId: string | null;
  panelSessionId: string | null;
  primarySessionId: string | null;
  primaryWorkspaceId: string;
  split: { workspaceId: string; sessionId: string; draftDestination?: unknown } | null;
  splitTakesPanel: boolean;
}): string | null {
  const { sourceSessionId: source, split } = input;
  if (!source || source === input.panelSessionId) return input.panelSessionId;
  if (source === input.primarySessionId) return source;
  if (!split || split.sessionId !== source) return source;
  if (split.workspaceId !== input.primaryWorkspaceId) return source;
  const splitHasOwnPanel = input.splitTakesPanel && !split.draftDestination;
  return splitHasOwnPanel ? source : input.panelSessionId;
}

// The session page's answer: the panel on screen always belongs to the main
// pane (this fork has no side-chat panel), keyed like the side panel state.
export function sessionPagePanelSessionFor(page: {
  selectedSessionId: string | null;
  selectedWorkspaceId: string;
  split: { workspaceId: string; sessionId: string; draftDestination?: unknown } | null;
}): (sourceSessionId: string | null) => string | null {
  return (sourceSessionId) => panelSessionForChatItem({
    sourceSessionId,
    panelSessionId: getSidePanelSessionKey(page.selectedSessionId),
    primarySessionId: page.selectedSessionId,
    primaryWorkspaceId: page.selectedWorkspaceId,
    split: page.split,
    splitTakesPanel: false,
  });
}

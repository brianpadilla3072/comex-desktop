// Which chat's side panel shows a file opened from a chat. In a split view only
// one panel is on screen, so a file from the split chat goes to that panel
// unless the split chat can take the panel itself.
export function panelSessionForFileLink(input: {
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

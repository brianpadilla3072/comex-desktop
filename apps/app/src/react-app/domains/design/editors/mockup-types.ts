import type { DesignManifest } from "@openwork/types/designs";

/**
 * The part of `OpenworkServerClient` the screens editor uses (A implements it; tests pass a fake).
 * Replies are read with `designFromReply`, so only `{ design }` matters. `updateDesignPage` is
 * optional: without it, renaming rewrites design.json through `writeDesignFile`.
 */
export type MockupEditorClient = {
  readDesignFile(workspaceId: string, designId: string, path: string): Promise<Blob>;
  writeDesignFile(workspaceId: string, designId: string, path: string, body: Blob | string): Promise<unknown>;
  addDesignPage(workspaceId: string, designId: string, input: { title?: string; afterPageId?: string; html?: string }): Promise<unknown>;
  reorderDesignPages(workspaceId: string, designId: string, pageIds: string[]): Promise<unknown>;
  deleteDesignPage(workspaceId: string, designId: string, pageId: string): Promise<unknown>;
  updateDesignPage?: (workspaceId: string, designId: string, pageId: string, patch: { title: string }) => Promise<unknown>;
};

export type MockupEditorProps = {
  workspaceId: string;
  design: DesignManifest;
  writable: boolean;
  client: MockupEditorClient;
  onChanged: () => void;
  chatOpen: boolean;
  onAskAgent: (text: string, context?: string) => void;
  /** Changes when the design's files changed outside the editor. */
  reloadKey?: string | number;
};

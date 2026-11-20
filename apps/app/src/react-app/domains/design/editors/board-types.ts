import type { DesignManifest } from "@openwork/types/designs";

/** The part of `OpenworkServerClient` the board editor uses (A implements it; tests pass a fake). */
export type BoardEditorClient = {
  readDesignFile(workspaceId: string, designId: string, path: string): Promise<Blob>;
  writeDesignFile(workspaceId: string, designId: string, path: string, body: Blob | string): Promise<unknown>;
};

/** Props every design editor receives from the editor registry, plus `reloadKey`. */
export type BoardEditorProps = {
  workspaceId: string;
  design: DesignManifest;
  writable: boolean;
  client: BoardEditorClient;
  onChanged: () => void;
  chatOpen: boolean;
  onAskAgent: (text: string, context?: string) => void;
  /** Changes when the design's files changed outside the editor (the agent edited board.json). */
  reloadKey?: string | number;
};

export const BOARD_FILE = "board.json";

import type { DesignManifest } from "@/app/lib/designs";
import type { DesignClient } from "../design-client";

/** What the design page hands to the editor of a kind (registry in `./index.ts`). */
export type DesignEditorProps = {
  workspaceId: string;
  design: DesignManifest;
  /** Owner access (host token or paired device); without it the editor only shows. */
  writable: boolean;
  client: DesignClient;
  /** Call after any change the editor saved: the page reads the design again and refreshes frames. */
  onChanged: () => void;
  /** The agent chat is visible beside the editor. */
  chatOpen: boolean;
  /**
   * Send a request to the design's agent chat (opening it, and starting it when there is none).
   * `context` is extra material for the agent (selected element, page, coordinates…).
   */
  onAskAgent: (text: string, context?: string) => void;
  /** Changes whenever files of the design changed on disk (pass it to `DesignFrame` as `reloadKey`). */
  revision: number;
  /** The same value as `revision`, named like `DesignFrame`'s prop. */
  reloadKey: number;
  /** Show or hide the agent chat (for an editor's own "Chat" button). */
  onToggleChat?: () => void;
  /** Incremented by the page's "Presentar" button (slides): start the presentation when it changes. */
  presentSignal?: number;
};

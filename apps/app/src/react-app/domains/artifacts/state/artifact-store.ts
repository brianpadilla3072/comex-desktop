import { create } from "zustand";

/** UI-only state for the artifact shell: references and preferences, never content.
 *  Content lives in workspace files (server side) and in TanStack Query caches. */
type ArtifactRequest = { artifactId: string; appId: string; label: string; workspaceId?: string };

type ArtifactUiState = {
  focusMode: boolean;
  lastArtifactId: string | null;
  requestedTab: ArtifactRequest | null;
  setFocusMode: (value: boolean) => void;
  rememberArtifact: (id: string) => void;
  requestArtifactTab: (request: ArtifactRequest) => void;
  consumeRequestedTab: () => void;
};

export const useArtifactUiStore = create<ArtifactUiState>()((set) => ({
  focusMode: false,
  lastArtifactId: null,
  requestedTab: null,
  setFocusMode: (focusMode) => set({ focusMode }),
  rememberArtifact: (lastArtifactId) => set({ lastArtifactId }),
  requestArtifactTab: (requestedTab) => set({ requestedTab }),
  consumeRequestedTab: () => set({ requestedTab: null }),
}));

import { create } from "zustand";

export type ConsolidateMemoryRequest = {
  workspaceId: string;
  sessionId: string;
};

export type ConsolidateMemoryStore = {
  open: boolean;
  workspaceId: string | null;
  sessionId: string | null;
  openFor: (workspaceId: string, sessionId: string) => void;
  close: () => void;
};

export const useConsolidateMemoryStore = create<ConsolidateMemoryStore>((set) => ({
  open: false,
  workspaceId: null,
  sessionId: null,
  openFor: (workspaceId, sessionId) => set({ open: true, workspaceId, sessionId }),
  close: () => set({ open: false, workspaceId: null, sessionId: null }),
}));
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type UserMemoryFact = { id: string; text: string; createdAt: number };

export type UserMemoryStore = {
  facts: UserMemoryFact[];
  add: (text: string) => void;
  remove: (id: string) => void;
  clear: () => void;
};

export const useUserMemoryStore = create<UserMemoryStore>()(
  persist(
    (set) => ({
      facts: [],
      add: (text) =>
        set((s) => ({
          facts: [...s.facts, { id: crypto.randomUUID(), text: text.trim(), createdAt: Date.now() }],
        })),
      remove: (id) => set((s) => ({ facts: s.facts.filter((f) => f.id !== id) })),
      clear: () => set({ facts: [] }),
    }),
    { name: "openwork-user-memory" },
  ),
);

export function userMemoryPrompt(): string {
  const facts = useUserMemoryStore.getState().facts;
  if (facts.length === 0) return "";
  return "Memoria del usuario:\n" + facts.map((f) => `- ${f.text}`).join("\n");
}
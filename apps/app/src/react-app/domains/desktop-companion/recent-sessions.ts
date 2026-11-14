import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { CompanionRecentSession } from "@/app/lib/desktop-companion";

export const COMPANION_RECENT_HOUR = 60 * 60 * 1000;
export const companionSessionKey = (workspaceId: string, sessionId: string) => JSON.stringify([workspaceId, sessionId]);
export const companionMemoryKey = (scope: string, workspaceId: string, sessionId: string) => JSON.stringify([scope, workspaceId, sessionId]);
export type CompanionSeen = { responseAt: number; readAt: number };
type Memory = { entries: Record<string, CompanionSeen>; responses: (updates: { key: string; at: number }[]) => void; read: (key: string, responseAt: number) => void };
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }

export const useCompanionSeen = create<Memory>()(persist((set, get) => ({
  entries: {},
  responses: updates => {
    const state = get();
    const now = Date.now(); let changed = false;
    let entries = { ...state.entries };
    for (const { key, at } of updates) {
      if (!Number.isFinite(at) || at <= now - COMPANION_RECENT_HOUR || at > now + 60000 || at <= (entries[key]?.responseAt ?? 0)) continue;
      entries[key] = { responseAt: at, readAt: 0 }; changed = true;
    }
    if (Object.keys(entries).length > 2000) {
      entries = Object.fromEntries(Object.entries(entries).sort((a, b) => Math.max(b[1].responseAt, b[1].readAt) - Math.max(a[1].responseAt, a[1].readAt)).slice(0, 2000)); changed = true;
    }
    if (changed) set({ entries });
  },
  read: (key, responseAt) => {
    const state = get();
    const current = state.entries[key];
    if (!Number.isFinite(responseAt) || responseAt <= Date.now() - COMPANION_RECENT_HOUR || responseAt > Date.now() + 60000 || current && (responseAt < current.responseAt || responseAt === current.responseAt && current.readAt > 0)) return;
    set({ entries: { ...state.entries, [key]: { responseAt: Math.max(responseAt, current?.responseAt ?? 0), readAt: Date.now() } } });
  },
}), {
  name: "openwork.desktopCompanion.seen.v1", skipHydration: true, storage: createJSONStorage(() => localStorage),
  partialize: state => ({ entries: state.entries }),
  merge: (saved, current) => {
    if (!record(saved) || !record(saved.entries)) return current;
    const entries: Record<string, CompanionSeen> = {};
    const now = Date.now();
    for (const [key, value] of Object.entries(saved.entries).slice(-2000)) {
      if (key.length > 2048 || !record(value) || typeof value.responseAt !== "number" || typeof value.readAt !== "number"
        || !Number.isFinite(value.responseAt) || !Number.isFinite(value.readAt) || value.responseAt < 0 || value.readAt < 0
        || Math.max(value.responseAt, value.readAt) > now + 60000) continue;
      entries[key] = { responseAt: value.responseAt, readAt: value.readAt };
    }
    return { ...current, entries };
  },
}));

export type CompanionRecentCandidate = Omit<CompanionRecentSession, "status"> & { waiting: boolean; responseAt: number; readAt: number };
export function buildCompanionRecents(candidates: CompanionRecentCandidate[], now = Date.now()): CompanionRecentSession[] {
  return [...new Map(candidates.map(item => [item.key, item])).values()].filter(item => item.waiting || (Math.max(item.responseAt, item.readAt) <= now + 60000 && Math.max(item.responseAt, item.readAt) > now - COMPANION_RECENT_HOUR))
    .sort((a, b) => Number(b.waiting) - Number(a.waiting) || Math.max(b.responseAt, b.readAt) - Math.max(a.responseAt, a.readAt) || a.key.localeCompare(b.key))
    .slice(0, 6).map(({ waiting, ...session }) => ({ ...session, status: waiting ? "waiting" : session.responseAt > session.readAt ? "unread" : "idle" }));
}

/** One deadline for the inventory, including entries outside the six visible slots. */
export function nextCompanionExpiry(candidates: CompanionRecentCandidate[], now = Date.now()): number | undefined {
  let next = Infinity;
  for (const item of candidates) {
    if (item.waiting) continue;
    const at = Math.max(item.responseAt, item.readAt);
    if (at > now + 60000) next = Math.min(next, at - 60000);
    else if (at + COMPANION_RECENT_HOUR > now) next = Math.min(next, at + COMPANION_RECENT_HOUR);
  }
  return Number.isFinite(next) ? next : undefined;
}

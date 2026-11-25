import { create } from "zustand";

/**
 * Sessions that belong to a video's own chat. They are real OpenCode sessions,
 * but they are not conversations the person started, so the sidebar hides them.
 * Kept in localStorage so a reload does not bring them back.
 */
const STORAGE_KEY = "openwork.video.sessions";

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function write(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Hiding is cosmetic; a failed write only means the session shows again.
  }
}

type VideoSessionRegistry = {
  ids: string[];
  hide: (id: string) => void;
  show: (id: string) => void;
};

export const useVideoSessionRegistry = create<VideoSessionRegistry>((set, get) => ({
  ids: read(),
  hide: (id) => {
    const value = id.trim();
    if (!value || get().ids.includes(value)) return;
    const next = [...get().ids, value];
    write(next);
    set({ ids: next });
  },
  show: (id) => {
    const value = id.trim();
    if (!value || !get().ids.includes(value)) return;
    const next = get().ids.filter((entry) => entry !== value);
    write(next);
    set({ ids: next });
  },
}));

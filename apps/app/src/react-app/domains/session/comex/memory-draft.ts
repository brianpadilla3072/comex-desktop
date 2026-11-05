export type MemoryDraft = { text: string; baseUpdatedAt: number | null };
export function readMemoryDraft(key: string): MemoryDraft | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (raw && typeof raw === "object" && "text" in raw && typeof raw.text === "string" && "baseUpdatedAt" in raw && (raw.baseUpdatedAt === null || typeof raw.baseUpdatedAt === "number")) return { text: raw.text, baseUpdatedAt: raw.baseUpdatedAt };
  } catch { /* Storage can be unavailable. The file remains authoritative. */ }
  return null;
}
export function writeMemoryDraft(key: string, draft: MemoryDraft | null): boolean {
  try { if (draft) localStorage.setItem(key, JSON.stringify(draft)); else localStorage.removeItem(key); return true; }
  catch { return false; }
}

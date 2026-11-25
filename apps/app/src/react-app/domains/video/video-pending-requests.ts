/**
 * Video requests started from the panel that still have no `video-projects/<slug>`
 * folder. The agent creates that folder from the conversation, and until it exists
 * the panel has nothing to list, so the person would lose the request (and the
 * conversation that is working on it). Kept in localStorage, newest first.
 */
export type PendingVideoRequest = {
  sessionId: string;
  idea: string;
  at: number;
};

const STORAGE_KEY = "openwork.video.pending";
const LIMIT = 5;

function read(): PendingVideoRequest[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry): PendingVideoRequest[] => {
      if (!entry || typeof entry !== "object") return [];
      const sessionId = Reflect.get(entry, "sessionId");
      const idea = Reflect.get(entry, "idea");
      const at = Reflect.get(entry, "at");
      if (typeof sessionId !== "string" || !sessionId) return [];
      return [{
        sessionId,
        idea: typeof idea === "string" ? idea : "",
        at: typeof at === "number" ? at : 0,
      }];
    });
  } catch {
    return [];
  }
}

function write(entries: PendingVideoRequest[]): PendingVideoRequest[] {
  const next = [...entries].sort((a, b) => b.at - a.at).slice(0, LIMIT);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Losing the reminder is cosmetic; the conversation still exists.
    }
  }
  return next;
}

export function listPendingVideoRequests(): PendingVideoRequest[] {
  return read().sort((a, b) => b.at - a.at);
}

export function addPendingVideoRequest(entry: PendingVideoRequest): PendingVideoRequest[] {
  return write([entry, ...read().filter((item) => item.sessionId !== entry.sessionId)]);
}

export function removePendingVideoRequest(sessionId: string): PendingVideoRequest[] {
  return write(read().filter((item) => item.sessionId !== sessionId));
}

/**
 * Drops the requests whose conversation already produced a project. `known` holds
 * the session ids linked from every project.json, so the panel stops offering them.
 */
export function prunePendingVideoRequests(known: Iterable<string>): PendingVideoRequest[] {
  const ids = new Set(known);
  if (ids.size === 0) return listPendingVideoRequests();
  return write(read().filter((item) => !ids.has(item.sessionId)));
}

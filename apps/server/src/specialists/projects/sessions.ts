import type { ProjectRecentSession } from "@openwork/types/projects";
import type { ServerConfig, WorkspaceInfo } from "../../types.js";

/**
 * "Recientes" of a project: its newest root sessions, read through this server's own workspace
 * proxy (the same path the app and the command center use, so session homes and directory
 * scoping apply). Best effort: when the engine cannot answer, the list is empty and `complete`
 * is false — never an error for the whole project page.
 */

export type ProjectSessionDeps = {
  request: (request: Request) => Promise<Response>;
  engine: () => "v1" | "v2";
};

let deps: ProjectSessionDeps | undefined;
/** Called once by the server with its in-process fetch (like the scheduler and command center). */
export function configureProjectSessions(next: ProjectSessionDeps | undefined) { deps = next; }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const unwrap = (value: unknown): unknown => isRecord(value) && "data" in value ? value.data : value;
/** Engine timestamps are seconds on some builds and milliseconds on others. */
const millis = (value: unknown): number | null => typeof value !== "number" || !Number.isFinite(value) || value <= 0 ? null : Math.floor(value < 1e12 ? value * 1000 : value);

/** Map the engine's session rows (v1 or v2 shape) to recent sessions, newest first, roots only. */
export function recentSessionsFrom(rows: unknown, limit: number): ProjectRecentSession[] {
  const items = unwrap(rows);
  const list = Array.isArray(items) ? items : isRecord(items) && Array.isArray(items.items) ? items.items : [];
  const sessions: ProjectRecentSession[] = [];
  for (const row of list) {
    const info = isRecord(row) && isRecord(row.info) ? row.info : row;
    if (!isRecord(info) || typeof info.id !== "string") continue;
    if (typeof info.parentID === "string" && info.parentID) continue;
    const time = isRecord(info.time) ? info.time : {};
    if (millis(time.archived) !== null) continue;
    const title = typeof info.title === "string" && info.title.trim() ? info.title.trim() : null;
    sessions.push({ id: info.id, title, updatedAt: millis(time.updated) ?? millis(time.created) });
  }
  return sessions.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0)).slice(0, limit);
}

export async function readRecentSessions(config: ServerConfig, workspace: WorkspaceInfo, limit: number): Promise<{ sessions: ProjectRecentSession[]; complete: boolean }> {
  if (!deps) return { sessions: [], complete: false };
  const engine = deps.engine();
  const path = engine === "v2" ? "opencode2/api/session?limit=200" : "opencode/session?roots=true";
  try {
    const response = await deps.request(new Request(`http://127.0.0.1:${config.port}/workspace/${encodeURIComponent(workspace.id)}/${path}`, {
      headers: { authorization: `Bearer ${config.token}`, "x-openwork-task-recovery": "off" },
      signal: AbortSignal.timeout(5_000),
    }));
    if (!response.ok) { await response.body?.cancel(); return { sessions: [], complete: false }; }
    return { sessions: recentSessionsFrom(await response.json(), limit), complete: true };
  } catch {
    return { sessions: [], complete: false };
  }
}

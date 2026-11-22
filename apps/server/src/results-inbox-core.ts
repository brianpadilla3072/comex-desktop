import { z } from "zod";

/**
 * Results inbox, pure core (docs/features/results-inbox). Item identity, outcome mapping,
 * seen-state retention and output linking are plain data in, data out, pinned by
 * `contracts/results-inbox/v1/vectors.json` so another implementation can match them.
 */

/** Results stay in the inbox (and their seen marks on disk) this long after they ended. */
export const INBOX_RETENTION_MS = 30 * 24 * 60 * 60_000;
/** At most this many seen marks are kept; the oldest marks go first. */
export const INBOX_SEEN_LIMIT = 2_000;
/** At most this many results are listed, newest first. */
export const INBOX_ITEM_LIMIT = 200;
/** A run without a recorded finish is linked to outputs written up to this long after it
 *  started: the scheduler retires any run after 15 minutes. */
export const INBOX_RUN_WINDOW_MS = 15 * 60_000;
/** Outputs linked to one result, at most. */
export const INBOX_OUTPUT_LIMIT = 10;

const APP_ID = "app_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const TASK_ID = "task_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ITEM_ID = new RegExp(`^run:(${APP_ID}):(${TASK_ID}):(\\d{1,15})$`);

export const inboxItemIdSchema = z.string().regex(ITEM_ID);

/** A run is identified by its application, task and start instant (unique per task log). */
export function inboxItemId(applicationId: string, taskId: string, at: number): string {
  return `run:${applicationId}:${taskId}:${at}`;
}

export function parseInboxItemId(id: string): { applicationId: string; taskId: string; at: number } | null {
  const match = ITEM_ID.exec(id);
  if (!match || match[1] === undefined || match[2] === undefined || match[3] === undefined) return null;
  const at = Number(match[3]);
  return Number.isSafeInteger(at) ? { applicationId: match[1], taskId: match[2], at } : null;
}

export const inboxStatusSchema = z.enum(["ok", "failed", "blocked", "skipped"]);
export type InboxStatus = z.infer<typeof inboxStatusSchema>;

/** Finished outcomes only; a run still dispatched is not a result yet. */
export function inboxStatus(runStatus: string): InboxStatus | null {
  if (runStatus === "ok" || runStatus === "failed" || runStatus === "blocked") return runStatus;
  if (runStatus === "skipped_overlap" || runStatus === "skipped_missed") return "skipped";
  return null;
}

/** When a result ended: the observed finish, or the log instant for outcomes without a run. */
export function inboxEndedAt(run: { at: number; finishedAt: number | null }): number {
  return run.finishedAt ?? run.at;
}

export const seenEntrySchema = z.object({ id: inboxItemIdSchema, seenAt: z.number().int().nonnegative() });
export type SeenEntry = z.infer<typeof seenEntrySchema>;

/** On-disk format of `<specialists>/results-inbox.json`. */
export const seenStoreSchema = z.object({
  version: z.literal(1),
  seen: z.array(z.unknown()).max(INBOX_SEEN_LIMIT * 2),
});

/** Drop unreadable marks, marks for runs past retention and duplicates; keep the newest marks. */
export function pruneSeen(entries: readonly unknown[], now: number): SeenEntry[] {
  const byId = new Map<string, SeenEntry>();
  for (const entry of entries) {
    const parsed = seenEntrySchema.safeParse(entry);
    if (!parsed.success) continue;
    const id = parseInboxItemId(parsed.data.id);
    if (!id || now - id.at > INBOX_RETENTION_MS) continue;
    const current = byId.get(parsed.data.id);
    if (!current || current.seenAt < parsed.data.seenAt) byId.set(parsed.data.id, parsed.data);
  }
  return [...byId.values()]
    .sort((left, right) => right.seenAt - left.seenAt || left.id.localeCompare(right.id))
    .slice(0, INBOX_SEEN_LIMIT);
}

/** Mark (or unmark) results as seen. Ids that are not result ids are ignored. */
export function applySeen(entries: readonly SeenEntry[], ids: readonly string[], seen: boolean, now: number): SeenEntry[] {
  const targets = new Set(ids.filter(id => parseInboxItemId(id) !== null));
  const kept = entries.filter(entry => !targets.has(entry.id));
  const added = seen ? [...targets].map(id => ({ id, seenAt: now })) : [];
  return pruneSeen([...added, ...kept], now);
}

export type OutputCandidate = {
  kind: "output" | "artifact";
  id: string;
  title: string;
  type: string;
  workspaceId: string;
  createdAt: number;
  updatedAt: number;
};

/**
 * Outputs a run produced, as far as the data says: written in the same project while the run
 * was in flight. Runs that never ran (blocked, skipped) produce nothing. Newest first.
 */
export function linkOutputs(
  run: { status: InboxStatus; at: number; finishedAt: number | null; workspaceId: string | null },
  candidates: readonly OutputCandidate[],
): OutputCandidate[] {
  if (run.status !== "ok" && run.status !== "failed") return [];
  if (!run.workspaceId) return [];
  const end = run.finishedAt ?? run.at + INBOX_RUN_WINDOW_MS;
  return candidates
    .filter(candidate => candidate.workspaceId === run.workspaceId && candidate.updatedAt >= run.at && candidate.updatedAt <= end)
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
    .slice(0, INBOX_OUTPUT_LIMIT);
}

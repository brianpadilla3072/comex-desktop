import { z } from "zod";

import { t } from "@/i18n";

/**
 * Client copy of the server's `/results-inbox` contract (apps/server/src/results-inbox.ts).
 * Parsed before use: an answer that does not match is a failed read, never an empty inbox.
 */
const outputSchema = z.object({
  kind: z.enum(["output", "artifact"]),
  id: z.string(),
  title: z.string(),
  type: z.string(),
  workspaceId: z.string(),
  updatedAt: z.number(),
});

const statusSchema = z.enum(["ok", "failed", "blocked", "skipped"]);

export const resultsInboxItemSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  applicationName: z.string(),
  taskId: z.string(),
  taskName: z.string(),
  status: statusSchema,
  mode: z.enum(["scheduled", "manual"]),
  detail: z.string().nullable(),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  endedAt: z.number(),
  workspaceId: z.string().nullable(),
  workspaceName: z.string().nullable(),
  sessionId: z.string().nullable(),
  isolation: z.object({ id: z.string(), review: z.enum(["pending", "reviewed"]) }).nullable(),
  outputs: z.array(outputSchema),
  seen: z.boolean(),
  seenAt: z.number().nullable(),
});

const problemSchema = z.object({
  source: z.enum(["applications", "tasks", "outputs", "seen"]),
  id: z.string().nullable(),
  label: z.string(),
  message: z.string(),
});

const countsSchema = z.object({
  total: z.number(),
  unseen: z.number(),
  needsReview: z.number(),
  failed: z.number(),
});

export const resultsInboxSnapshotSchema = z.object({
  enabled: z.literal(true),
  generatedAt: z.number(),
  complete: z.boolean(),
  items: z.array(resultsInboxItemSchema),
  problems: z.array(problemSchema),
  counts: countsSchema,
});

export const resultsInboxSummarySchema = z.object({
  enabled: z.literal(true),
  generatedAt: z.number(),
  complete: z.boolean(),
  counts: countsSchema,
});

export const resultsInboxUpdateSchema = z.object({ updated: z.number() });

export type ResultsInboxItem = z.infer<typeof resultsInboxItemSchema>;
export type ResultsInboxOutput = z.infer<typeof outputSchema>;
export type ResultsInboxSnapshot = z.infer<typeof resultsInboxSnapshotSchema>;
export type ResultsInboxStatus = z.infer<typeof statusSchema>;
export type ResultsInboxFilter = "all" | "review" | "failed";
export type ResultsInboxAction = "review" | "open" | "output";

export const RESULTS_INBOX_FILTERS: ResultsInboxFilter[] = ["all", "review", "failed"];

export function needsReview(item: ResultsInboxItem): boolean {
  return item.isolation?.review === "pending";
}

export function filterResultsInbox(items: readonly ResultsInboxItem[], filter: ResultsInboxFilter): ResultsInboxItem[] {
  if (filter === "review") return items.filter(needsReview);
  if (filter === "failed") return items.filter(item => item.status === "failed" || item.status === "blocked");
  return [...items];
}

const STATUS_KEY: Record<ResultsInboxStatus, string> = {
  ok: "results_inbox.status_ok",
  failed: "results_inbox.status_failed",
  blocked: "results_inbox.status_blocked",
  skipped: "results_inbox.status_skipped",
};

export function resultsInboxStatus(item: ResultsInboxItem): { label: string; tone: "danger" | "neutral" | "muted" } {
  return {
    label: t(STATUS_KEY[item.status]),
    tone: item.status === "failed" || item.status === "blocked" ? "danger" : item.status === "skipped" ? "muted" : "neutral",
  };
}

/** What opening a result does first: a pending review beats the chat, the chat beats an output. */
export function primaryResultsInboxAction(item: ResultsInboxItem): ResultsInboxAction | null {
  if (needsReview(item)) return "review";
  if (item.workspaceId && item.sessionId) return "open";
  if (item.outputs.length > 0) return "output";
  return null;
}

/** Every action a result offers, primary first. */
export function resultsInboxActions(item: ResultsInboxItem): ResultsInboxAction[] {
  const actions: ResultsInboxAction[] = [];
  if (needsReview(item)) actions.push("review");
  if (item.workspaceId && item.sessionId) actions.push("open");
  return actions;
}

const startOfDay = (time: number) => {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

export type ResultsInboxDay = { key: string; label: string; items: ResultsInboxItem[] };

/** Groups newest-first results by the local day they ended on. */
export function groupResultsInboxByDay(items: readonly ResultsInboxItem[], now: number): ResultsInboxDay[] {
  const today = startOfDay(now);
  const yesterday = startOfDay(today - 1);
  const days = new Map<number, ResultsInboxItem[]>();
  for (const item of [...items].sort((left, right) => right.endedAt - left.endedAt)) {
    const day = startOfDay(item.endedAt);
    const list = days.get(day) ?? [];
    list.push(item);
    days.set(day, list);
  }
  return [...days.entries()].map(([day, list]) => ({
    key: String(day),
    label: day === today ? t("results_inbox.day_today") : day === yesterday ? t("results_inbox.day_yesterday")
      : new Date(day).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }),
    items: list,
  }));
}

export function resultsInboxTime(item: ResultsInboxItem): string {
  const time = new Date(item.endedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return item.finishedAt === null ? t("results_inbox.started_at", { time }) : t("results_inbox.finished_at", { time });
}

/** Badge text: the count, capped so the rail stays narrow. */
export function resultsInboxBadge(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}

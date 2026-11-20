import { z } from "zod";

import { t } from "@/i18n";

/**
 * Client copy of the server's `/command-center` contract
 * (apps/server/src/command-center.ts). Parsed before use: an answer that does
 * not match is treated as a failed check, never as an empty list.
 */
const modelSchema = z.object({ providerID: z.string(), modelID: z.string() });

const sessionItemSchema = z.object({
  kind: z.literal("session"),
  id: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string(),
  applicationId: z.string().nullable(),
  applicationName: z.string().nullable(),
  sessionId: z.string(),
  title: z.string().nullable(),
  status: z.enum(["running", "retrying", "waiting_permission", "waiting_question"]),
  engine: z.enum(["v1", "v2"]),
  model: modelSchema.nullable(),
  startedAt: z.number().nullable(),
  updatedAt: z.number().nullable(),
  waitingRequests: z.number(),
  subtasks: z.number(),
  lastError: z.string().nullable(),
});

const taskItemSchema = z.object({
  kind: z.literal("task"),
  id: z.string(),
  applicationId: z.string(),
  applicationName: z.string(),
  taskId: z.string(),
  taskName: z.string(),
  workspaceId: z.string().nullable(),
  workspaceName: z.string().nullable(),
  sessionId: z.string().nullable(),
  status: z.enum(["running", "waiting", "ok", "failed", "blocked", "skipped"]),
  mode: z.enum(["scheduled", "manual"]).nullable(),
  model: modelSchema.nullable(),
  startedAt: z.number().nullable(),
  enabled: z.boolean(),
  nextRunAt: z.number().nullable(),
  lastError: z.string().nullable(),
});

export const commandCenterSnapshotSchema = z.object({
  enabled: z.literal(true),
  generatedAt: z.number(),
  engine: z.enum(["v1", "v2"]),
  complete: z.boolean(),
  items: z.array(z.discriminatedUnion("kind", [sessionItemSchema, taskItemSchema])),
  problems: z.array(z.object({
    source: z.enum(["workspace", "tasks"]),
    id: z.string().nullable(),
    label: z.string(),
    message: z.string(),
  })),
  counts: z.object({ running: z.number(), waiting: z.number(), failed: z.number() }),
});

export type CommandCenterSnapshot = z.infer<typeof commandCenterSnapshotSchema>;
export type CommandCenterItem = CommandCenterSnapshot["items"][number];
export type CommandCenterSessionItem = z.infer<typeof sessionItemSchema>;
export type CommandCenterTaskItem = z.infer<typeof taskItemSchema>;
export type CommandCenterAction = "open" | "stop" | "retry" | "run_now";
export type CommandCenterSection = "waiting" | "running" | "recent";
/** Color marks only what needs attention; a normal state stays neutral (DESIGN V2). */
export type CommandCenterTone = "attention" | "danger" | "neutral" | "muted";

export function commandCenterSection(item: CommandCenterItem): CommandCenterSection {
  switch (item.status) {
    case "waiting":
    case "waiting_permission":
    case "waiting_question":
      return "waiting";
    case "running":
    case "retrying":
      return "running";
    default:
      return "recent";
  }
}

export function commandCenterStatus(item: CommandCenterItem): { label: string; tone: CommandCenterTone } {
  switch (item.status) {
    case "running": return { label: t("command_center.status_running"), tone: "neutral" };
    case "retrying": return { label: t("command_center.status_retrying"), tone: "attention" };
    case "waiting_permission": return { label: t("command_center.status_waiting_permission"), tone: "attention" };
    case "waiting_question": return { label: t("command_center.status_waiting_question"), tone: "attention" };
    case "waiting": return { label: t("command_center.status_waiting"), tone: "attention" };
    case "ok": return { label: t("command_center.status_ok"), tone: "muted" };
    case "failed": return { label: t("command_center.status_failed"), tone: "danger" };
    case "blocked": return { label: t("command_center.status_blocked"), tone: "danger" };
    case "skipped": return { label: t("command_center.status_skipped"), tone: "muted" };
  }
}

/** What a person can do with each row, in display order. */
export function commandCenterActions(item: CommandCenterItem): CommandCenterAction[] {
  const actions: CommandCenterAction[] = [];
  const section = commandCenterSection(item);
  if (item.workspaceId && item.sessionId) actions.push("open");
  if (section !== "recent" && item.workspaceId && item.sessionId) actions.push("stop");
  if (item.kind === "task" && section === "recent") {
    actions.push(item.status === "failed" || item.status === "blocked" ? "retry" : "run_now");
  }
  return actions;
}

export function commandCenterTitle(item: CommandCenterItem): string {
  return item.kind === "task" ? item.taskName : item.title ?? t("command_center.untitled");
}

/** Compact durations read the same in English and Spanish. */
export function formatCommandCenterDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

/** "for 3 min" while it runs, "5 min ago" once it finished, or the last activity when the start is unknown. */
export function commandCenterTiming(item: CommandCenterItem, now: number): string | null {
  const recent = commandCenterSection(item) === "recent";
  if (item.startedAt !== null) {
    const duration = formatCommandCenterDuration(now - item.startedAt);
    return recent ? t("command_center.started_ago", { duration }) : t("command_center.elapsed", { duration });
  }
  if (item.kind === "session" && item.updatedAt !== null) {
    return t("command_center.updated_ago", { duration: formatCommandCenterDuration(now - item.updatedAt) });
  }
  return null;
}

export function groupCommandCenterItems(items: CommandCenterItem[]): Record<CommandCenterSection, CommandCenterItem[]> {
  const groups: Record<CommandCenterSection, CommandCenterItem[]> = { waiting: [], running: [], recent: [] };
  for (const item of items) groups[commandCenterSection(item)].push(item);
  return groups;
}

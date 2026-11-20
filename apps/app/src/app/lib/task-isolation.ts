import { z } from "zod";

/**
 * Isolated task copies and their review (docs/features/task-isolation-review). The server owns
 * the copies; the app lists what changed and sends accept/discard decisions per file. Every
 * payload is validated here before the UI reads it.
 */

export const isolationSummarySchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  workspaceId: z.string(),
  mode: z.enum(["git", "snapshot"]),
  copyPath: z.string(),
  origin: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("task_run"), taskId: z.string(), runAt: z.number() }),
    z.object({ kind: z.literal("session"), sessionId: z.string() }),
  ]),
  sessionId: z.string().nullable(),
  status: z.enum(["active", "closed"]),
  createdAt: z.number(),
  closedAt: z.number().nullable(),
  reviewed: z.number(),
});
export type IsolationSummary = z.infer<typeof isolationSummarySchema>;

export const isolationChangeSchema = z.object({
  path: z.string(),
  change: z.enum(["added", "modified", "deleted"]),
  kind: z.enum(["text", "binary"]),
  type: z.string(),
  size: z.number().nullable(),
  baseSize: z.number().nullable(),
  conflict: z.boolean(),
  alreadyApplied: z.boolean(),
});
export type IsolationChange = z.infer<typeof isolationChangeSchema>;

export const isolationDetailSchema = z.object({
  isolation: isolationSummarySchema,
  busy: z.boolean(),
  changes: z.array(isolationChangeSchema),
});
export type IsolationDetail = z.infer<typeof isolationDetailSchema>;

export const isolationDiffSchema = z.object({
  path: z.string(),
  change: z.enum(["added", "modified", "deleted"]),
  kind: z.enum(["text", "binary"]),
  type: z.string(),
  conflict: z.boolean(),
  before: z.object({ size: z.number().nullable(), sha256: z.string().nullable() }),
  after: z.object({ size: z.number().nullable(), sha256: z.string().nullable() }),
  hunks: z.array(z.object({
    oldStart: z.number(), oldLines: z.number(), newStart: z.number(), newLines: z.number(),
    lines: z.array(z.object({ kind: z.enum(["context", "removed", "added"]), text: z.string() })),
  })),
  truncated: z.boolean(),
});
export type IsolationDiff = z.infer<typeof isolationDiffSchema>;

export const isolationActionResultSchema = z.object({
  isolation: isolationSummarySchema,
  changes: z.array(isolationChangeSchema),
});
export const sessionIsolationSchema = z.object({ applicationId: z.string(), isolation: isolationSummarySchema.nullable() });

/** What the review panel needs from the OpenWork server client; tests pass a fake. */
export type TaskIsolationClient = {
  getTaskIsolation: (applicationId: string, isolationId: string) => Promise<unknown>;
  getTaskIsolationDiff: (applicationId: string, isolationId: string, path: string) => Promise<unknown>;
  acceptTaskIsolationFiles: (applicationId: string, isolationId: string, paths: string[], overwrite?: boolean) => Promise<unknown>;
  discardTaskIsolationFiles: (applicationId: string, isolationId: string, paths: string[]) => Promise<unknown>;
  closeTaskIsolation: (applicationId: string, isolationId: string) => Promise<unknown>;
};
export type SessionIsolationClient = TaskIsolationClient & {
  getSessionIsolation: (workspaceId: string, sessionId: string) => Promise<unknown>;
  isolateSession: (workspaceId: string, sessionId: string) => Promise<unknown>;
};

/** Server error code → i18n key. Unknown codes fall back to the caller's generic message. */
export const ISOLATION_ERROR_KEYS: Record<string, string> = {
  task_isolation_conflict: "task_isolation.error_conflict",
  task_isolation_busy: "task_isolation.error_busy",
  task_isolation_closed: "task_isolation.error_closed",
  task_isolation_not_found: "task_isolation.error_not_found",
  task_isolation_path_unknown: "task_isolation.error_refresh",
  task_isolation_copy_changed: "task_isolation.error_refresh",
  task_isolation_unsafe_path: "task_isolation.error_unsafe",
  task_isolation_too_large: "task_isolation.error_too_large",
  task_isolation_limit: "task_isolation.error_limit",
  task_isolation_no_application: "task_isolation.error_no_application",
  task_isolation_move_unverified: "task_isolation.error_move",
  task_isolation_engine_rejected: "task_isolation.error_move",
  task_isolation_release_failed: "task_isolation.error_move",
  task_isolation_copy_missing: "task_isolation.error_copy_missing",
  unauthorized: "task_isolation.error_owner",
  forbidden: "task_isolation.error_owner",
};

export function isolationErrorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "";
}

/** Human size: bytes, KB or MB with one decimal. */
export function formatBytes(size: number | null): string {
  if (size === null) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

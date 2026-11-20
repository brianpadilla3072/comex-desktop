import { z } from "zod";
import { memoryNoteInputSchema, memoryNoteSchema } from "./scoped-memory.js";

/**
 * The Projects experience (feature `projectsExperience`, docs/features/projects-experience).
 * A project is a workspace (a folder) bound to a specialist application. These schemas are the
 * contract between `openwork-server` (`/specialist-projects*` routes) and the app; both sides import them.
 */

/** Every limit of a project in one place. The server enforces them; the UI shows them. */
export const PROJECT_LIMITS = {
  nameChars: 80,
  descriptionChars: 2_000,
  instructionsChars: 8_000,
  /** Context area capacity: total bytes and file count across all its folders. */
  contextBytes: 50 * 1024 * 1024,
  contextFiles: 500,
  /** A single uploaded file. */
  contextFileBytes: 25 * 1024 * 1024,
  contextFolders: 100,
  /** Folder nesting below the context root (`a/b/c` is depth 3). */
  contextDepth: 6,
  /** Sessions returned in a project's "Recientes". */
  recentSessions: 10,
  /** Context files listed by name in the agent's instructions (the rest are counted). */
  agentContextListing: 40,
} as const;

export const projectPermissionModeSchema = z.enum(["auto", "manual"]);
export type ProjectPermissionMode = z.infer<typeof projectPermissionModeSchema>;

export const projectSummarySchema = z.object({
  workspaceId: z.string(),
  applicationId: z.string(),
  applicationName: z.string(),
  name: z.string(),
  description: z.string(),
  pinned: z.boolean(),
  /** When it was pinned (epoch ms); pinned projects sort by it, newest first. */
  pinnedAt: z.number().int().nullable(),
  /** Last prompt sent in one of its sessions, or the last change to the project (epoch ms). */
  lastActivityAt: z.number().int(),
  createdAt: z.number().int(),
});
export type ProjectSummary = z.infer<typeof projectSummarySchema>;

export const projectListSchema = z.object({
  projects: z.array(projectSummarySchema),
  /** Whether this caller may change projects (owner or paired device). */
  writable: z.boolean(),
});
export type ProjectList = z.infer<typeof projectListSchema>;

const visibleText = (max: number) => z.string().trim().max(max)
  .refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value), "Usa solo texto visible.");

export const projectPatchInputSchema = z.object({
  name: visibleText(PROJECT_LIMITS.nameChars).pipe(z.string().min(1)).optional(),
  description: visibleText(PROJECT_LIMITS.descriptionChars).optional(),
  pinned: z.boolean().optional(),
}).strict().refine(value => value.name !== undefined || value.description !== undefined || value.pinned !== undefined, "Nada que cambiar.");
export type ProjectPatchInput = z.infer<typeof projectPatchInputSchema>;

export const projectUsageSchema = z.object({
  files: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  capacityBytes: z.number().int().positive(),
  capacityFiles: z.number().int().positive(),
  /** 0-100, the larger of the byte and file ratios, rounded down (see contracts/projects/v1). */
  usedPercent: z.number().int().min(0).max(100),
});
export type ProjectUsage = z.infer<typeof projectUsageSchema>;

export const projectRecentSessionSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  updatedAt: z.number().int().nullable(),
});
export type ProjectRecentSession = z.infer<typeof projectRecentSessionSchema>;

export const projectDetailSchema = projectSummarySchema.extend({
  instructions: z.object({ set: z.boolean(), updatedAt: z.number().int().nullable() }),
  context: projectUsageSchema,
  /** `enabled` is false while project memory (comexScopedMemory) is off; the memory routes then answer 404. */
  memory: z.object({ entries: z.number().int().nonnegative(), enabled: z.boolean() }),
  scheduled: z.object({ tasks: z.number().int().nonnegative() }),
  /** Newest first, root sessions only. */
  recentSessions: z.array(projectRecentSessionSchema),
  /** False when the engine could not list the sessions right now (the list may be empty or short). */
  recentSessionsComplete: z.boolean(),
  writable: z.boolean(),
});
export type ProjectDetail = z.infer<typeof projectDetailSchema>;

export const projectInstructionsSchema = z.object({
  text: z.string(),
  updatedAt: z.number().int().nullable(),
  maxChars: z.number().int().positive(),
});
export type ProjectInstructions = z.infer<typeof projectInstructionsSchema>;

/** An empty text removes the instructions. */
export const projectInstructionsInputSchema = z.object({
  text: z.string().max(PROJECT_LIMITS.instructionsChars),
}).strict();

export const projectContextEntrySchema = z.object({
  kind: z.enum(["file", "folder"]),
  name: z.string(),
  /** Relative to the context root, with `/` separators. */
  path: z.string(),
  /** Bytes; for a folder, the total of every file below it. */
  size: z.number().int().nonnegative(),
  /** Direct children of a folder; null for a file. */
  items: z.number().int().nonnegative().nullable(),
  updatedAt: z.number().int(),
});
export type ProjectContextEntry = z.infer<typeof projectContextEntrySchema>;

export const projectContextListingSchema = z.object({
  /** The folder listed ("" is the context root). */
  path: z.string(),
  /** Folders first, then files, each by name. */
  entries: z.array(projectContextEntrySchema),
  usage: projectUsageSchema,
  /** Workspace-relative folder the agent reads (for example `proyecto/contexto`). */
  agentPath: z.string(),
});
export type ProjectContextListing = z.infer<typeof projectContextListingSchema>;

export const projectContextChangeSchema = z.object({
  entry: projectContextEntrySchema.nullable(),
  usage: projectUsageSchema,
});
export type ProjectContextChange = z.infer<typeof projectContextChangeSchema>;

export const projectMemorySchema = z.object({
  revision: z.number().int().nonnegative(),
  notes: z.array(memoryNoteSchema),
  writable: z.boolean(),
  maxNotes: z.number().int().positive(),
  maxChars: z.number().int().positive(),
});
export type ProjectMemory = z.infer<typeof projectMemorySchema>;

const revisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
/** Without `id` a note is added; with it, that note is replaced. */
export const projectMemorySaveInputSchema = z.object({ expectedRevision: revisionSchema, text: memoryNoteInputSchema, id: z.string().uuid().optional() }).strict();
/** `DELETE /specialist-projects/:workspaceId/memory/:noteId?expectedRevision=N`. */
export const projectMemoryDeleteQuerySchema = z.object({ expectedRevision: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) });

const hour = z.number().int().min(0).max(23);
const minute = z.number().int().min(0).max(59);
/** Same shapes as the existing scheduled tasks (apps/server/src/specialists/tasks.ts). */
export const projectTaskScheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("interval"), everyMinutes: z.number().int().min(1).max(43_200) }),
  z.object({ kind: z.literal("daily"), hour, minute }),
  z.object({ kind: z.literal("weekly"), daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7), hour, minute }),
  z.object({ kind: z.literal("monthly"), dayOfMonth: z.number().int().min(1).max(31), hour, minute }),
  z.object({ kind: z.literal("once"), at: z.number().int() }),
]);
export type ProjectTaskSchedule = z.infer<typeof projectTaskScheduleSchema>;

export const projectTaskModelSchema = z.object({ providerID: z.string().min(1).max(120), modelID: z.string().min(1).max(200) });

export const projectTaskAdvancedSchema = z.object({
  /** Run once after the computer was off or asleep at the scheduled time. */
  catchUp: z.boolean(),
  /** Work in an isolated copy whose changes wait for review (only while `taskIsolation` is available). */
  isolation: z.boolean(),
});
export type ProjectTaskAdvanced = z.infer<typeof projectTaskAdvancedSchema>;

export const projectTaskSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  /** The project the task runs in. Null for older tasks: they run in the application's first project. */
  workspaceId: z.string().nullable(),
  name: z.string(),
  prompt: z.string(),
  schedule: projectTaskScheduleSchema,
  model: projectTaskModelSchema.nullable(),
  enabled: z.boolean(),
  permissionMode: projectPermissionModeSchema,
  advanced: projectTaskAdvancedSchema,
  nextRunAt: z.number().int().nullable(),
  lastRunAt: z.number().int().nullable(),
  lastStatus: z.enum(["ok", "failed", "blocked", "running", "skipped"]).nullable(),
  runs: z.number().int().nonnegative(),
  running: z.boolean(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type ProjectTask = z.infer<typeof projectTaskSchema>;

export const projectTaskListSchema = z.object({
  applicationId: z.string(),
  tasks: z.array(projectTaskSchema),
  capabilities: z.object({
    /** `POST /specialist-applications/:id/tasks/:taskId/dry-run` answers. */
    dryRun: z.boolean(),
    /** `advanced.isolation` has an effect (feature taskIsolationReview). */
    isolation: z.boolean(),
  }),
  /** Tasks per application (all projects together). */
  limit: z.number().int().positive(),
  writable: z.boolean(),
});
export type ProjectTaskList = z.infer<typeof projectTaskListSchema>;

/** Body of `POST /specialist-applications/:id/tasks` and `PUT .../tasks/:taskId` (all optional on PUT). */
export const projectTaskInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(8_000),
  schedule: projectTaskScheduleSchema,
  model: projectTaskModelSchema.nullable().optional(),
  workspaceId: z.string().min(1).max(200).optional(),
  permissionMode: projectPermissionModeSchema.optional(),
  advanced: projectTaskAdvancedSchema.partial().optional(),
  enabled: z.boolean().optional(),
});
export type ProjectTaskInput = z.infer<typeof projectTaskInputSchema>;

/** `usedPercent` of a project's context area: the fuller of bytes and files, floored, 0-100. */
export function projectUsagePercent(usage: { files: number; bytes: number }, capacity = { bytes: PROJECT_LIMITS.contextBytes, files: PROJECT_LIMITS.contextFiles }): number {
  const ratio = Math.max(usage.bytes / capacity.bytes, usage.files / capacity.files);
  return Math.max(0, Math.min(100, Math.floor(ratio * 100)));
}

/** Default order of the registry: pinned first (most recently pinned on top), then most recent activity, then name. */
export function compareProjects(left: Pick<ProjectSummary, "pinnedAt" | "lastActivityAt" | "name" | "workspaceId">, right: Pick<ProjectSummary, "pinnedAt" | "lastActivityAt" | "name" | "workspaceId">): number {
  if ((left.pinnedAt === null) !== (right.pinnedAt === null)) return left.pinnedAt === null ? 1 : -1;
  if (left.pinnedAt !== null && right.pinnedAt !== null && left.pinnedAt !== right.pinnedAt) return right.pinnedAt - left.pinnedAt;
  if (left.lastActivityAt !== right.lastActivityAt) return right.lastActivityAt - left.lastActivityAt;
  const byName = left.name.localeCompare(right.name, "es", { sensitivity: "base" });
  return byName || (left.workspaceId < right.workspaceId ? -1 : left.workspaceId > right.workspaceId ? 1 : 0);
}

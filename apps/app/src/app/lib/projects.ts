import { z } from "zod";
import {
  PROJECT_LIMITS,
  compareProjects,
  projectContextChangeSchema,
  projectContextEntrySchema,
  projectContextListingSchema,
  projectDetailSchema,
  projectInstructionsSchema,
  projectListSchema,
  projectMemorySchema,
  projectPatchInputSchema,
  projectPermissionModeSchema,
  projectSummarySchema,
  projectTaskAdvancedSchema,
  projectTaskInputSchema,
  projectTaskListSchema,
  projectTaskSchema,
  projectTaskScheduleSchema,
  projectUsagePercent,
  projectUsageSchema,
} from "@openwork/types/projects";

/**
 * Client side of the Projects experience (feature `projectsExperience`). The schemas are the
 * server's own (`@openwork/types/projects`); every client method in `openwork-server.ts` parses
 * its response with one of them. API table: docs/features/projects-experience/README.md.
 */

export {
  PROJECT_LIMITS,
  compareProjects,
  projectContextChangeSchema,
  projectContextEntrySchema,
  projectContextListingSchema,
  projectDetailSchema,
  projectInstructionsSchema,
  projectListSchema,
  projectMemorySchema,
  projectPatchInputSchema,
  projectPermissionModeSchema,
  projectSummarySchema,
  projectTaskAdvancedSchema,
  projectTaskInputSchema,
  projectTaskListSchema,
  projectTaskSchema,
  projectTaskScheduleSchema,
  projectUsagePercent,
  projectUsageSchema,
};
export type {
  ProjectContextChange,
  ProjectContextEntry,
  ProjectContextListing,
  ProjectDetail,
  ProjectInstructions,
  ProjectList,
  ProjectMemory,
  ProjectPatchInput,
  ProjectPermissionMode,
  ProjectRecentSession,
  ProjectSummary,
  ProjectTask,
  ProjectTaskAdvanced,
  ProjectTaskInput,
  ProjectTaskList,
  ProjectTaskSchedule,
  ProjectUsage,
} from "@openwork/types/projects";

/** `PATCH /specialist-projects/:workspaceId` answers the updated summary. */
export const projectPatchResponseSchema = z.object({ project: projectSummarySchema });

/**
 * `POST`/`PUT /specialist-applications/:id/tasks[/:taskId]` answer the stored task (plus the
 * application's list and a budget estimate, which the project UI does not need).
 */
export const projectTaskSavedSchema = z.object({
  task: z.object({
    id: z.string(), name: z.string(), prompt: z.string(), schedule: projectTaskScheduleSchema,
    model: z.object({ providerID: z.string(), modelID: z.string() }).nullable().optional(),
    enabled: z.boolean(), catchUp: z.boolean().optional(),
    workspaceId: z.string().nullable().optional(),
    permissionMode: projectPermissionModeSchema.optional(),
    isolation: z.boolean().optional(),
    nextRunAt: z.number().nullable(),
  }).passthrough(),
});
export type ProjectTaskSaved = z.infer<typeof projectTaskSavedSchema>;

/** Stable error codes the project routes answer (the UI maps them to `projects_ui.*` texts). */
export const PROJECT_ERROR_CODES = [
  "projects_disabled", "project_not_found", "invalid_project", "project_rename_unavailable",
  "instructions_too_long", "instructions_unsafe_file",
  "context_path_required", "context_path_invalid", "context_path_hidden", "context_path_too_deep", "context_name_too_long",
  "context_not_found", "context_exists", "context_unsafe_folder", "context_unsafe_path", "context_file_required",
  "context_file_too_large", "context_capacity_bytes", "context_capacity_files", "context_capacity_folders", "insufficient_storage",
  "scoped_memory_disabled", "memory_invalid_note", "memory_conflict", "memory_note_missing", "memory_full", "memory_secret",
  "scheduled_tasks_disabled", "invalid_task", "workspace_not_bound", "task_limit", "task_exists",
] as const;
export type ProjectErrorCode = (typeof PROJECT_ERROR_CODES)[number];
export const isProjectErrorCode = (code: string): code is ProjectErrorCode => PROJECT_ERROR_CODES.some(known => known === code);

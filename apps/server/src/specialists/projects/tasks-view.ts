import { z } from "zod";
import { projectTaskAdvancedSchema, projectPermissionModeSchema, type ProjectTask } from "@openwork/types/projects";
import { ApiError } from "../../errors.js";
import type { SpecialistTask, TaskOwnerSettings } from "../tasks.js";

/** The project view of a stored task (what `GET /specialist-projects/:workspaceId/tasks` returns). */
export function toProjectTask(applicationId: string, task: SpecialistTask): ProjectTask {
  return {
    id: task.id, applicationId, workspaceId: task.workspaceId, name: task.name, prompt: task.prompt,
    schedule: task.schedule, model: task.model, enabled: task.enabled, permissionMode: task.permissionMode,
    advanced: { catchUp: task.catchUp, isolation: task.isolation },
    nextRunAt: task.nextRunAt, lastRunAt: task.lastRunAt, lastStatus: task.lastStatus, runs: task.runs,
    running: task.running !== null, createdAt: task.createdAt, updatedAt: task.updatedAt,
  };
}

/** The owner-only part of a task body on the application task routes (projectsExperience). */
export const taskOwnerBodySchema = z.object({
  workspaceId: z.string().min(1).max(200).nullable().optional(),
  permissionMode: projectPermissionModeSchema.optional(),
  advanced: projectTaskAdvancedSchema.partial().optional(),
});

/** Split the owner settings out of a task body; `catchUp` may come at the top or in `advanced`. */
export function ownerTaskSettings(body: Record<string, unknown>, boundWorkspaceIds: readonly string[]): { owner: TaskOwnerSettings; catchUp: boolean | undefined } {
  const parsed = taskOwnerBodySchema.safeParse(body);
  if (!parsed.success) throw new ApiError(422, "invalid_task", "Revisa el proyecto, el modo de permisos y la configuración avanzada de la tarea.");
  const { workspaceId, permissionMode, advanced } = parsed.data;
  if (workspaceId && !boundWorkspaceIds.includes(workspaceId)) throw new ApiError(403, "workspace_not_bound", "Ese proyecto no pertenece a esta aplicación.");
  return {
    owner: {
      ...(workspaceId !== undefined ? { workspaceId } : {}),
      ...(permissionMode !== undefined ? { permissionMode } : {}),
      ...(advanced?.isolation !== undefined ? { isolation: advanced.isolation } : {}),
    },
    catchUp: advanced?.catchUp,
  };
}

/** Does this task run in `workspaceId`? Its own project, or the first live one when it names none. */
export function runsInProject(task: Pick<SpecialistTask, "workspaceId">, workspaceId: string, firstLiveWorkspaceId: string | null): boolean {
  return task.workspaceId ? task.workspaceId === workspaceId : firstLiveWorkspaceId === workspaceId;
}

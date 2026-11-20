import { useQuery } from "@tanstack/react-query";

import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import { useCommandCenterConnection } from "@/react-app/domains/command-center/use-command-center";

/** What the project page and its dialogs call on `openwork-server` (a fake in tests). */
export type ProjectPageClient = Pick<OpenworkServerClient,
  | "baseUrl" | "getProject" | "updateProject" | "getProjectInstructions" | "setProjectInstructions"
  | "listProjectContext" | "uploadProjectContextFile" | "createProjectContextFolder" | "deleteProjectContextEntry"
  | "getProjectMemory" | "saveProjectMemoryNote" | "deleteProjectMemoryNote"
  | "listProjectTasks" | "createProjectTask" | "updateProjectTask"
  | "runSpecialistTaskNow" | "dryRunSpecialistTask" | "deleteSpecialistTask" | "listEngineModels">;

export const projectQueryKeys = {
  all: (baseUrl: string, workspaceId: string) => ["project", baseUrl, workspaceId] as const,
  detail: (baseUrl: string, workspaceId: string) => ["project", baseUrl, workspaceId, "detail"] as const,
  instructions: (baseUrl: string, workspaceId: string) => ["project", baseUrl, workspaceId, "instructions"] as const,
  context: (baseUrl: string, workspaceId: string, path: string) => ["project", baseUrl, workspaceId, "context", path] as const,
  contextAll: (baseUrl: string, workspaceId: string) => ["project", baseUrl, workspaceId, "context"] as const,
  memory: (baseUrl: string, workspaceId: string) => ["project", baseUrl, workspaceId, "memory"] as const,
  tasks: (baseUrl: string, workspaceId: string) => ["project", baseUrl, workspaceId, "tasks"] as const,
  models: (baseUrl: string, workspaceId: string) => ["project", baseUrl, workspaceId, "models"] as const,
};

/** Owner connection (host token on the desktop, the paired token in a paired browser). */
export const useProjectPageConnection = useCommandCenterConnection;

/** Models the engine of this project offers, for the scheduled-task model selector. */
export function useProjectEngineModels(client: ProjectPageClient, workspaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: projectQueryKeys.models(client.baseUrl, workspaceId),
    queryFn: async () => {
      const raw = await client.listEngineModels(workspaceId);
      const list = Array.isArray(raw) ? raw : raw.data ?? [];
      return list.flatMap(entry => {
        const providerID = typeof entry.providerID === "string" ? entry.providerID : "";
        const modelID = typeof entry.id === "string" ? entry.id : typeof entry.modelID === "string" ? entry.modelID : "";
        return providerID && modelID ? [{ providerID, modelID, name: typeof entry.name === "string" && entry.name ? entry.name : modelID }] : [];
      });
    },
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}

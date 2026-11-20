import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { t } from "@/i18n";
import { OpenworkServerError, type OpenworkServerClient } from "@/app/lib/openwork-server";
import type { ProjectList } from "@/app/lib/projects";
import { useCommandCenterConnection } from "@/react-app/domains/command-center/use-command-center";

import { withProjectPinned } from "./projects-list-model";

export type ProjectsListClient = Pick<OpenworkServerClient, "baseUrl" | "listProjects" | "updateProject">;

/** Every reader of the project list (page, sidebar "Fijados") shares this cache entry. */
export const projectsListQueryKey = (baseUrl: string): [string, string] => ["projects", baseUrl];

/** The owner connection the command center uses (host token, or a paired device's token). */
export const useProjectsConnection = useCommandCenterConnection;

/**
 * The `projectsExperience` flag as the server resolves it. `known` stays false until the server
 * answered, so a slow or failed read never hides or redirects. Shares the cache entry every other
 * `/comex/features` reader uses.
 */
export function useProjectsAvailability(): { enabled: boolean; known: boolean } {
  const connection = useProjectsConnection();
  const client = connection.data ?? null;
  const query = useQuery({
    queryKey: ["comex-feature", client?.baseUrl],
    queryFn: () => {
      if (!client) throw new Error("No connection");
      return client.getComexFeatures();
    },
    enabled: Boolean(client),
    staleTime: 15_000,
    refetchInterval: 15_000,
    retry: false,
  });
  if (connection.isSuccess && !client) return { enabled: false, known: true };
  return { enabled: Boolean(client && query.data?.projectsExperience === true), known: query.isSuccess };
}

export function useProjectsList(client: ProjectsListClient | null, enabled = true) {
  return useQuery({
    queryKey: projectsListQueryKey(client?.baseUrl ?? ""),
    queryFn: () => {
      if (!client) throw new Error("No connection");
      return client.listProjects();
    },
    enabled: enabled && Boolean(client),
    retry: false,
    staleTime: 10_000,
    refetchInterval: enabled ? 30_000 : false,
    refetchOnWindowFocus: true,
  });
}

/** The project list for the sidebar: the owner connection, only while the flag is on. */
export function useSidebarProjects(enabled: boolean): ProjectList | null {
  const connection = useProjectsConnection();
  const query = useProjectsList(connection.data ?? null, enabled);
  return enabled ? query.data ?? null : null;
}

/** Pin or unpin: the card moves at once and goes back if the server refuses. */
export function useProjectPin(client: ProjectsListClient) {
  const queryClient = useQueryClient();
  const queryKey = projectsListQueryKey(client.baseUrl);
  return useMutation({
    mutationFn: ({ workspaceId, pinned }: { workspaceId: string; pinned: boolean }) => client.updateProject(workspaceId, { pinned }),
    onMutate: async ({ workspaceId, pinned }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ProjectList>(queryKey);
      if (previous) queryClient.setQueryData<ProjectList>(queryKey, withProjectPinned(previous, workspaceId, pinned, Date.now()));
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData<ProjectList>(queryKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
}

/** What a person reads when a project request fails. */
export function projectsErrorText(cause: unknown): string {
  if (cause instanceof OpenworkServerError) {
    if (cause.status === 401 || cause.status === 403) return t("projects_ui.error_read_only");
    if (cause.code === "projects_disabled") return t("projects_ui.error_disabled");
    if (cause.code === "project_not_found") return t("projects_ui.error_not_found");
  }
  return cause instanceof Error && cause.message.trim() ? cause.message : t("projects_ui.error_unknown");
}

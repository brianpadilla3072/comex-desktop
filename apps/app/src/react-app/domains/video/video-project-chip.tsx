/** @jsxImportSource react */
import { useQuery } from "@tanstack/react-query";
import { Clapperboard } from "lucide-react";

import type { VideoProjectSummary } from "@/app/lib/openwork-server";
import { useWorkspaceMaybe } from "@/react-app/shell/workspace-provider";
import { useUiStateStore } from "@/react-app/shell/ui-state-store";

type LinkedProject = { slug: string; title: string; createdAt: string | undefined };

type ProjectOrigin = { sessionId?: string; title?: string; createdAt?: string };

/**
 * `video-projects/<slug>/project.json` carries the session that asked for the
 * video. Read it from the workspace so the link works even when the server
 * summary does not include it.
 */
async function readOrigin(
  client: NonNullable<ReturnType<typeof useWorkspaceMaybe>>["openworkServerClient"],
  workspaceId: string,
  slug: string,
): Promise<ProjectOrigin | null> {
  if (!client) return null;
  try {
    const file = await client.readWorkspaceFile(workspaceId, `video-projects/${slug}/project.json`);
    const parsed: unknown = JSON.parse(file.content.replace(/^\uFEFF/, ""));
    if (!parsed || typeof parsed !== "object") return null;
    const sessionId = Reflect.get(parsed, "sessionId");
    const title = Reflect.get(parsed, "title");
    const createdAt = Reflect.get(parsed, "createdAt");
    return {
      sessionId: typeof sessionId === "string" ? sessionId : undefined,
      title: typeof title === "string" ? title : undefined,
      createdAt: typeof createdAt === "string" ? createdAt : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * One icon for the video requested from this conversation. Clicking opens the
 * video panel on that project; the panel lists the rest.
 *
 * It follows the same switch as the sidebar destination: Settings › Video ›
 * "Show the Video panel" turns both off, so the two entries never disagree.
 */
export function VideoProjectChip({ sessionId }: { sessionId?: string }) {
  const workspace = useWorkspaceMaybe();
  const client = workspace?.openworkServerClient;
  const workspaceId = workspace?.workspaceId;
  const sectionVisible = useUiStateStore((state) => state.videoSidebarSectionVisible);

  const linked = useQuery({
    queryKey: ["video-projects-linked", workspaceId, sessionId],
    enabled: Boolean(client && workspaceId && sectionVisible),
    staleTime: 10_000,
    retry: false,
    queryFn: async (): Promise<{ total: number; linked: LinkedProject[] }> => {
      if (!client || !workspaceId) return { total: 0, linked: [] };
      let projects: VideoProjectSummary[] = [];
      try {
        projects = (await client.getVideoProjects(workspaceId)).projects;
      } catch {
        // Video studio can be off on the server; the icon stays hidden.
        return { total: 0, linked: [] };
      }
      if (!sessionId) return { total: projects.length, linked: [] };
      const withOrigin = await Promise.all(
        projects.slice(0, 20).map(async (project) => {
          const fromSummary = project.project;
          if (fromSummary?.sessionId) {
            return fromSummary.sessionId === sessionId
              ? {
                  slug: project.slug,
                  title: fromSummary.title?.trim() || project.slug,
                  createdAt: fromSummary.createdAt,
                }
              : null;
          }
          const origin = await readOrigin(client, workspaceId, project.slug);
          return origin?.sessionId === sessionId
            ? { slug: project.slug, title: origin.title?.trim() || project.slug, createdAt: origin.createdAt }
            : null;
        }),
      );
      return {
        total: projects.length,
        linked: withOrigin.filter((entry): entry is LinkedProject => entry !== null),
      };
    },
  });

  const latest = [...(linked.data?.linked ?? [])].sort((a, b) =>
    (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
  )[0];
  // The icon belongs to the workspace, not to the session: it opens the latest
  // video this conversation asked for, or the panel itself.
  if (!sectionVisible) return null;
  if (!workspaceId || (linked.data?.total ?? 0) === 0) return null;

  const target = latest ? `?project=${encodeURIComponent(latest.slug)}` : "";
  const label = latest
    ? `Abrir «${latest.title}» en el panel de video`
    : "Abrir el panel de video";

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => {
        window.location.hash = `#/workspace/${workspaceId}/video${target}`;
      }}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-gray-10 transition-colors hover:bg-gray-3 hover:text-gray-12"
    >
      <Clapperboard className="size-4" aria-hidden="true" />
    </button>
  );
}

/** @jsxImportSource react */
import { FolderClosed } from "lucide-react";

import { t } from "@/i18n";
import type { ProjectSummary } from "@/app/lib/projects";
import { SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

/** What the sidebar needs from the Projects experience; absent while `projectsExperience` is off. */
export type SidebarProjects = {
  /** `/projects` or a project page is on screen. */
  active: boolean;
  /** The project whose page is on screen. */
  activeProjectId: string | null;
  /** Pinned projects, in pin order; empty while unknown. */
  pinned: ProjectSummary[];
  onOpen: () => void;
  onOpenProject: (workspaceId: string) => void;
};

export type SidebarDestinationId = "search" | "projects" | "artifacts" | "scheduled" | "extensions" | "command-center" | "inbox";

/** Today's order of the destinations under "New session" (no Projects entry). */
const LEGACY_ORDER: SidebarDestinationId[] = ["artifacts", "scheduled", "command-center", "inbox", "extensions"];
/** With the Projects experience: Crear, Buscar, Proyectos, Artefactos, Programadas, Complementos, then the rest. */
const PROJECTS_ORDER: SidebarDestinationId[] = ["search", "projects", "artifacts", "scheduled", "extensions", "command-center", "inbox"];

/** The destinations to show, in order; `available` leaves out the ones this window cannot open. */
export function sidebarDestinationOrder(projectsOn: boolean, available: ReadonlySet<SidebarDestinationId>): SidebarDestinationId[] {
  return (projectsOn ? PROJECTS_ORDER : LEGACY_ORDER).filter(id => available.has(id));
}

/** "Fijados": the pinned projects, each opening its project page. Nothing renders without pins. */
export function PinnedProjectsGroup({ projects, activeProjectId, onOpenProject }: {
  projects: ProjectSummary[];
  activeProjectId: string | null;
  onOpenProject: (workspaceId: string) => void;
}) {
  if (!projects.length) return null;
  return <SidebarGroup data-pinned-projects className="pb-0 pt-4">
    <SidebarGroupContent>
      <p className="mb-1 px-2 text-sm text-muted-foreground">{t("projects_ui.pinned_group")}</p>
      <SidebarMenu>
        {projects.map(project => <SidebarMenuItem key={project.workspaceId}>
          <SidebarMenuButton data-pinned-project={project.workspaceId} isActive={activeProjectId === project.workspaceId}
            aria-current={activeProjectId === project.workspaceId ? "page" : undefined}
            onClick={() => onOpenProject(project.workspaceId)} title={project.name}>
            <FolderClosed className="size-4" aria-hidden />
            <span className="truncate">{project.name}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>)}
      </SidebarMenu>
    </SidebarGroupContent>
  </SidebarGroup>;
}

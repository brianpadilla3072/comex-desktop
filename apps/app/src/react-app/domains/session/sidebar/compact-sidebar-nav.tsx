/** @jsxImportSource react */
import { Activity, Blocks, Clock3, Download, FolderClosed, Home, Inbox, LayoutGrid, Palette, Search, type LucideIcon } from "lucide-react";
import { t } from "@/i18n";
import { ResultsInboxBadge, resultsInboxNavLabel } from "../../results-inbox/results-inbox-badge";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";

export function CompactSidebarNav({ onNewTask, newTaskDisabled, onSearch, onDashboard, dashboardLabel = "Resultados", dashboardActive,
  onAutomations, automationsActive, automationsNeedAttention, onCommandCenter, commandCenterActive, onResultsInbox, resultsInboxActive, resultsInboxUnread, onExtensions, extensionsActive, onInstallSkillsTools, referenceLabels = false, onProjects, onProjectsPage, projectsPageActive, onDesign, designActive }: {
  /** Projects experience: opens `/projects`; absent while `projectsExperience` is off (today's rail). */
  onProjectsPage?: () => void; projectsPageActive?: boolean;
  /** Design studio: opens `/design`; absent while `designStudio` is off. */
  onDesign?: () => void; designActive?: boolean;
  onCommandCenter?: () => void; commandCenterActive?: boolean;
  onResultsInbox?: () => void; resultsInboxActive?: boolean; resultsInboxUnread?: number | null;
  referenceLabels?: boolean; onProjects?: () => void;
  onNewTask: () => void; newTaskDisabled?: boolean; onSearch?: () => void; onDashboard?: () => void;
  dashboardLabel?: string; dashboardActive?: boolean; onAutomations?: () => void; automationsActive?: boolean;
  automationsNeedAttention?: boolean; onExtensions: () => void; extensionsActive?: boolean;
  onInstallSkillsTools?: () => void;
}) {
  type Entry = { label: string; icon: LucideIcon; action: () => void; active?: boolean; disabled?: boolean; attention?: boolean; badge?: number | null };
  const home: Entry = { label: referenceLabels ? "Inicio" : "Nueva tarea", icon: Home, action: onNewTask, active: !dashboardActive && !automationsActive && !extensionsActive && !commandCenterActive && !resultsInboxActive && !projectsPageActive && !designActive, disabled: newTaskDisabled };
  const commandCenter: Entry[] = onCommandCenter ? [{ label: t("command_center.nav"), icon: Activity, action: onCommandCenter, active: commandCenterActive }] : [];
  const inbox: Entry[] = onResultsInbox ? [{ label: resultsInboxNavLabel(resultsInboxUnread), icon: Inbox, action: onResultsInbox, active: resultsInboxActive, badge: resultsInboxUnread }] : [];
  const design: Entry[] = onDesign ? [{ label: t("design_ui.studio.nav"), icon: Palette, action: onDesign, active: designActive }] : [];
  const install: Entry[] = onInstallSkillsTools ? [{ label: "Instalar skills y herramientas", icon: Download, action: onInstallSkillsTools }] : [];
  // Crear, Buscar, Proyectos, Diseño, Artefactos, Programadas, Complementos, then the rest.
  const entries: Entry[] = onProjectsPage ? [
    home,
    ...(onSearch ? [{ label: t("projects_ui.nav_search"), icon: Search, action: onSearch }] : []),
    { label: t("projects_ui.nav_projects"), icon: FolderClosed, action: onProjectsPage, active: projectsPageActive },
    ...design,
    ...(onDashboard ? [{ label: t("projects_ui.nav_artifacts"), icon: Blocks, action: onDashboard, active: dashboardActive }] : []),
    ...(onAutomations ? [{ label: t("projects_ui.nav_scheduled"), icon: Clock3, action: onAutomations, active: automationsActive, attention: automationsNeedAttention }] : []),
    { label: t("projects_ui.nav_extensions"), icon: LayoutGrid, action: onExtensions, active: extensionsActive },
    ...commandCenter, ...inbox, ...install,
  ] : [
    home,
    ...(onSearch ? [{ label: "Buscar conversaciones", icon: Search, action: onSearch }] : []),
    ...design,
    ...(onDashboard ? [{ label: dashboardLabel, icon: Blocks, action: onDashboard, active: dashboardActive }] : []),
    ...(onAutomations ? [{ label: referenceLabels ? "Tareas programadas" : "Automatizaciones", icon: Clock3, action: onAutomations, active: automationsActive, attention: automationsNeedAttention }] : []),
    ...commandCenter, ...inbox, ...install,
    { label: referenceLabels ? "Complementos" : "Biblioteca", icon: LayoutGrid, action: onExtensions, active: extensionsActive },
  ];
  return <nav aria-label="Navegación compacta" data-compact-sidebar className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto py-3 [scrollbar-width:none]">
    <SidebarMenu className="w-auto gap-2">
      {entries.map(entry => <SidebarMenuItem key={entry.label}>
        <SidebarMenuButton render={<Button variant="ghost" disabled={entry.disabled} />} aria-label={entry.label} tooltip={entry.label} isActive={entry.active} disabled={entry.disabled}
          onClick={entry.action} className="relative mx-auto size-9! justify-center rounded-lg p-2! text-muted-foreground data-active:text-foreground">
          <entry.icon className="size-4" strokeWidth={1.5} />
          {entry.attention ? <span aria-label="Necesita atención" className="absolute top-1 right-1 size-1.5 rounded-full bg-amber-9" /> : null}
          {entry.badge ? <ResultsInboxBadge count={entry.badge} compact /> : null}
        </SidebarMenuButton>
      </SidebarMenuItem>)}
    </SidebarMenu>
  </nav>;
}

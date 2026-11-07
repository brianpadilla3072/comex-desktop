/** @jsxImportSource react */
import { Blocks, Clock3, Folder, Home, LayoutGrid, Search, type LucideIcon } from "lucide-react";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";

export function CompactSidebarNav({ onNewTask, newTaskDisabled, onSearch, onDashboard, dashboardLabel = "Resultados", dashboardActive,
  onAutomations, automationsActive, automationsNeedAttention, onExtensions, extensionsActive, referenceLabels = false, onProjects }: {
  referenceLabels?: boolean; onProjects?: () => void;
  onNewTask: () => void; newTaskDisabled?: boolean; onSearch?: () => void; onDashboard?: () => void;
  dashboardLabel?: string; dashboardActive?: boolean; onAutomations?: () => void; automationsActive?: boolean;
  automationsNeedAttention?: boolean; onExtensions: () => void; extensionsActive?: boolean;
}) {
  const { setOpen } = useSidebar();
  const entries: { label: string; icon: LucideIcon; action: () => void; active?: boolean; disabled?: boolean; attention?: boolean }[] = [
    { label: referenceLabels ? "Inicio" : "Nueva tarea", icon: Home, action: onNewTask, active: !dashboardActive && !automationsActive && !extensionsActive, disabled: newTaskDisabled },
    ...(onSearch ? [{ label: "Buscar conversaciones", icon: Search, action: onSearch }] : []),
    ...(onDashboard ? [{ label: dashboardLabel, icon: Blocks, action: onDashboard, active: dashboardActive }] : []),
    ...(onAutomations ? [{ label: referenceLabels ? "Tareas programadas" : "Automatizaciones", icon: Clock3, action: onAutomations, active: automationsActive, attention: automationsNeedAttention }] : []),
    { label: "Proyectos y conversaciones", icon: Folder, action: onProjects ?? (() => setOpen(true)) },
    { label: referenceLabels ? "Complementos" : "Biblioteca", icon: LayoutGrid, action: onExtensions, active: extensionsActive },
  ];
  return <nav aria-label="Navegación compacta" data-compact-sidebar className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto py-3 [scrollbar-width:none]">
    <SidebarMenu className="w-auto gap-2">
      {entries.map(entry => <SidebarMenuItem key={entry.label}>
        <SidebarMenuButton render={<Button variant="ghost" disabled={entry.disabled} />} aria-label={entry.label} tooltip={entry.label} isActive={entry.active} disabled={entry.disabled}
          onClick={entry.action} className="relative mx-auto size-9! justify-center rounded-lg p-2! text-muted-foreground data-active:text-foreground">
          <entry.icon className="size-4" strokeWidth={1.5} />
          {entry.attention ? <span aria-label="Necesita atención" className="absolute top-1 right-1 size-1.5 rounded-full bg-amber-9" /> : null}
        </SidebarMenuButton>
      </SidebarMenuItem>)}
    </SidebarMenu>
  </nav>;
}

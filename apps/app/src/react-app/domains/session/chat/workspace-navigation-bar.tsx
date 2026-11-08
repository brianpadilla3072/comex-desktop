/** @jsxImportSource react */
import type { ReactNode } from "react"
import { Bot, ArrowLeft, ArrowRight, FileText, FolderOpen, Globe, Link, PanelLeft, Plus, TerminalSquare, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { usePlatform } from "../../../kernel/platform"
import type { WorkspaceResourceTab } from "./workspace-resource-store"
import type { WorkbenchSessionTab } from "./workbench-store"

export function WorkspaceNavigationBar(props: {
  canGoBack: boolean; canGoForward: boolean
  onHistory: (direction: "back" | "forward") => void
  onToggleSidebar: () => void; onTogglePanel?: () => void
  onNewChat: () => void; onSettings: () => void; onFind?: () => void
}) {
  const platform = usePlatform()
  return <div data-workspace-menu-bar className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-sidebar px-2 text-muted-foreground max-md:hidden electron:titlebar-drag electron:pr-32 mac:mac-window-controls-inset">
    <Button variant="ghost" size="icon-sm" aria-label="Atrás" disabled={!props.canGoBack} onClick={() => props.onHistory("back")} className="titlebar-no-drag"><ArrowLeft className="size-4" /></Button>
    <Button variant="ghost" size="icon-sm" aria-label="Adelante" disabled={!props.canGoForward} onClick={() => props.onHistory("forward")} className="titlebar-no-drag"><ArrowRight className="size-4" /></Button>
    <Button variant="ghost" size="icon-sm" aria-label="Mostrar u ocultar panel lateral" onClick={props.onToggleSidebar} className="mr-2 titlebar-no-drag"><PanelLeft className="size-4" /></Button>
    <nav aria-label="Menú de la aplicación" className="flex items-center gap-1 titlebar-no-drag">
      <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="font-normal">Archivo</Button>} /><DropdownMenuContent align="start">
        <DropdownMenuItem onClick={props.onNewChat}>Nuevo chat</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onClick={props.onSettings}>Configuración</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>
      <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="font-normal">Edición</Button>} /><DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => document.execCommand("undo")}>Deshacer</DropdownMenuItem><DropdownMenuItem onClick={() => document.execCommand("redo")}>Rehacer</DropdownMenuItem><DropdownMenuSeparator />
        <DropdownMenuItem disabled={!props.onFind} onClick={props.onFind}>Buscar en la conversación</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>
      <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="font-normal">Ver</Button>} /><DropdownMenuContent align="start">
        <DropdownMenuItem onClick={props.onToggleSidebar}>Mostrar u ocultar panel lateral</DropdownMenuItem><DropdownMenuItem disabled={!props.onTogglePanel} onClick={props.onTogglePanel}>Mostrar u ocultar panel derecho</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>
      <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="font-normal">Ayuda</Button>} /><DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => platform.openLink("https://openworklabs.com/docs")}>Documentación de OpenWork</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>
    </nav>
  </div>
}

export function ConversationTabs(props: {
  tabs: WorkbenchSessionTab[]; workspaceId: string; sessionId: string | null
  onSelect: (tab: WorkbenchSessionTab) => void
  onClose: (tab: WorkbenchSessionTab) => void
  onNew: () => void
  resources?: WorkspaceResourceTab[]; activeResourceId?: string | null
  onSelectResource?: (id: string | null) => void; onCloseResource?: (tab: WorkspaceResourceTab) => void
  split?: boolean; extraAction?: ReactNode
}) {
  return <nav aria-label="Conversaciones abiertas" data-conversation-tabs className="titlebar-no-drag flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1 [scrollbar-width:thin]">
    {props.tabs.map(tab => <div key={`${tab.workspaceId}:${tab.sessionId}`} className={`group flex h-8 max-w-64 shrink-0 items-center gap-1 rounded-lg border px-1 ${(!props.activeResourceId || props.split) && tab.workspaceId === props.workspaceId && tab.sessionId === props.sessionId ? "border-border bg-muted" : "border-transparent text-muted-foreground"}`}>
      <Button variant="ghost" size="sm" className="min-w-0 justify-start px-2 font-normal" aria-current={(!props.activeResourceId || props.split) && tab.workspaceId === props.workspaceId && tab.sessionId === props.sessionId ? "page" : undefined} onClick={() => { props.onSelectResource?.(null); props.onSelect(tab) }} title={tab.title || "Nuevo chat"}><span className="truncate">{tab.title || "Nuevo chat"}</span></Button>
      <Button variant="ghost" size="icon-xs" className="shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100" aria-label={`Cerrar pestaña ${tab.title || "Nuevo chat"}`} onClick={() => props.onClose(tab)}><X className="size-3" /></Button>
    </div>)}
    {!props.sessionId ? <Button variant="ghost" size="sm" className={`shrink-0 rounded-lg border px-3 py-1.5 text-sm ${!props.activeResourceId ? "border-border bg-muted" : "border-transparent text-muted-foreground"}`} onClick={() => props.onSelectResource?.(null)}>Nuevo chat</Button> : null}
    {props.resources?.map(tab => {
      const Icon = tab.kind === "agents" ? Bot : tab.kind === "sources" ? Link : tab.kind === "terminal" ? TerminalSquare : tab.kind === "files" ? FolderOpen : tab.kind === "page" || tab.kind === "artifact" ? FileText : Globe
      return <div key={tab.id} className={`group flex h-8 max-w-64 shrink-0 items-center gap-1 rounded-lg border px-1 ${props.activeResourceId === tab.id ? "border-border bg-muted" : "border-transparent text-muted-foreground"}`}>
        <Button variant="ghost" size="sm" className="min-w-0 gap-2 px-2 font-normal" aria-current={props.activeResourceId === tab.id ? "page" : undefined} title={tab.title} onClick={() => props.onSelectResource?.(tab.id)}><Icon className="size-3.5" /><span className="truncate">{tab.title}</span></Button>
        <Button variant="ghost" size="icon-xs" aria-label={`Cerrar pestaña ${tab.title}`} onClick={() => props.onCloseResource?.(tab)}><X className="size-3" /></Button>
      </div>
    })}
    {props.extraAction}
    <Button variant="ghost" size="icon-sm" className="shrink-0" aria-label="Abrir nueva pestaña" onClick={props.onNew}><Plus className="size-4" /></Button>
  </nav>
}

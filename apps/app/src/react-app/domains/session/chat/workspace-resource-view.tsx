/** @jsxImportSource react */
import { WorkspaceAgentsView } from "./workspace-agents-view";
import { WorkspaceSourcesView } from "./workspace-sources-view";
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, ArrowRight, ChevronDown, FileText, FolderOpen, Globe, MessageCircle, MoreHorizontal, PanelRight, RotateCw, Save, TerminalSquare, X } from "lucide-react"
import type { OpenworkServerClient } from "@/app/lib/openwork-server"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/components/ui/sonner"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { usePlatform } from "../../../kernel/platform"
import { openTargetFromWorkspaceFile, type OpenTarget } from "../artifacts/open-target"
import { WorkspaceFileTree } from "../artifacts/workspace-file-tree"
import { ArtifactPanel } from "../artifacts/artifact-panel"
import { TerminalDock } from "../terminal/terminal-dock"
import { BrowserPanelContent } from "../panel/side-panel"
import { getSidePanelSessionKey } from "../panel/side-panel-session"
import { getElectronBrowser } from "../panel/utils"
import type { BrowserPanelTab } from "../panel/panel-tab-store"
import { resourceAddress, resourcePagePath, useWorkspaceResources, type ResourceKind, type WorkspaceResourceTab, type ResourceRecent } from "./workspace-resource-store"

const ArtifactTextEditor = lazy(() => import("../artifacts/artifact-text-editor").then(module => ({ default: module.ArtifactTextEditor })))

function ResourceBrowser({ tab, scope, active, onClose }: { tab: WorkspaceResourceTab; scope: string; active: boolean; onClose: () => void }) {
  const [nativeTab, setNativeTab] = useState<BrowserPanelTab | null>(null)
  const [failure, setFailure] = useState("")
  const nativeId = useRef(tab.nativeId)
  const platform = usePlatform()
  useEffect(() => {
    if (!active) return
    const bridge = getElectronBrowser()
    if (!bridge) return
    if (!bridge.createTab || !bridge.getState || !tab.url) { setFailure("El navegador integrado no está disponible en este entorno."); return }
    setFailure("")
    let disposed = false
    const createNativeTab = bridge.createTab
    const apply = (state: Awaited<ReturnType<NonNullable<typeof bridge.getState>>>) => {
      const current = state?.tabs?.find(candidate => candidate.id === nativeId.current)
      if (!current || disposed) return
      setNativeTab(current)
      const latest = useWorkspaceResources.getState().workspaces[scope]?.tabs.find(candidate => candidate.id === tab.id)
      if (latest && (latest.title !== current.label || latest.url !== current.url)) {
        useWorkspaceResources.getState().update(scope, tab.id, { title: current.label || current.url, url: current.url })
        if (/^https?:\/\//i.test(current.url)) useWorkspaceResources.getState().record(scope, { kind: "browser", value: current.url, title: current.label || current.url })
      }
    }
    const unsubscribe = bridge.onStateChange?.(apply)
    void (async () => {
      let state = await bridge.getState?.()
      if (disposed) return
      if (!state?.tabs?.some(candidate => candidate.id === nativeId.current)) {
        const created = await createNativeTab(tab.url, tab.ownerSessionId)
        nativeId.current = created.tabId
        useWorkspaceResources.getState().update(scope, tab.id, { nativeId: created.tabId })
        if (disposed) { if (!useWorkspaceResources.getState().workspaces[scope]?.tabs.some(candidate => candidate.id === tab.id)) await bridge.closeTab?.(created.tabId); return }
      }
      if (disposed || !nativeId.current) return
      await bridge.selectTab?.(nativeId.current)
      state = await bridge.getState?.()
      apply(state ?? null)
    })().catch(error => { if (!disposed) setFailure(error instanceof Error ? error.message : "No se pudo abrir el sitio.") })
    return () => { disposed = true; unsubscribe?.() }
  }, [active, scope, tab.id, tab.ownerSessionId])
  if (!active) return null
  if (!getElectronBrowser()) return <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center"><Globe className="size-8 text-muted-foreground" /><h2 className="text-base">{tab.title}</h2><p className="text-sm text-muted-foreground">El navegador integrado está disponible en la aplicación de escritorio.</p><Button onClick={() => { if (tab.url) void platform.openLink(tab.url) }}>Abrir en el navegador</Button></div>
  if (failure) return <div className="p-6" role="alert">{failure}</div>
  return nativeTab ? <div className="flex h-full min-h-0 flex-col"><BrowserPanelContent sessionId={getSidePanelSessionKey(tab.ownerSessionId ?? null)} tab={nativeTab} onClose={onClose} /></div> : <div role="status" aria-label="Abriendo sitio" className="p-4"><Skeleton className="h-8 w-full" /></div>
}

function WorkspacePage({ tab, scope, client, workspaceId }: { tab: WorkspaceResourceTab; scope: string; client: OpenworkServerClient | null; workspaceId: string }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const update = (patch: Partial<WorkspaceResourceTab>) => useWorkspaceResources.getState().update(scope, tab.id, patch)
  const save = async () => {
    const path = resourcePagePath(tab.path ?? "")
    if (!path) { setError("Elegí una ruta relativa del proyecto, por ejemplo paginas/Notas.md."); return }
    if (!client || !workspaceId || saving) return
    const draft = tab.draft ?? ""
    setSaving(true); setError("")
    try {
      // New pages and Save as use the server’s exclusive-create operation.
      const result = await client.writeWorkspaceFile(workspaceId, { path, content: draft, baseUpdatedAt: path === tab.savedPath ? tab.updatedAt ?? -1 : -1, createOnly: path !== tab.savedPath, fileScope: "workspace" })
      update({ path, savedPath: path, savedDraft: draft, updatedAt: result.updatedAt, title: path.split("/").pop() ?? "Página" })
      useWorkspaceResources.getState().record(scope, { kind: "page", value: path, title: path.split("/").pop() ?? path })
      toast.success("Página guardada")
    } catch { setError("No se pudo guardar. Si el archivo ya existe o cambió, elegí otro nombre o abrilo desde Archivos. Tu borrador se conserva.") }
    finally { setSaving(false) }
  }
  const dirty = tab.savedDraft !== (tab.draft ?? "") || tab.savedPath !== tab.path
  return <section className="flex h-full min-h-0 flex-col" aria-label="Editor de página">
    <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
      <Input className="h-8 min-w-40 flex-1" aria-label="Ruta de la página" disabled={saving} value={tab.path ?? ""} onChange={event => update({ path: event.currentTarget.value })} />
      <span className="text-xs text-muted-foreground" role="status">{dirty ? "Borrador local" : "Guardado"}</span>
      <Button size="sm" disabled={!client || saving || !dirty} onClick={() => void save()}><Save className="size-4" />{saving ? "Guardando…" : "Guardar página"}</Button>
    </header>
    {error ? <p role="alert" className="px-4 py-2 text-sm text-destructive">{error}</p> : null}
    <div className="min-h-0 flex-1 overflow-auto"><Suspense fallback={<Skeleton className="m-4 h-40" />}><ArtifactTextEditor value={tab.draft ?? ""} language="markdown" onChange={draft => update({ draft })} /></Suspense></div>
  </section>
}

type ResourceViewProps = {
  sourceEndpoint?: { opencodeBaseUrl: string; token: string };
  onOpenAgentChat?: (sessionId: string) => void;
  onOpenSource?: (target: OpenTarget, sessionId: string) => void;
  scope: string; tabs: WorkspaceResourceTab[]; activeId: string; recents: ResourceRecent[]
  client: OpenworkServerClient | null; workspaceId: string; workspaceRoot: string; sessionId: string | null
  onClose: (tab: WorkspaceResourceTab) => void; onExtensions: () => void
  onSideChat: () => void; onSideChatFocus: () => void; onAssistantToggle: () => void; assistantOpen: boolean
  assistant: ReactNode; visible: boolean
}

export function WorkspaceResourceView(props: ResourceViewProps) {
  const [address, setAddress] = useState("")
  const queryClient = useQueryClient()
  const [allRecents, setAllRecents] = useState(false)
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set())
  const lastActive = useRef(props.activeId)
  if (props.activeId) lastActive.current = props.activeId
  const active = props.tabs.find(tab => tab.id === (props.activeId || lastActive.current)) ?? props.tabs[0]
  const store = useWorkspaceResources.getState
  useEffect(() => {
    if (!props.visible || !active || visited.has(active.id)) return
    setVisited(previous => new Set([...previous, active.id]))
  }, [active?.id, props.visible, visited])
  useEffect(() => { setAddress(active?.kind === "browser" ? active.url ?? "" : "") }, [active?.id, active?.url, active?.kind])
  const open = (kind: ResourceKind, value?: string, ownerSessionId: string | null = props.sessionId, fileScope: "workspace" | "conversation" = "workspace") => {
    store().open(props.scope, kind, value, ownerSessionId, fileScope)
    if (kind !== "new" && kind !== "page") store().record(props.scope, { kind, value: value ?? kind, title: kind === "files" ? "Archivos" : kind === "terminal" ? "Terminal" : value ?? kind, ...(kind === "artifact" ? { ownerSessionId, fileScope } : {}) })
  }
  const navigate = (value: string) => {
    const url = resourceAddress(value)
    if (!url) { toast.error("Introducí una dirección web o una búsqueda válida."); return }
    if (active?.kind === "new" || active?.kind === "browser") store().update(props.scope, active.id, { kind: "browser", url, title: new URL(url).hostname, ownerSessionId: active.ownerSessionId ?? props.sessionId, history: [...(active.history ?? []).slice(0, (active.historyIndex ?? -1) + 1), url], historyIndex: (active.historyIndex ?? -1) + 1 })
    else open("browser", url)
    store().record(props.scope, { kind: "browser", value: url, title: new URL(url).hostname })
  }
  const files = useQuery({ queryKey: ["resource-files", props.client?.baseUrl, props.workspaceId, props.scope], queryFn: () => props.client!.listWorkspaceFiles(props.workspaceId), enabled: active?.kind === "new" && Boolean(props.client && props.workspaceId), staleTime: 30_000 })
  const suggested = props.recents.filter(recent => recent.kind === "browser").slice(0, 3)
  const recentOpen = (recent: ResourceRecent) => open(recent.kind === "page" ? "artifact" : recent.kind, recent.value, recent.ownerSessionId ?? props.sessionId, recent.fileScope ?? "workspace")
  useEffect(() => {
    if (!props.visible) return
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.altKey && event.code === "KeyS") { event.preventDefault(); props.onSideChat(); return }
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() === "l") { event.preventDefault(); document.querySelector<HTMLInputElement>("[data-resource-address]")?.focus() }
      if (event.key === "`") { event.preventDefault(); open("terminal") }
      if (event.key.toLowerCase() === "p") { event.preventDefault(); open("files") }
    }
    document.addEventListener("keydown", keydown)
    return () => document.removeEventListener("keydown", keydown)
  }, [props.scope, props.sessionId, props.visible])
  if (!active) return null
  return <div className="flex h-full min-h-0 flex-col bg-background" data-workspace-resource-view hidden={!props.visible} inert={!props.visible}>
    {active.kind !== "sources" && active.kind !== "agents" && (active.kind !== "browser" || !getElectronBrowser()) ? <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-2 sm:px-4">
      <div className="flex items-center rounded-full bg-muted/60 px-1"><Button variant="ghost" size="icon-sm" aria-label="Atrás en la pestaña" disabled={active.kind !== "browser" || (active.historyIndex ?? 0) <= 0} onClick={() => { const index = (active.historyIndex ?? 0) - 1; const url = active.history?.[index]; if (url) store().update(props.scope, active.id, { url, historyIndex: index, title: new URL(url).hostname }) }}><ArrowLeft className="size-4" /></Button><Button variant="ghost" size="icon-sm" aria-label="Adelante en la pestaña" disabled={active.kind !== "browser" || !active.history || (active.historyIndex ?? 0) >= active.history.length - 1} onClick={() => { const index = (active.historyIndex ?? 0) + 1; const url = active.history?.[index]; if (url) store().update(props.scope, active.id, { url, historyIndex: index, title: new URL(url).hostname }) }}><ArrowRight className="size-4" /></Button><Button variant="ghost" size="icon-sm" aria-label="Actualizar pestaña" disabled={active.kind === "page" || active.kind === "terminal" || active.kind === "browser"} onClick={() => {
        if (active.kind === "files" || active.kind === "new") { void files.refetch(); void queryClient.invalidateQueries({ queryKey: ["workspace-file-tree", props.workspaceId] }) }
        if (active.kind === "artifact") void queryClient.invalidateQueries({ queryKey: ["artifact-panel", props.workspaceId, active.ownerSessionId ?? props.sessionId ?? "__draft__"] })
      }}><RotateCw className="size-4" /></Button></div>
      <form className="mx-auto w-full max-w-3xl" onSubmit={event => { event.preventDefault(); navigate(address) }}><Input data-resource-address aria-label="Buscar o introducir una URL" placeholder="Buscar o introducir una URL" className="h-8 rounded-full bg-muted text-center" value={address} onChange={event => setAddress(event.currentTarget.value)} /></form>
      <Button variant="ghost" size="icon-sm" aria-label="Abrir chat lateral" aria-pressed={props.assistantOpen} onClick={props.onSideChat}><MessageCircle className="size-4" /></Button>
      <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Opciones de pestaña"><MoreHorizontal className="size-4" /></Button>} /><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => props.onClose(active)}>Cerrar pestaña</DropdownMenuItem><DropdownMenuItem onClick={props.onExtensions}>Complementos</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
    </div> : null}
    <div className="relative flex min-h-0 flex-1">
      <div className="relative min-h-0 min-w-0 flex-1">
        {props.tabs.filter(tab => visited.has(tab.id) || (props.visible && tab.id === active.id)).map(tab => <div key={tab.id} className="h-full" hidden={tab.id !== active.id} inert={tab.id !== active.id}>
          {tab.kind === "new" ? <div className="h-full overflow-y-auto px-6 pt-8 pb-36"><div className="mx-auto max-w-3xl">
            <h2 className="mb-4 text-sm font-medium">Herramientas</h2>
            <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
              <Tool label="Archivos" icon={<FolderOpen />} shortcut="Ctrl+P" onClick={() => open("files")} />
              <Tool label="Chat lateral" icon={<MessageCircle />} shortcut="Ctrl+Alt+S" onClick={props.onSideChat} />
              <Tool label="Terminal" icon={<TerminalSquare />} onClick={() => open("terminal")} />
              <Tool label="Nueva página" icon={<FileText />} onClick={() => open("page")} />
              <details className="rounded-lg bg-muted/40"><summary className="flex cursor-pointer items-center gap-3 px-3 py-3 text-sm"><PanelRight className="size-4" />Más herramientas…<ChevronDown className="ml-auto size-3" /></summary><div className="px-2 pb-2"><Button variant="ghost" className="w-full justify-start" onClick={props.onExtensions}>Complementos y habilidades</Button></div></details>
            </div>
            <h2 className="mt-10 mb-6 text-sm font-medium">Sugeridos</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Suggestion label="Archivos del proyecto" icon={<FolderOpen />} onClick={() => open("files")} />
              {suggested.map(recent => <Suggestion key={recent.value} label={recent.title} icon={<Globe />} onClick={() => navigate(recent.value)} />)}
              {suggested.length === 0 ? <Suggestion label="Nueva página" icon={<FileText />} onClick={() => open("page")} /> : null}
              {(files.data?.items ?? []).filter(file => file.kind === "file" && /\.(md|pdf|docx|xlsx|html)$/i.test(file.path)).slice(0, Math.max(0, suggested.length === 0 ? 2 : 3 - suggested.length)).map(file => <Suggestion key={file.path} label={file.path.split("/").pop() ?? file.path} icon={<FileText />} onClick={() => open("artifact", file.path)} />)}
            </div>
            <div className="mt-12 mb-5 flex items-center justify-between"><h2 className="text-sm font-medium">Recientes</h2>{props.recents.length > 6 ? <Button variant="ghost" size="sm" onClick={() => setAllRecents(!allRecents)}>{allRecents ? "Ver menos" : "Ver todos"}</Button> : null}</div>
            {props.recents.length ? <div className="divide-y divide-border">{props.recents.slice(0, allRecents ? 40 : 6).map(recent => <Button key={JSON.stringify([recent.kind, recent.value, recent.fileScope, recent.ownerSessionId])} variant="ghost" className="h-auto min-h-14 w-full justify-start gap-3 rounded-lg py-3 text-left font-normal" onClick={() => recentOpen(recent)}><span className="rounded-lg bg-muted p-2">{recent.kind === "browser" ? <Globe className="size-4" /> : <FileText className="size-4" />}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm">{recent.title}</span><span className="block truncate text-xs text-muted-foreground">{recent.kind === "browser" ? "Sitio web" : recent.value}</span></span><time className="text-xs text-muted-foreground">{new Date(recent.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></Button>)}</div> : <p className="text-sm text-muted-foreground">Tus archivos, herramientas y sitios recientes aparecerán aquí.</p>}
          </div></div> : null}
          {tab.kind === "agents" ? <WorkspaceAgentsView scope={props.scope} workspaceId={props.workspaceId} sessionId={tab.ownerSessionId ?? null} endpoint={props.sourceEndpoint} visible={props.visible && tab.id === active.id} childId={tab.path} onOpenChild={props.onOpenAgentChat} /> : null}
          {tab.kind === "sources" ? <WorkspaceSourcesView scope={props.scope} sessionId={tab.ownerSessionId ?? null} endpoint={props.sourceEndpoint} visible={props.visible && tab.id === active.id} onOpen={target => { if (tab.ownerSessionId) props.onOpenSource?.(target, tab.ownerSessionId); }} /> : null}
          {tab.kind === "files" && props.client ? <div className="h-full [&_[data-workspace-file-tree]]:w-full [&_[data-workspace-file-tree]]:border-r-0"><WorkspaceFileTree cacheScope={props.scope} client={props.client} workspaceId={props.workspaceId} workspaceName={props.workspaceRoot.split("/").pop() ?? "Proyecto"} selectedPath="" onOpenFile={file => open("artifact", file.path)} /></div> : null}
          {tab.kind === "terminal" ? <TerminalDock workspaceRoot={props.workspaceRoot} onClose={() => props.onClose(tab)} /> : null}
          {tab.kind === "page" ? <WorkspacePage tab={tab} scope={props.scope} client={props.client} workspaceId={props.workspaceId} /> : null}
          {tab.kind === "artifact" && tab.path ? <ResourceArtifact scope={props.scope} tab={tab} client={props.client} workspaceId={props.workspaceId} workspaceRoot={props.workspaceRoot} sessionId={tab.ownerSessionId ?? props.sessionId} onOpenFile={path => open("artifact", path)} onClose={() => props.onClose(tab)} /> : null}
          {tab.kind === "browser" ? <ResourceBrowser tab={tab} scope={props.scope} active={props.visible && tab.id === active.id} onClose={() => props.onClose(tab)} /> : null}
        </div>)}
      </div>
      {props.assistantOpen ? <aside className="flex w-[min(26rem,45%)] min-w-72 flex-col border-l border-border bg-background" aria-label="Chat lateral" onPointerDown={props.onSideChatFocus} onFocusCapture={props.onSideChatFocus}><header className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3 text-sm">Chat lateral<Button variant="ghost" size="icon-xs" aria-label="Cerrar chat lateral" onClick={props.onAssistantToggle}><X className="size-4" /></Button></header><div className="min-h-0 flex-1 overflow-auto">{props.assistant}</div></aside> : <div className="pointer-events-none absolute right-3 bottom-3 z-20 w-[min(35rem,calc(100%-1.5rem))]"><div className="pointer-events-auto" data-resource-assistant>{props.assistant}</div></div>}
    </div>
  </div>
}
function Tool({ label, icon, shortcut, onClick }: { label: string; icon: ReactNode; shortcut?: string; onClick: () => void }) { return <Button aria-label={label} variant="ghost" className="h-10 justify-start gap-3 rounded-lg bg-muted/40 px-3 text-sm font-normal [&_svg]:size-4" onClick={onClick}>{icon}{label}{shortcut ? <kbd className="ml-auto rounded-full bg-muted px-2 text-xs text-muted-foreground">{shortcut}</kbd> : null}</Button> }
function Suggestion({ label, icon, onClick }: { label: string; icon: ReactNode; onClick: () => void }) { return <Button variant="ghost" className="h-28 min-w-0 flex-col gap-5 rounded-lg px-3 font-normal [&_svg]:size-6" onClick={onClick}>{icon}<span className="block w-full truncate text-xs">{label}</span></Button> }
function ResourceArtifact({ scope, tab, client, workspaceId, workspaceRoot, sessionId, onOpenFile, onClose }: { scope: string; tab: WorkspaceResourceTab; client: OpenworkServerClient | null; workspaceId: string; workspaceRoot: string; sessionId: string | null; onOpenFile: (path: string) => void; onClose: () => void }) {
  const target = openTargetFromWorkspaceFile(tab.path ?? "")
  return target ? <ArtifactPanel cacheScope={scope} sessionId={sessionId ?? "__draft__"} tab={{ id: tab.id, type: "artifact", label: tab.title, target: { ...target, fileScope: tab.fileScope ?? "workspace" }, preview: target.preview }} client={client} workspaceId={workspaceId} workspaceRoot={workspaceRoot} isLocalWorkspace onOpenWorkspaceFile={onOpenFile} onClose={onClose} /> : <p className="p-6 text-sm text-muted-foreground">Este tipo de archivo no tiene vista previa.</p>
}

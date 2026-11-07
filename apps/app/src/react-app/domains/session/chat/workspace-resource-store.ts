import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import { z } from "zod"
import { toast } from "@/components/ui/sonner"

const tabSchema = z.object({
  id: z.string(), kind: z.enum(["new", "browser", "files", "terminal", "page", "artifact", "sources", "agents"]),
  title: z.string(), url: z.string().optional(), path: z.string().optional(),
  draft: z.string().optional(), savedDraft: z.string().optional(), savedPath: z.string().optional(), updatedAt: z.number().nullable().optional(),
  history: z.array(z.string()).optional(), historyIndex: z.number().int().nonnegative().optional(),
  fileScope: z.enum(["workspace", "conversation"]).optional(), nativeId: z.string().optional(), ownerSessionId: z.string().nullable().optional(),
})
export type WorkspaceResourceTab = z.infer<typeof tabSchema>
export type ResourceKind = WorkspaceResourceTab["kind"]
const recentSchema = z.object({ kind: z.enum(["browser", "files", "terminal", "page", "artifact", "sources", "agents"]), title: z.string(), value: z.string(), at: z.number(), fileScope: z.enum(["workspace", "conversation"]).optional(), ownerSessionId: z.string().nullable().optional() })
export type ResourceRecent = z.infer<typeof recentSchema>
const workspaceSchema = z.object({ tabs: z.array(tabSchema), activeId: z.string().nullable(), recents: z.array(recentSchema) })
const storageSchema = z.object({ workspaces: z.record(z.string(), workspaceSchema) })
type ResourceWorkspace = z.infer<typeof workspaceSchema>
const EMPTY: ResourceWorkspace = { tabs: [], activeId: null, recents: [] }

/** Only ordinary web addresses are navigable; script/file/data URLs never enter the browser. */
export function resourceAddress(input: string): string | null {
  const value = input.trim()
  if (!value) return null
  const explicit = /^[a-z][a-z\d+.-]*:/i.test(value) && !/^[\w.-]+:\d+(?:\/|$)/.test(value)
  const address = explicit ? value : /^(?:localhost|[\w.-]+\.[a-z\d.-]+|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:[/?#]|$)/i.test(value)
    ? `${/^(?:localhost|127\.|192\.168\.|10\.|\[::1\])/.test(value) ? "http" : "https"}://${value}`
    : `https://www.google.com/search?q=${encodeURIComponent(value)}`
  try { const url = new URL(address); return ["http:", "https:"].includes(url.protocol) ? url.href : null } catch { return null }
}
export function resourcePagePath(input: string): string | null {
  const value = input.trim().replace(/\\/g, "/")
  if (!value || value.startsWith("/") || value.split("/").some(part => !part || part === "." || part === "..") || /[\x00-\x1f:]/.test(value)) return null
  return /\.md$/i.test(value) ? value : `${value}.md`
}
export function resourceScope(server: string | undefined, workspaceId: string, accountScope?: string | null) { return JSON.stringify([server ?? "", workspaceId, accountScope ?? "local"]) }

export const useWorkspaceResources = create<{
  workspaces: Record<string, ResourceWorkspace>
  open: (scope: string, kind?: ResourceKind, value?: string, ownerSessionId?: string | null, fileScope?: "workspace" | "conversation") => string
  select: (scope: string, id: string | null) => void
  close: (scope: string, id: string) => void
  update: (scope: string, id: string, patch: Partial<Omit<WorkspaceResourceTab, "id">>) => void
  record: (scope: string, recent: Omit<ResourceRecent, "at">) => void
}>()(persist((set) => ({
  workspaces: {},
  open: (scope, kind = "new", value, ownerSessionId = null, fileScope = "workspace") => {
    const id = crypto.randomUUID()
    let selectedId: string = id
    const title = kind === "new" ? "Nueva pestaña" : kind === "browser" ? value ?? "Sitio web" : kind === "files" ? "Archivos" : kind === "terminal" ? "Terminal" : kind === "page" ? "Nueva página" : kind === "sources" ? "Fuentes" : kind === "agents" ? "Subagentes" : value?.split("/").pop() ?? "Archivo"
    set(state => {
      const current = state.workspaces[scope] ?? EMPTY
      const existing = kind === "new" || kind === "page" ? undefined : current.tabs.find(tab => tab.kind === kind && ((kind === "sources" || kind === "agents") ? tab.ownerSessionId === ownerSessionId : kind === "browser" ? tab.url === value : kind === "artifact" ? tab.path === value && (tab.fileScope ?? "workspace") === fileScope && (fileScope !== "conversation" || tab.ownerSessionId === ownerSessionId) : true))
      if (existing) { selectedId = existing.id; return { workspaces: { ...state.workspaces, [scope]: { ...current, activeId: existing.id, tabs: kind === "agents" ? current.tabs.map(tab => tab.id === existing.id ? { ...tab, path: value } : tab) : current.tabs } } } }
      return { workspaces: { ...state.workspaces, [scope]: { ...current, activeId: id, tabs: [...current.tabs, { id, kind, title, ownerSessionId, ...(kind === "agents" ? { path: value } : kind === "browser" ? { url: value } : kind === "artifact" ? { path: value, fileScope } : kind === "page" ? { draft: "", path: "paginas/Sin título.md" } : {}) }] } } }
    })
    return selectedId
  },
  select: (scope, activeId) => set(state => {
    const current = state.workspaces[scope] ?? EMPTY
    if (activeId && !current.tabs.some(tab => tab.id === activeId)) return state
    return { workspaces: { ...state.workspaces, [scope]: { ...current, activeId } } }
  }),
  close: (scope, id) => set(state => {
    const current = state.workspaces[scope] ?? EMPTY
    const index = current.tabs.findIndex(tab => tab.id === id)
    const tabs = current.tabs.filter(tab => tab.id !== id)
    return { workspaces: { ...state.workspaces, [scope]: { ...current, tabs, activeId: current.activeId === id ? tabs[Math.min(index, tabs.length - 1)]?.id ?? null : current.activeId } } }
  }),
  update: (scope, id, patch) => set(state => {
    const current = state.workspaces[scope] ?? EMPTY
    return { workspaces: { ...state.workspaces, [scope]: { ...current, tabs: current.tabs.map(tab => tab.id === id ? { ...tab, ...patch } : tab) } } }
  }),
  record: (scope, recent) => set(state => {
    const current = state.workspaces[scope] ?? EMPTY
    return { workspaces: { ...state.workspaces, [scope]: { ...current, recents: [{ ...recent, at: Date.now() }, ...current.recents.filter(item => item.kind !== recent.kind || item.value !== recent.value || item.fileScope !== recent.fileScope || item.ownerSessionId !== recent.ownerSessionId)].slice(0, 40) } } }
  }),
}), {
  name: "openwork.workspace-resource-tabs.v1",
  storage: createJSONStorage(() => ({
    getItem: name => { try { return localStorage.getItem(name) } catch { return null } },
    setItem: (name, value) => {
      try { localStorage.setItem(name, value) }
      catch { toast.error("No se pudieron conservar las pestañas y borradores en este navegador. Guardá las páginas en el proyecto antes de cerrar.", { id: "workspace-resource-storage" }) }
    },
    removeItem: name => { try { localStorage.removeItem(name) } catch { /* The in-memory session remains usable. */ } },
  })),
  merge: (persisted, current) => { const parsed = storageSchema.safeParse(persisted); return parsed.success ? { ...current, workspaces: parsed.data.workspaces } : current },
}))
export function useResourceWorkspace(scope: string) { return useWorkspaceResources(state => state.workspaces[scope] ?? EMPTY) }

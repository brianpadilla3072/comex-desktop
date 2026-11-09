/** @jsxImportSource react */
import { createContext, use, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";
import { BookText, ChevronDown, FolderPlus, Plus, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { createOpenworkServerClient, type OpenworkServerClient, type SpecialistApplication, type SpecialistCatalog, type SpecialistPackSummary } from "@/app/lib/openwork-server";
import { pickDirectory, workspaceSetRuntimeActive, workspaceSetSelected } from "@/app/lib/desktop";
import { isDesktopRuntime } from "@/app/utils";
import { resolveOpenworkConnection } from "@/react-app/shell/openwork-connection";
import { SpecialistIntegrationsDialog } from "./integrations-dialog";
import { SpecialistLibraryDialog } from "./library-dialog";

const DEFAULT_PERSONALITY = "Sos una asistente metódica, clara y amable. Explicá en castellano simple, verificá las fuentes y señalá lo que falte. Priorizá que la persona entienda y pueda defender el resultado.";
const COMEX_SPECIALTY = "Comercio Exterior: investigaciones, cotizaciones y trabajos académicos con fuentes verificables.";
type State = {
  catalog: SpecialistCatalog | null;
  active: SpecialistApplication | null;
  busy: boolean;
  error: string | null;
  create: () => void;
  edit: () => void;
  open: (application: SpecialistApplication) => Promise<void>;
  createProject: () => void;
  integrations: () => void;
  library: () => void;
  refresh: () => Promise<unknown>;
};
const Context = createContext<State | null>(null);
export const useSpecialistApplications = () => use(Context);

export function SpecialistApplicationsProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [form, setForm] = useState<"create" | SpecialistApplication | null>(null);
  const [projectApplication, setProjectApplication] = useState<SpecialistApplication | null>(null);
  const [integrationApplication, setIntegrationApplication] = useState<SpecialistApplication | null>(null);
  const [libraryApplication, setLibraryApplication] = useState<SpecialistApplication | null>(null);
  const newProject = projectApplication !== null;
  const [projectName, setProjectName] = useState("");
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem("specialists.onboarding-dismissed") === "1"; } catch { return false; } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["specialist-applications"],
    queryFn: async () => {
      const connection = await resolveOpenworkConnection();
      if (!connection.normalizedBaseUrl || !connection.resolvedToken) throw new Error("No hay conexión local.");
      const client = createOpenworkServerClient({ baseUrl: connection.normalizedBaseUrl, token: connection.resolvedToken, hostToken: connection.resolvedHostToken });
      return { client, catalog: await client.getSpecialistApplications() };
    },
    retry: false, staleTime: 10_000, refetchInterval: 15_000,
  });
  const catalog = query.data?.catalog ?? null;
  const workspaceId = location.pathname.match(/\/workspace\/([^/]+)/)?.[1];
  const active = catalog?.enabled ? (workspaceId
    ? catalog.applications.find(app => app.workspaceIds.includes(workspaceId))
    : catalog.applications.find(app => app.id === catalog.activeApplicationId) ?? catalog.applications[0]) ?? null : null;
  useEffect(() => {
    if (catalog?.enabled && !catalog.user && !catalog.applications.length && !dismissed) setForm(current => current ?? "create");
  }, [catalog, dismissed]);
  useEffect(() => {
    const refresh = () => { void query.refetch(); };
    window.addEventListener("openwork-server-settings-changed", refresh);
    return () => window.removeEventListener("openwork-server-settings-changed", refresh);
  }, [query.refetch]);
  useEffect(() => {
    if (!active) return;
    const previous = document.title; document.title = active.name;
    return () => { document.title = previous; };
  }, [active?.name]);
  function closeForm() {
    setForm(null); setDismissed(true);
    try { localStorage.setItem("specialists.onboarding-dismissed", "1"); } catch {}
  }
  async function openWorkspace(id: string) {
    if (isDesktopRuntime()) {
      await workspaceSetSelected(id).catch(() => undefined);
      await workspaceSetRuntimeActive(id).catch(() => undefined);
    }
    window.dispatchEvent(new Event("openwork-server-settings-changed"));
    navigate(`/workspace/${encodeURIComponent(id)}/session`);
  }
  async function open(app: SpecialistApplication) {
    if (!query.data || busy) return;
    setBusy(true); setError(null);
    try {
      await query.data.client.activateSpecialistApplication(app.id);
      const id = app.workspaceIds[0] ?? (await query.data.client.createSpecialistProject(app.id, "Principal")).workspaceId;
      await query.refetch();
      await openWorkspace(id);
    } catch (cause) { const message = cause instanceof Error ? cause.message : "No se pudo abrir la aplicación."; setError(message); toast.error(message); }
    finally { setBusy(false); }
  }
  async function saveProject() {
    if (!projectApplication || !query.data || !projectName.trim()) return;
    setBusy(true); setError(null);
    try {
      const result = await query.data.client.createSpecialistProject(projectApplication.id, projectName.trim());
      await query.refetch(); setProjectApplication(null); setProjectName(""); await openWorkspace(result.workspaceId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo crear el proyecto."); }
    finally { setBusy(false); }
  }
  const value: State = { catalog, active, busy, error, create: () => { setError(null); setForm("create"); }, edit: () => { if (active) { setError(null); setForm(active); } }, open,
    createProject: () => { setError(null); setProjectApplication(active); }, integrations: () => setIntegrationApplication(active), library: () => setLibraryApplication(active), refresh: query.refetch };
  return <Context.Provider value={value}>
    {children}
    {integrationApplication && query.data && catalog?.integrationsEnabled ? <SpecialistIntegrationsDialog app={integrationApplication} client={query.data.client} onClose={() => setIntegrationApplication(null)} onChanged={query.refetch} /> : null}
    {libraryApplication && query.data && (catalog?.libraryEnabled || catalog?.scheduledTasksEnabled || catalog?.datasetsEnabled || catalog?.sourcesEnabled || catalog?.panelsEnabled || catalog?.outputsEnabled) ? <SpecialistLibraryDialog app={libraryApplication} client={query.data.client} library={catalog?.libraryEnabled === true} scheduled={catalog?.scheduledTasksEnabled === true} dryRun={catalog?.taskDryRunEnabled === true} datasets={catalog?.datasetsEnabled === true} sources={catalog?.sourcesEnabled === true} localFiles={catalog?.sourcesLocalFilesEnabled === true} panels={catalog?.panelsEnabled === true} outputs={catalog?.outputsEnabled === true} onClose={() => setLibraryApplication(null)} onChanged={query.refetch} /> : null}
    {catalog?.enabled && query.data && form ? <ApplicationForm key={typeof form === "string" ? "create" : form.id} client={query.data.client} catalog={catalog} existing={form === "create" ? null : form} preferredWorkspaceId={workspaceId}
      onClose={closeForm} onSaved={async id => { await query.refetch(); closeForm(); if (id) await openWorkspace(id); }} /> : null}
    <Dialog open={newProject} onOpenChange={open => { if (!open) setProjectApplication(null); }}>
      <DialogContent><DialogHeader><DialogTitle>Nuevo proyecto en {projectApplication?.name}</DialogTitle></DialogHeader>
        <form onSubmit={event => { event.preventDefault(); void saveProject(); }} className="grid gap-4">
          <Label htmlFor="specialist-project-name">Nombre del proyecto</Label>
          <Input id="specialist-project-name" autoFocus value={projectName} onChange={event => setProjectName(event.target.value)} required maxLength={80} />
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter><Button type="submit" disabled={busy || !projectName.trim()}>Crear proyecto</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </Context.Provider>;
}

function ApplicationForm({ client, catalog, existing, preferredWorkspaceId, onClose, onSaved }: {
  client: OpenworkServerClient; catalog: SpecialistCatalog; existing: SpecialistApplication | null;
  preferredWorkspaceId?: string; onClose: () => void; onSaved: (workspaceId?: string) => Promise<void>;
}) {
  const first = !catalog.user;
  const [userName, setUserName] = useState("");
  const [name, setName] = useState(existing?.name ?? (first ? "Comex" : ""));
  const [specialty, setSpecialty] = useState(existing?.specialty ?? (first ? COMEX_SPECIALTY : ""));
  const [personality, setPersonality] = useState(existing?.personality ?? DEFAULT_PERSONALITY);
  const [template, setTemplate] = useState<"comex" | "custom">(existing?.template ?? (first ? "comex" : "custom"));
  const [packPath, setPackPath] = useState("");
  const [summary, setSummary] = useState<SpecialistPackSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const engine = useQuery({ queryKey: ["specialist-engine", client.baseUrl], queryFn: () => client.getEngineV2PreviewStatus(), retry: false, staleTime: 15_000 });
  async function inspect(path: string) {
    setBusy(true); setError(null); setSummary(null);
    try { setSummary(await client.previewSpecialistPack(path ? { packPath: path } : { template: "comex" })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo revisar la carpeta."); }
    finally { setBusy(false); }
  }
  async function chooseFolder() {
    try { const path = await pickDirectory({ title: "Carpeta de agentes y skills" }); if (typeof path === "string" && path) { setPackPath(path); await inspect(path); } }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo abrir el selector de carpetas."); }
  }
  async function save() {
    setBusy(true); setError(null);
    try {
      if (existing) { await client.updateSpecialistApplication(existing.id, { name, specialty, personality }); await onSaved(); }
      else {
        const result = await client.createSpecialistApplication({ userName: first ? userName : undefined, name, specialty, personality, template, packPath: packPath || undefined, preferredWorkspaceId });
        await onSaved(result.workspaceId);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar la aplicación."); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[90dvh] gap-4 overflow-y-auto lg:max-w-xl">
      <DialogHeader><DialogTitle>{existing ? "Personalidad de la aplicación" : first ? "Creá tu primera aplicación" : "Nueva aplicación especialista"}</DialogTitle></DialogHeader>
      <form onSubmit={event => { event.preventDefault(); void save(); }} className="grid gap-4">
        {first ? <div className="grid gap-1.5"><Label htmlFor="specialist-user">Tu nombre</Label><Input id="specialist-user" autoFocus autoComplete="given-name" value={userName} onChange={event => setUserName(event.target.value)} required maxLength={100} /></div> : null}
        {!existing ? <div className="flex gap-2" role="group" aria-label="Tipo de aplicación">
          <Button type="button" variant={template === "comex" ? "secondary" : "outline"} aria-pressed={template === "comex"} onClick={() => { setTemplate("comex"); setSummary(null); if (!name) setName("Comex"); if (!specialty) setSpecialty(COMEX_SPECIALTY); }}>Comercio Exterior</Button>
          <Button type="button" variant={template === "custom" ? "secondary" : "outline"} aria-pressed={template === "custom"} onClick={() => { setTemplate("custom"); setSummary(null); if (name === "Comex") setName(""); if (specialty === COMEX_SPECIALTY) setSpecialty(""); }}>Otra especialidad</Button>
        </div> : null}
        <div className="grid gap-1.5"><Label htmlFor="specialist-name">Nombre de la aplicación</Label><Input id="specialist-name" value={name} onChange={event => setName(event.target.value)} required maxLength={80} placeholder="Por ejemplo: Comex o Taller Creativo" /></div>
        <div className="grid gap-1.5"><Label htmlFor="specialist-specialty">Especialidad</Label><Input id="specialist-specialty" value={specialty} onChange={event => setSpecialty(event.target.value)} required maxLength={500} /></div>
        <div className="grid gap-1.5"><Label htmlFor="specialist-personality">Personalidad y forma de trabajar</Label><Textarea id="specialist-personality" rows={3} value={personality} onChange={event => setPersonality(event.target.value)} maxLength={8000} /></div>
        {!existing ? <div className="grid gap-2">
          <Label htmlFor="specialist-pack">Carpeta de agentes y skills</Label>
          <div className="flex gap-2"><Input id="specialist-pack" value={packPath} onChange={event => { setPackPath(event.target.value); setSummary(null); }} placeholder={template === "comex" ? "Pack de Comercio Exterior incluido" : "Opcional: ruta de tu pack"} />
            {isDesktopRuntime() ? <Button type="button" variant="outline" onClick={() => void chooseFolder()} disabled={busy}>Elegir carpeta</Button> : null}
          </div>
          {packPath || template === "comex" ? <Button type="button" variant="ghost" size="sm" className="justify-self-start" disabled={busy} onClick={() => void inspect(packPath)}>Revisar pack</Button> : null}
          {summary ? <p role="status" className="text-xs text-muted-foreground">{summary.agents.length} {summary.agents.length === 1 ? "agente" : "agentes"} · {summary.skills.length} {summary.skills.length === 1 ? "skill" : "skills"} · {summary.fileCount} archivos</p> : template === "comex" && !packPath ? <p className="text-xs text-muted-foreground">Se usará el pack incluido de Comercio Exterior.</p> : null}
        </div> : <p className="text-xs text-muted-foreground">Pack importado: {existing.agentCount} {existing.agentCount === 1 ? "agente" : "agentes"} · {existing.skillCount} {existing.skillCount === 1 ? "skill" : "skills"}</p>}
        {!existing ? <p role="status" className="text-xs text-muted-foreground">{engine.data?.running ? engine.data.connectionSource === "installed" ? "OpenCode instalado conectado. Modelos gratuitos primero." : "Motor conectado. Modelos gratuitos primero." : "Conectá un modelo desde el chat después de crear la aplicación."}</p> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter><Button type="button" variant="ghost" onClick={onClose}>{first ? "Configurar después" : "Cancelar"}</Button><Button type="submit" disabled={busy}>{existing ? "Guardar personalidad" : "Crear aplicación"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

export function SpecialistApplicationSwitcher({ fallbackName }: { fallbackName: string }) {
  const state = useSpecialistApplications();
  if (!state?.catalog?.enabled) return <span className="truncate text-[15px] font-medium tracking-[-0.4px]" title={fallbackName}>{fallbackName}</span>;
  const name = state.active?.name ?? fallbackName;
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button variant="ghost" className="titlebar-no-drag min-w-0 max-w-full gap-1 px-1 text-[15px]" aria-label="Cambiar aplicación especialista" title={name} disabled={state.busy} />}><span className="truncate">{name}</span><ChevronDown className="size-3 shrink-0" /></DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="w-72">
      {state.catalog.applications.map(app => <DropdownMenuItem key={app.id} onClick={() => void state.open(app)}><span className="min-w-0"><span className="block truncate">{app.name}{app.id === state.active?.id ? " ✓" : ""}</span><span className="block truncate text-xs text-muted-foreground">{app.specialty}</span></span></DropdownMenuItem>)}
      {state.catalog.applications.length ? <DropdownMenuSeparator /> : null}
      <DropdownMenuItem onClick={state.create}><Plus className="size-4" />Nueva aplicación</DropdownMenuItem>
      {state.active ? <><DropdownMenuItem onClick={state.edit}><Settings2 className="size-4" />Personalidad y nombre</DropdownMenuItem>{state.catalog.libraryEnabled || state.catalog.scheduledTasksEnabled || state.catalog.datasetsEnabled || state.catalog.sourcesEnabled || state.catalog.panelsEnabled || state.catalog.outputsEnabled ? <DropdownMenuItem onClick={state.library}><BookText className="size-4" />{state.catalog.libraryEnabled ? "Contexto, agentes y skills" : [state.catalog.scheduledTasksEnabled && "Tareas", state.catalog.datasetsEnabled && "Datos", state.catalog.sourcesEnabled && "Fuentes", state.catalog.panelsEnabled && "Paneles", state.catalog.outputsEnabled && "Salidas"].filter(Boolean).join(" · ")}</DropdownMenuItem> : null}<DropdownMenuItem onClick={state.createProject}><FolderPlus className="size-4" />Nuevo proyecto</DropdownMenuItem></> : null}
      {state.active && state.catalog.integrationsEnabled ? <DropdownMenuItem onClick={state.integrations}><Settings2 className="size-4" />Herramientas y fuentes</DropdownMenuItem> : null}
      {state.error ? <p role="alert" className="px-2 py-1 text-xs text-destructive">{state.error}</p> : null}
    </DropdownMenuContent>
  </DropdownMenu>;
}

/** @jsxImportSource react */
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, BookText, Bot, CalendarClock, Database, FileText, History, LayoutDashboard, LibraryBig, Pause, Play, Plus, ScanSearch, Trash2, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import type { OpenworkServerClient, SpecialistApplication, SpecialistDataset, SpecialistLibrary, SpecialistLibraryEntry, SpecialistOutput, SpecialistOutputAudit, SpecialistPanelBlock, SpecialistPanelResolution, SpecialistProposal, SpecialistSource, SpecialistSyncResult, SpecialistTask, SpecialistTaskSchedule } from "@/app/lib/openwork-server";
import { MarkdownPreview } from "@/react-app/domains/session/artifacts/preview";

const ORIGIN_LABEL: Record<SpecialistLibraryEntry["origin"], string> = { official: "Del pack", "official-modified": "Del pack, editado", custom: "Propio" };

const DAY_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function describeSchedule(schedule: SpecialistTaskSchedule): string {
  const clock = (hour?: number, minute?: number) => `${String(hour ?? 0).padStart(2, "0")}:${String(minute ?? 0).padStart(2, "0")}`;
  if (schedule.kind === "interval") return `Cada ${schedule.everyMinutes && schedule.everyMinutes >= 60 ? `${Math.round(schedule.everyMinutes / 60 * 10) / 10} h` : `${schedule.everyMinutes} min`}`;
  if (schedule.kind === "daily") return `Todos los días a las ${clock(schedule.hour, schedule.minute)}`;
  if (schedule.kind === "weekly") return `${(schedule.daysOfWeek ?? []).map(day => DAY_LABELS[day] ?? "?").join(", ")} a las ${clock(schedule.hour, schedule.minute)}`;
  return `Una vez: ${schedule.at ? new Date(schedule.at).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "—"}`;
}

const formatWhen = (value: number | null) => value === null ? "—" : new Date(value).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });

type View =
  | { kind: "home" }
  | { kind: "context" }
  | { kind: "file"; path: string; name: string }
  | { kind: "new"; type: "agent" | "skill" }
  | { kind: "tasks" }
  | { kind: "datasets" }
  | { kind: "sources" }
  | { kind: "panels" }
  | { kind: "outputs" };

function syncNotice(sync: SpecialistSyncResult[]) {
  if (!sync.length) return null;
  const projects = sync.filter(entry => !entry.error);
  const nuevo = projects.reduce((total, entry) => total + entry.nuevo.length, 0);
  const failed = sync.filter(entry => entry.error).length;
  const parts = [`Aplicado en ${projects.length} ${projects.length === 1 ? "proyecto" : "proyectos"}`];
  if (nuevo) parts.push(`${nuevo} archivo${nuevo === 1 ? "" : "s"} editado${nuevo === 1 ? "" : "s"} en el proyecto quedaron como .nuevo`);
  if (failed) parts.push(`${failed} proyecto${failed === 1 ? "" : "s"} con error`);
  return parts.join(" · ");
}

export function SpecialistLibraryDialog({ app, client, library, scheduled, dryRun, datasets, sources, localFiles, panels, panelApps, outputs, onClose, onChanged }: { app: SpecialistApplication; client: OpenworkServerClient; library: boolean; scheduled: boolean; dryRun: boolean; datasets: boolean; sources: boolean; localFiles: boolean; panels: boolean; panelApps: boolean; outputs: boolean; onClose(): void; onChanged(): Promise<unknown> }) {
  const [view, setView] = useState<View>({ kind: "home" });
  const query = useQuery({ queryKey: ["specialist-library", client.baseUrl, app.id], queryFn: () => client.getSpecialistLibrary(app.id), retry: false, enabled: library });
  // El título nombra la aplicación; la línea de abajo dice qué hay adentro (el título anterior era
  // una enumeración de seis secciones que se partía en dos líneas y se pisaba con la X).
  const sections = [library ? "Contexto, agentes y skills" : null, scheduled ? "Tareas" : null, datasets ? "Datos" : null, sources ? "Fuentes" : null, panels ? "Paneles" : null, outputs ? "Salidas" : null].filter(Boolean).join(" · ");
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[90dvh] gap-4 overflow-y-auto lg:max-w-2xl">
      <DialogHeader>
        <DialogTitle className="pr-8 leading-snug">{app.name}</DialogTitle>
        <p className="text-xs text-muted-foreground">{sections}</p>
      </DialogHeader>
      {view.kind === "home" ? <Home app={app} client={client} query={query} libraryEnabled={library} scheduled={scheduled} datasets={datasets} sources={sources} panels={panels} outputs={outputs} onOpen={setView} onChanged={async () => { if (library) await query.refetch(); await onChanged(); }} /> : null}
      {view.kind === "context" ? <ContextEditor app={app} client={client} onBack={() => setView({ kind: "home" })} onChanged={async () => { if (library) await query.refetch(); await onChanged(); }} /> : null}
      {view.kind === "file" ? <FileEditor key={view.path} app={app} client={client} path={view.path} name={view.name} onBack={() => setView({ kind: "home" })} onChanged={async () => { if (library) await query.refetch(); await onChanged(); }} /> : null}
      {view.kind === "new" ? <NewItem app={app} client={client} type={view.type} onBack={() => setView({ kind: "home" })} onChanged={async () => { if (library) await query.refetch(); await onChanged(); }} /> : null}
      {view.kind === "tasks" ? <TasksView key="tasks" app={app} client={client} dryRun={dryRun} onBack={() => setView({ kind: "home" })} /> : null}
      {view.kind === "datasets" ? <DatasetsView key="datasets" app={app} client={client} onBack={() => setView({ kind: "home" })} /> : null}
      {view.kind === "sources" ? <SourcesView key="sources" app={app} client={client} localFiles={localFiles} onBack={() => setView({ kind: "home" })} /> : null}
      {view.kind === "panels" ? <PanelsView key="panels" app={app} client={client} panelApps={panelApps} onBack={() => setView({ kind: "home" })} /> : null}
      {view.kind === "outputs" ? <OutputsView key="outputs" app={app} client={client} onBack={() => setView({ kind: "home" })} /> : null}
    </DialogContent>
  </Dialog>;
}

function Home({ app, client, query, libraryEnabled, scheduled, datasets, sources, panels, outputs, onOpen, onChanged }: {
  app: SpecialistApplication; client: OpenworkServerClient;
  query: ReturnType<typeof useQuery<SpecialistLibrary | null, Error>>;
  libraryEnabled: boolean; scheduled: boolean; datasets: boolean; sources: boolean; panels: boolean; outputs: boolean;
  onOpen(view: View): void; onChanged(): Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ path: string; name: string } | null>(null);
  async function remove(entry: { path: string; name: string }) {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null); setPendingDelete(null);
    try { const result = await client.deleteSpecialistLibraryFile(app.id, entry.path); setNotice(syncNotice(result.sync) ?? `Se eliminó ${entry.name}.`); await onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo eliminar."); }
    finally { setBusy(false); }
  }
  const library = libraryEnabled ? query.data : null;
  const row = (entry: SpecialistLibraryEntry, name: string, icon: ReactNode, onOpenRow: () => void) => <div
    key={entry.path}
    className="flex w-full items-start gap-3 rounded-md border p-3">
    <button type="button" disabled={busy} onClick={onOpenRow} className="flex min-w-0 flex-1 items-start gap-3 text-left">
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{name}</span>
        <span className="block truncate text-xs text-muted-foreground">{entry.description?.trim() || "Sin descripción"}</span>
      </span>
      <Badge variant="outline" className="shrink-0">{ORIGIN_LABEL[entry.origin]}</Badge>
    </button>
    <Button type="button" variant="ghost" size="icon" aria-label={`Eliminar ${name}`} disabled={busy} onClick={() => setPendingDelete({ path: entry.path, name })}><Trash2 className="size-4" /></Button>
  </div>;
  return <div className="grid gap-4">
    {pendingDelete ? <div role="alertdialog" aria-label={`Confirmar eliminación de ${pendingDelete.name}`} className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
      <span className="min-w-0 flex-1">¿Eliminar "{pendingDelete.name}"? Se quitará también de los proyectos de esta aplicación.</span>
      <Button size="sm" variant="destructive" disabled={busy} onClick={() => void remove(pendingDelete)}>Eliminar</Button>
      <Button size="sm" variant="ghost" onClick={() => setPendingDelete(null)}>Cancelar</Button>
    </div> : null}
    {libraryEnabled && query.isError ? <p role="alert" className="text-sm text-destructive">No se pudo leer la biblioteca; el resto (propuestas, tareas, datos) sigue disponible. <Button variant="link" onClick={() => void query.refetch()}>Volver a intentar</Button></p> : null}
    {libraryEnabled && query.isPending ? <div className="grid gap-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div> : null}
    <ProposalsSection app={app} client={client} enabled={libraryEnabled || scheduled || datasets || sources || panels || outputs} onChanged={onChanged} />
    {scheduled ? <section className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Tareas programadas</h3>
        <Button variant="ghost" size="sm" onClick={() => onOpen({ kind: "tasks" })}><CalendarClock className="size-4" />Gestionar</Button>
      </div>
      <TasksSummary app={app} client={client} />
    </section> : null}
    {datasets ? <section className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Datos de investigación</h3>
        <Button variant="ghost" size="sm" onClick={() => onOpen({ kind: "datasets" })}><Database className="size-4" />Gestionar</Button>
      </div>
      <DatasetsSummary app={app} client={client} />
    </section> : null}
    {outputs ? <section className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Salidas del mini-Studio</h3>
        <Button variant="ghost" size="sm" onClick={() => onOpen({ kind: "outputs" })}><ScanSearch className="size-4" />Gestionar</Button>
      </div>
      <OutputsSummary app={app} client={client} />
    </section> : null}
    {panels ? <section className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Paneles</h3>
        <Button variant="ghost" size="sm" onClick={() => onOpen({ kind: "panels" })}><LayoutDashboard className="size-4" />Gestionar</Button>
      </div>
      <PanelsSummary app={app} client={client} />
    </section> : null}
    {sources ? <section className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Fuentes citables</h3>
        <Button variant="ghost" size="sm" onClick={() => onOpen({ kind: "sources" })}><LibraryBig className="size-4" />Gestionar</Button>
      </div>
      <SourcesSummary app={app} client={client} />
    </section> : null}
    {library ? <><section className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Contexto</h3>
        <Button variant="ghost" size="sm" onClick={() => onOpen({ kind: "context" })}><FileText className="size-4" />{library.context.exists ? "Editar" : "Definir"}</Button>
      </div>
      <p className="text-xs text-muted-foreground">Instrucciones propias de esta aplicación que se agregan a cada conversación, además de la personalidad. Nunca cambian permisos.</p>
      {library.context.exists ? <p role="status" className="text-xs text-muted-foreground">Definido · {library.context.bytes} caracteres aprox.</p> : <p className="text-xs text-muted-foreground">Sin definir.</p>}
    </section>
    <section className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Agentes ({library.counts.agents})</h3>
        <Button size="sm" variant="outline" onClick={() => onOpen({ kind: "new", type: "agent" })}><Plus className="size-4" />Nuevo agente</Button>
      </div>
      {library.agents.length ? library.agents.map(agent => row(agent, agent.name ?? agent.path, <Bot className="mt-0.5 size-4 shrink-0 text-muted-foreground" />, () => onOpen({ kind: "file", path: agent.path, name: agent.name ?? agent.path })))
        : <p className="text-xs text-muted-foreground">Todavía no hay agentes. Con "Nuevo agente" creás el primero.</p>}
    </section>
    <section className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Skills ({library.counts.skills})</h3>
        <Button size="sm" variant="outline" onClick={() => onOpen({ kind: "new", type: "skill" })}><Plus className="size-4" />Nueva skill</Button>
      </div>
      {library.skills.length ? library.skills.map(skill => row(skill, skill.name ?? skill.path, <BookText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />, () => onOpen({ kind: "file", path: skill.path, name: skill.name ?? skill.path })))
        : <p className="text-xs text-muted-foreground">Todavía no hay skills. Cuando le enseñás un procedimiento al asistente, él te propondrá guardarla acá.</p>}
      {library.files.length ? <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Otros archivos de la biblioteca ({library.files.length})</summary>
        <ul className="mt-2 grid gap-1">{library.files.map(file => <li key={file.path} className="flex items-center gap-2"><Wrench className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">{file.path}</span><Badge variant="outline">{ORIGIN_LABEL[file.origin]}</Badge></li>)}</ul></details> : null}
    </section></> : null}
    {notice ? <p role="status" className="text-sm">{notice}</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </div>;
}

function ContextEditor({ app, client, onBack, onChanged }: { app: SpecialistApplication; client: OpenworkServerClient; onBack(): void; onChanged(): Promise<void> }) {
  const query = useQuery({ queryKey: ["specialist-context", client.baseUrl, app.id], queryFn: () => client.getSpecialistContext(app.id), retry: false });
  const [content, setContent] = useState<string | null>(null);
  const value = content ?? query.data?.content ?? "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true); setError(null);
    try { await client.putSpecialistContext(app.id, value); await onChanged(); onBack(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar el contexto."); }
    finally { setBusy(false); }
  }
  if (query.isPending) return <Skeleton className="h-40 w-full" />;
  if (query.isError) return <><Button variant="ghost" size="sm" className="justify-self-start" onClick={onBack}><ArrowLeft className="size-4" />Volver</Button><p role="alert" className="text-sm text-destructive">No se pudo leer el contexto. <Button variant="link" onClick={() => void query.refetch()}>Volver a intentar</Button></p></>;
  return <form className="grid gap-3" onSubmit={event => { event.preventDefault(); void save(); }}>
    <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={onBack}><ArrowLeft className="size-4" />Volver</Button>
    <Label htmlFor="specialist-context">Contexto de la aplicación</Label>
    <p className="text-xs text-muted-foreground">Lo que esta aplicación siempre debe saber y respetar: tus convenciones, formato de entrega, criterios. Se agrega a cada conversación de todos sus proyectos.</p>
    <Textarea id="specialist-context" rows={12} spellCheck={false} value={value} onChange={event => setContent(event.target.value)} maxLength={8000} placeholder="Por ejemplo: Entregá siempre los informes en Word y las planillas en Excel. Usá unidades métricas. Confirmá antes de enviar algo a un cliente." />
    <p className="text-xs text-muted-foreground">{value.length} / 8000 caracteres. Vaciarlo y guardar lo elimina.</p>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar contexto"}</Button><Button type="button" variant="ghost" onClick={onBack}>Cancelar</Button></div>
  </form>;
}

function FileEditor({ app, client, path, name, onBack, onChanged }: { app: SpecialistApplication; client: OpenworkServerClient; path: string; name: string; onBack(): void; onChanged(): Promise<void> }) {
  const query = useQuery({ queryKey: ["specialist-library-file", client.baseUrl, app.id, path], queryFn: () => client.getSpecialistLibraryFile(app.id, path), retry: false });
  const [content, setContent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function save() {
    setBusy(true); setError(null); setNotice(null);
    try { const result = await client.putSpecialistLibraryFile(app.id, path, content ?? ""); setNotice(syncNotice(result.sync)); await onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar el archivo."); }
    finally { setBusy(false); }
  }
  if (query.isPending) return <Skeleton className="h-40 w-full" />;
  if (query.isError) return <><Button variant="ghost" size="sm" className="justify-self-start" onClick={onBack}><ArrowLeft className="size-4" />Volver</Button><p role="alert" className="text-sm text-destructive">No se pudo abrir el archivo. <Button variant="link" onClick={() => void query.refetch()}>Volver a intentar</Button></p></>;
  const file = query.data!;
  return <form className="grid gap-3" onSubmit={event => { event.preventDefault(); void save(); }}>
    <div className="flex items-center justify-between gap-2">
      <Button type="button" variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="size-4" />Volver</Button>
      <Badge variant="outline">{ORIGIN_LABEL[file.origin]}</Badge>
    </div>
    <h3 className="font-medium">{name}</h3>
    <p className="text-xs text-muted-foreground">El bloque superior entre <code>---</code> es la ficha del {path.endsWith("SKILL.md") ? "skill" : "agente"}: descripción y modo. Debajo van las instrucciones.</p>
    <Textarea aria-label={`Contenido de ${name}`} rows={16} spellCheck={false} className="font-mono text-xs" value={content ?? file.content} onChange={event => setContent(event.target.value)} maxLength={1_000_000} />
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {notice ? <p role="status" className="text-xs text-muted-foreground">{notice}</p> : null}
    <div className="flex gap-2"><Button type="submit" disabled={busy || content === null || content === file.content}>{busy ? "Guardando…" : "Guardar"}</Button><Button type="button" variant="ghost" onClick={onBack}>Cerrar</Button></div>
  </form>;
}

function NewItem({ app, client, type, onBack, onChanged }: { app: SpecialistApplication; client: OpenworkServerClient; type: "agent" | "skill"; onBack(): void; onChanged(): Promise<void> }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function create() {
    setBusy(true); setError(null);
    try {
      const payload = { name: name.trim(), description: description.trim(), ...(content.trim() ? { content } : {}) };
      const result = type === "agent" ? await client.createSpecialistAgent(app.id, payload) : await client.createSpecialistSkill(app.id, payload);
      toast.success(`Se creó ${payload.name}${syncNotice(result.sync) ? ` · ${syncNotice(result.sync)}` : ""}`);
      await onChanged(); onBack();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo crear."); }
    finally { setBusy(false); }
  }
  return <form className="grid gap-3" onSubmit={event => { event.preventDefault(); void create(); }}>
    <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={onBack}><ArrowLeft className="size-4" />Volver</Button>
    <h3 className="font-medium">Nuevo {type === "agent" ? "agente" : "skill"} para {app.name}</h3>
    <div className="grid gap-1.5"><Label htmlFor="library-new-name">Nombre ({type === "agent" ? "del archivo" : "de la carpeta"}, minúsculas, sin espacios)</Label>
      <Input id="library-new-name" autoFocus value={name} onChange={event => setName(event.target.value)} placeholder={type === "agent" ? "por ejemplo: redactor-informes" : "por ejemplo: informe-mensual"} required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={64} /></div>
    <div className="grid gap-1.5"><Label htmlFor="library-new-description">Para qué sirve (aparece en la ficha)</Label>
      <Textarea id="library-new-description" rows={2} value={description} onChange={event => setDescription(event.target.value)} required maxLength={1024} placeholder="Usar cuando haga falta… Explicá en una frase cuándo y para qué." /></div>
    <div className="grid gap-1.5"><Label htmlFor="library-new-content">Contenido (opcional)</Label>
      <Textarea id="library-new-content" rows={8} spellCheck={false} className="font-mono text-xs" value={content} onChange={event => setContent(event.target.value)} placeholder="Si lo dejás vacío, se crea con una plantilla para completar: cuándo usarlo, pasos y entregable." /></div>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <div className="flex gap-2"><Button type="submit" disabled={busy || !name.trim() || !description.trim()}>{busy ? "Creando…" : `Crear ${type === "agent" ? "agente" : "skill"}`}</Button><Button type="button" variant="ghost" onClick={onBack}>Cancelar</Button></div>
  </form>;
}

const TASKS_KEY = (client: OpenworkServerClient, app: SpecialistApplication) => ["specialist-tasks", client.baseUrl, app.id] as const;

const DATASETS_KEY = (client: OpenworkServerClient, app: SpecialistApplication) => ["specialist-datasets", client.baseUrl, app.id] as const;

/** Shared options for the datasets list: same idle-refetch rhythm as the tasks helpers. Refresh
 *  is a long awaited call, so its result invalidates the list + open detail instead of polling. */
function datasetsQuery(client: OpenworkServerClient, app: SpecialistApplication) {
  return { queryKey: DATASETS_KEY(client, app), queryFn: () => client.getSpecialistDatasets(app.id), retry: false, refetchInterval: 30_000 };
}

function previewText(value: unknown): string {
  if (typeof value === "object" && value !== null && !Array.isArray(value) && "tooLarge" in value) return "El último snapshot supera los 200 KB y no se previsualiza acá. Está en el proyecto, en comex/datasets.";
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
}

type DatasetRef = { id: string; workspaceId: string; name: string };

function DatasetsSummary({ app, client }: { app: SpecialistApplication; client: OpenworkServerClient }) {
  const query = useQuery(datasetsQuery(client, app));
  if (query.isPending) return <Skeleton className="h-8 w-full" />;
  if (query.isError) return <p role="alert" className="text-xs text-destructive">No se pudieron leer los datasets. <Button variant="link" className="h-auto p-0 text-xs" onClick={() => void query.refetch()}>Volver a intentar</Button></p>;
  const datasets = query.data?.datasets ?? [];
  if (!datasets.length) return <p className="text-xs text-muted-foreground">Sin datasets todavía. Cada investigación que responde el asistente deja su consulta guardada acá, lista para volver a ejecutar.</p>;
  const workspaces = new Set(datasets.map(dataset => dataset.workspaceId));
  return <ul className="grid gap-1 text-xs text-muted-foreground">{datasets.slice(0, 4).map(dataset => <li key={`${dataset.workspaceId}/${dataset.id}`} className="flex items-center gap-2">
    <Database className="size-3.5 shrink-0" /><span className="max-w-40 truncate">{dataset.name}</span>
    <span className="min-w-0 flex-1 truncate">{dataset.question}</span>
    {workspaces.size > 1 ? <span className="max-w-32 truncate">{dataset.workspaceName}</span> : null}
    <span>actualizado {formatWhen(dataset.updatedAt)}</span>
  </li>)}</ul>;
}

function DatasetsView({ app, client, onBack }: { app: SpecialistApplication; client: OpenworkServerClient; onBack(): void }) {
  const queryClient = useQueryClient();
  const query = useQuery(datasetsQuery(client, app));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DatasetRef | null>(null);
  const [open, setOpen] = useState<DatasetRef | null>(null);
  const detail = useQuery({
    queryKey: [...DATASETS_KEY(client, app), "detalle", open?.workspaceId ?? "", open?.id ?? ""],
    queryFn: () => client.getSpecialistDataset(app.id, open!.id, open!.workspaceId),
    retry: false, enabled: open !== null,
  });
  async function run(action: () => Promise<unknown>, message?: string) {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await action();
      await query.refetch();
      // The open detail (a prefix of this key) must re-read the new snapshot, not the cache.
      queryClient.invalidateQueries({ queryKey: DATASETS_KEY(client, app) });
      if (message) setNotice(message);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo completar la acción."); }
    finally { setBusy(false); }
  }
  if (query.isPending) return <div className="grid gap-3"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>;
  if (query.isError) return <><Button variant="ghost" size="sm" className="justify-self-start" onClick={onBack}><ArrowLeft className="size-4" />Volver</Button><p role="alert" className="text-sm text-destructive">No se pudieron leer los datasets. <Button variant="link" onClick={() => void query.refetch()}>Volver a intentar</Button></p></>;
  const datasets = query.data?.datasets ?? [];
  const workspaces = new Set(datasets.map(dataset => dataset.workspaceId));
  const isOpen = (dataset: SpecialistDataset) => open !== null && open.id === dataset.id && open.workspaceId === dataset.workspaceId;
  return <div className="grid gap-3">
    <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={onBack}><ArrowLeft className="size-4" />Volver</Button>
    <h3 className="font-medium">Datasets de investigación de {app.name}</h3>
    <p className="text-xs text-muted-foreground">Cada consulta de investigación queda guardada como dataset dentro de su proyecto, con sus snapshots. "Actualizar" vuelve a ejecutar la consulta guardada con Tavily; los derivados son vistas limpias que producen otras.</p>
    {pendingDelete ? <div role="alertdialog" aria-label={`Confirmar eliminación de ${pendingDelete.name}`} className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
      <span className="min-w-0 flex-1">¿Eliminar "{pendingDelete.name}"? Se quitan también sus snapshots del proyecto.</span>
      <Button size="sm" variant="destructive" disabled={busy} onClick={() => { const target = pendingDelete; void run(async () => { await client.deleteSpecialistDataset(app.id, target.id, target.workspaceId); setPendingDelete(null); setOpen(current => current?.id === target.id && current.workspaceId === target.workspaceId ? null : current); }, `Se eliminó ${target.name}.`); }}>Eliminar</Button>
      <Button size="sm" variant="ghost" onClick={() => setPendingDelete(null)}>Cancelar</Button>
    </div> : null}
    {notice ? <p role="status" className="text-sm">{notice}</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {datasets.length ? datasets.map(dataset => <div key={`${dataset.workspaceId}/${dataset.id}`} className="grid gap-2 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} aria-label={`Ver snapshots de ${dataset.name}`} aria-expanded={isOpen(dataset)} onClick={() => setOpen(isOpen(dataset) ? null : { id: dataset.id, workspaceId: dataset.workspaceId, name: dataset.name })} className="flex min-w-0 flex-1 items-start gap-3 text-left">
          <Database className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{dataset.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{dataset.question}</span>
          </span>
        </button>
        {dataset.provider === "tavily" || dataset.provider === "openapi" ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => client.refreshSpecialistDataset(app.id, dataset.id, dataset.workspaceId), "Consulta re-ejecutada: el dataset quedó con un snapshot nuevo.")}>Actualizar</Button> : null}
        <Button size="sm" variant="ghost" disabled={busy} aria-label={`Eliminar ${dataset.name}`} onClick={() => setPendingDelete({ id: dataset.id, workspaceId: dataset.workspaceId, name: dataset.name })}><Trash2 className="size-4" /></Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {workspaces.size > 1 ? `${dataset.workspaceName} · ` : ""}
        {dataset.provider}/{dataset.operation} · {dataset.snapshots} snapshot{dataset.snapshots === 1 ? "" : "s"}{dataset.derivedFrom ? " · derivado de otro dataset" : ""} · actualizado {formatWhen(dataset.updatedAt)}
      </p>
      {isOpen(dataset) ? <div className="grid gap-1 border-t pt-2 text-xs">
        {detail.isPending ? <span className="text-muted-foreground">…</span>
          : detail.isError ? <span role="alert" className="text-destructive">No se pudo leer el último snapshot.</span>
          : detail.data?.latest === null ? <span className="text-muted-foreground">El dataset todavía no tuvo una corrida: su consulta está guardada y es re-ejecutable, pero no hay snapshot que leer.</span>
          : <><span className="text-muted-foreground">{detail.data?.snapshots.length ?? 0} snapshots en el proyecto:</span>
            <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px]">{previewText(detail.data?.latest)}</pre></>}
      </div> : null}
    </div>) : <p className="text-xs text-muted-foreground">Sin datasets todavía. Cuando el asistente investigue algo, la consulta quedará guardada acá.</p>}
  </div>;
}

const PROPOSAL_LABEL: Record<SpecialistProposal["kind"], string> = { skill: "Skill", agent: "Agente", context: "Contexto", task: "Tarea", plan: "Plan" };

/** Human summary of the JSON payload of task/plan proposals. Never throws: a hand-edited
 *  proposal shows only its description and the accept call fails loud with the real reason. */
function proposalSummary(proposal: SpecialistProposal): string | null {
  if (proposal.kind !== "task" && proposal.kind !== "plan") return null;
  try {
    const value = JSON.parse(proposal.content) as Record<string, unknown>;
    if (proposal.kind === "task") {
      const schedule = value.schedule as SpecialistTaskSchedule | undefined;
      return `Se crea PAUSADA${schedule ? ` · ${describeSchedule(schedule)}` : ""}`;
    }
    const pieces = (["skill", "dataset", "panel", "task"] as const).filter(piece => value[piece] !== undefined)
      .map(piece => piece === "task" ? "tarea pausada" : piece === "skill" ? "skill" : piece === "dataset" ? "dataset" : "panel");
    return pieces.length ? `Al aceptar se aplican: ${pieces.join(" + ")}` : null;
  } catch { return null; }
}

const SOURCES_KEY = (client: OpenworkServerClient, app: SpecialistApplication) => ["specialist-sources", client.baseUrl, app.id] as const;
function sourcesQuery(client: OpenworkServerClient, app: SpecialistApplication) {
  // Lists repaint while the dialog is open (matches datasets rhythm): new sources arrive from chat.
  return { queryKey: SOURCES_KEY(client, app), queryFn: () => client.getSpecialistSources(app.id), retry: false, refetchInterval: 30_000 } as const;
}
function SourcesSummary({ app, client }: { app: SpecialistApplication; client: OpenworkServerClient }) {
  const query = useQuery(sourcesQuery(client, app));
  if (query.isPending) return <Skeleton className="h-8 w-full" />;
  if (query.isError) return <p role="alert" className="text-xs text-destructive">No se pudieron leer las fuentes. <Button variant="link" className="h-auto p-0 text-xs" onClick={() => void query.refetch()}>Volver a intentar</Button></p>;
  const sources = query.data?.sources ?? [];
  if (!sources.length) return <p className="text-xs text-muted-foreground">Sin fuentes todavía. Cada investigación deja su evidencia como fuente citable ([fuente:…]) lista para citar con pasaje exacto.</p>;
  const multi = new Set(sources.map(source => source.workspaceId)).size > 1;
  return <ul className="grid gap-1 text-xs text-muted-foreground">{sources.slice(0, 4).map(source => <li key={`${source.workspaceId}/${source.id}`} className="flex items-center gap-2">
    <LibraryBig className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">{source.title}</span>{multi ? <span className="shrink-0">{source.workspaceName}</span> : null}
  </li>)}</ul>;
}

function SourcesView({ app, client, localFiles, onBack }: { app: SpecialistApplication; client: OpenworkServerClient; localFiles: boolean; onBack(): void }) {
  const query = useQuery(sourcesQuery(client, app));
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [localPath, setLocalPath] = useState("");
  const [localBusy, setLocalBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  async function addLocal() {
    if (!localPath.trim() || localBusy) return;
    setLocalBusy(true); setLocalError(null); setLocalNotice(null);
    try {
      const result = await client.addSpecialistLocalSource(app.id, localPath.trim());
      setLocalNotice(`Fuente registrada: ${result.source.title}. Ya se puede citar como [fuente:${result.source.id}#n].`);
      setLocalPath(""); setAdding(false);
      await queryClient.invalidateQueries({ queryKey: SOURCES_KEY(client, app) });
    } catch (cause) { setLocalError(cause instanceof Error ? cause.message : "No se pudo registrar la fuente local."); }
    finally { setLocalBusy(false); }
  }
  if (query.isPending) return <><Button variant="ghost" size="sm" className="justify-self-start" onClick={onBack}><ArrowLeft className="size-4" />Volver</Button><Skeleton className="h-24 w-full" /></>;
  if (query.isError) return <><Button variant="ghost" size="sm" className="justify-self-start" onClick={onBack}><ArrowLeft className="size-4" />Volver</Button><p role="alert" className="text-sm text-destructive">No se pudieron leer las fuentes. <Button variant="link" onClick={() => void query.refetch()}>Volver a intentar</Button></p></>;
  const sources = query.data?.sources ?? [];
  const workspaces = new Set(sources.map(source => source.workspaceId));
  return <div className="grid gap-3">
    <Button variant="ghost" size="sm" className="justify-self-start" onClick={onBack}><ArrowLeft className="size-4" />Volver</Button>
    <h3 className="text-sm font-medium">Fuentes citables de {app.name}</h3>
    <p className="text-xs text-muted-foreground">Cada pieza de material recuperado tiene un id y se cita como [fuente:id#n], donde n es el nº de pasaje. Abrir una fuente muestra sus pasajes tal como están en el proyecto.</p>
    {localFiles ? <div className="grid gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium">Archivo local</p>
        <Button size="sm" variant="outline" onClick={() => setAdding(!adding)}>{adding ? "Cancelar" : "Registrar archivo"}</Button>
      </div>
      {adding ? <form className="grid gap-2" onSubmit={event => { event.preventDefault(); void addLocal(); }}>
        <Label htmlFor="source-local-path">Ruta en el proyecto (texto, CSV, Markdown o HTML)</Label>
        <Input id="source-local-path" value={localPath} onChange={event => setLocalPath(event.target.value)} placeholder="datos/informe.md" autoFocus />
        <div><Button size="sm" type="submit" disabled={localBusy || !localPath.trim()}>{localBusy ? "Registrando…" : "Registrar como fuente"}</Button></div>
        {localError ? <p role="alert" className="text-xs text-destructive">{localError}</p> : null}
      </form> : null}
      {localNotice ? <p role="status" className="text-xs">{localNotice}</p> : null}
    </div> : null}
    {sources.length ? sources.map(source => <SourceRow key={`${source.workspaceId}/${source.id}`} app={app} client={client} source={source} open={openId === source.id} onToggle={() => setOpenId(openId === source.id ? null : source.id)} multi={workspaces.size > 1} />)
      : <p className="text-xs text-muted-foreground">Sin fuentes todavía. Cuando el asistente investigue algo, la evidencia quedará registrada acá.</p>}
  </div>;
}

function SourceRow({ app, client, source, open, onToggle, multi }: { app: SpecialistApplication; client: OpenworkServerClient; source: SpecialistSource; open: boolean; onToggle(): void; multi: boolean }) {
  const detail = useQuery({
    queryKey: [...SOURCES_KEY(client, app), source.workspaceId, source.id],
    queryFn: () => client.getSpecialistSource(app.id, source.id, source.workspaceId),
    enabled: open, retry: false,
  });
  return <div className="grid gap-2 rounded-md border p-3 text-sm">
    <div className="flex items-center gap-2">
      <LibraryBig className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate font-medium">{source.title}</span>
      <Badge variant="outline">{source.provider}</Badge>
    </div>
    <p className="text-xs text-muted-foreground">
      {source.id}{multi ? ` · ${source.workspaceName}` : ""} · {source.chunks ? `${source.chunks} ${source.chunks === 1 ? "pasaje" : "pasajes"}` : "sin pasajes citables"} · {formatWhen(source.retrievedAt)}
      {source.url ? <> · <a href={source.url} target="_blank" rel="noreferrer" className="underline">{source.url}</a></> : null}
    </p>
    <Button size="sm" variant="ghost" className="justify-self-start" aria-expanded={open} onClick={onToggle}>{open ? "Ocultar pasajes" : "Ver pasajes"}</Button>
    {open ? detail.isPending ? <Skeleton className="h-16 w-full" />
      : detail.isError ? <p role="alert" className="text-xs text-destructive">No se pudo leer la fuente. <Button variant="link" className="h-auto p-0 text-xs" onClick={() => void detail.refetch()}>Volver a intentar</Button></p>
      : detail.data && !detail.data.ok ? <p role="alert" className="text-xs text-destructive">{detail.data.error ?? "La fuente no se pudo leer."}</p>
      : detail.data?.chunks?.length ? <ol className="grid gap-2">{detail.data.chunks.map((text, index) => <li key={index} className="grid gap-0.5 rounded bg-muted/40 p-2 text-xs">
        <span className="font-medium">[fuente:{source.id}#{index}]</span><span>{text}</span></li>)}</ol>
      : <p className="text-xs text-muted-foreground">Sin pasajes: la evidencia guardada no tiene texto largo para dividir.</p> : null}
  </div>;
}

const PANELS_KEY = (client: OpenworkServerClient, app: SpecialistApplication) => ["specialist-panels", client.baseUrl, app.id] as const;
function panelsQuery(client: OpenworkServerClient, app: SpecialistApplication) {
  return { queryKey: PANELS_KEY(client, app), queryFn: () => client.getSpecialistPanels(app.id), retry: false, refetchInterval: 30_000 } as const;
}
function PanelsSummary({ app, client }: { app: SpecialistApplication; client: OpenworkServerClient }) {
  const query = useQuery(panelsQuery(client, app));
  if (query.isPending) return <Skeleton className="h-8 w-full" />;
  if (query.isError) return <p role="alert" className="text-xs text-destructive">No se pudieron leer los paneles. <Button variant="link" className="h-auto p-0 text-xs" onClick={() => void query.refetch()}>Volver a intentar</Button></p>;
  const panels = query.data?.panels ?? [];
  if (!panels.length) return <p className="text-xs text-muted-foreground">Sin paneles todavía. El asistente puede crear una vista viva sobre los datos de investigación.</p>;
  return <ul className="grid gap-1 text-xs text-muted-foreground">{panels.slice(0, 4).map(panel => <li key={panel.name} className="flex items-center gap-2">
    <LayoutDashboard className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">{panel.title}</span><span className="shrink-0">{panel.source}</span>
  </li>)}</ul>;
}

function PanelsView({ app, client, panelApps, onBack }: { app: SpecialistApplication; client: OpenworkServerClient; panelApps: boolean; onBack(): void }) {
  const query = useQuery(panelsQuery(client, app));
  const queryClient = useQueryClient();
  const [openName, setOpenName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ name: string; title: string } | null>(null);
  async function remove(name: string) {
    setError(null);
    try { await client.deleteSpecialistPanel(app.id, name); await queryClient.invalidateQueries({ queryKey: PANELS_KEY(client, app) }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo eliminar el panel."); }
  }
  if (query.isPending) return <><Button variant="ghost" size="sm" className="justify-self-start" onClick={onBack}><ArrowLeft className="size-4" />Volver</Button><Skeleton className="h-24 w-full" /></>;
  if (query.isError) return <><Button variant="ghost" size="sm" className="justify-self-start" onClick={onBack}><ArrowLeft className="size-4" />Volver</Button><p role="alert" className="text-sm text-destructive">No se pudieron leer los paneles. <Button variant="link" onClick={() => void query.refetch()}>Volver a intentar</Button></p></>;
  const panels = query.data?.panels ?? [];
  return <div className="grid gap-3">
    <Button variant="ghost" size="sm" className="justify-self-start" onClick={onBack}><ArrowLeft className="size-4" />Volver</Button>
    <h3 className="text-sm font-medium">Paneles de {app.name}</h3>
    <p className="text-xs text-muted-foreground">Vistas declarativas sobre los datasets: se redibujan solas cuando llega un snapshot nuevo. Si algo no se puede dibujar, el panel lo dice en vez de quedar en blanco.</p>
    {panelApps ? <p className="text-xs text-muted-foreground">Este panel también se abre como <span className="font-medium">App interactiva dentro del chat</span>: pedile al asistente que lo muestre y vas a poder refrescarlo desde la tarjeta.</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {pendingDelete ? <div role="alertdialog" aria-label={`Confirmar eliminación del panel ${pendingDelete.title}`} className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
      <span className="min-w-0 flex-1">¿Eliminar el panel "{pendingDelete.title}"? Dejará de dibujarse en los proyectos.</span>
      <Button size="sm" variant="destructive" onClick={() => { const target = pendingDelete; setPendingDelete(null); void remove(target.name); }}>Eliminar</Button>
      <Button size="sm" variant="ghost" onClick={() => setPendingDelete(null)}>Cancelar</Button>
    </div> : null}
    {panels.length ? panels.map(panel => <div key={panel.name} className="grid gap-2 rounded-md border p-3 text-sm">
      <div className="flex items-center gap-2">
        <LayoutDashboard className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">{panel.title}</span>
        <Button size="sm" variant="ghost" aria-expanded={openName === panel.name} onClick={() => setOpenName(openName === panel.name ? null : panel.name)}>{openName === panel.name ? "Ocultar" : "Ver"}</Button>
        <Button size="sm" variant="ghost" aria-label={`Eliminar panel ${panel.title}`} onClick={() => setPendingDelete({ name: panel.name, title: panel.title })}><Trash2 className="size-4" /></Button>
      </div>
      {openName === panel.name ? <PanelCanvas key={panel.name} app={app} client={client} name={panel.name} /> : null}
    </div>) : <p className="text-xs text-muted-foreground">Sin paneles todavía. Pedile al asistente "mostrame los datos en un panel" y te propondrá crear uno.</p>}
  </div>;
}

/** Same aggregation the server's panelAggregate shares with the future ui:// compiler:
 *  last/first verbatim, sum/avg/min/max over the numeric column only, non-numeric → "—".
 *  MUST MATCH apps/server/src/specialists/panels.ts (panelAggregate): change both together.
 *  `agg` is the server union — an unknown value would silently become max (reviewer finding).
 *  last/first pass through scalars only; objects/arrays render "—" instead of crashing formatStat.
 *  format "percent" means FRACTION (0.25 → "25.0 %"); a pre-scaled 25 column would be wrong. */
function panelAggregate(rows: Array<Record<string, unknown>>, field: string, agg: "last" | "first" | "sum" | "avg" | "count" | "min" | "max"): number | string | null {
  const column = rows.map(row => row[field]);
  if (agg === "count") return column.length;
  if (agg === "last") { const value = column.at(-1); return typeof value === "number" || typeof value === "string" ? value : null; }
  if (agg === "first") { const value = column[0]; return typeof value === "number" || typeof value === "string" ? value : null; }
  const numbers = column.map(entry => typeof entry === "number" ? entry : typeof entry === "string" && entry.trim() !== "" && Number.isFinite(Number(entry)) ? Number(entry) : null).filter((entry): entry is number => entry !== null);
  if (!numbers.length) return null;
  if (agg === "sum") return numbers.reduce((total, value) => total + value, 0);
  if (agg === "avg") return numbers.reduce((total, value) => total + value, 0) / numbers.length;
  if (agg === "min") return Math.min(...numbers);
  return Math.max(...numbers);
}
function panelRows(data: unknown): { rows: Array<Record<string, unknown>>; error?: string } {
  if (Array.isArray(data) && data.every(entry => typeof entry === "object" && entry !== null && !Array.isArray(entry))) {
    return { rows: data as Array<Record<string, unknown>> };
  }
  if (typeof data === "object" && data !== null) {
    for (const value of Object.values(data as Record<string, unknown>)) {
      const nested = panelRows(value);
      if (nested.rows.length) return nested;
    }
  }
  return { rows: [], error: "Los datos no tienen forma de tabla (array de objetos)." };
}
const formatStat = (value: number | string | null, format?: string) => {
  if (value === null) return "—";
  if (typeof value === "string") return value;
  if (format === "percent") return `${(value * 100).toFixed(1)} %`;
  if (format === "currency") return new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(value);
};

function PanelCanvas({ app, client, name }: { app: SpecialistApplication; client: OpenworkServerClient; name: string }) {
  const query = useQuery({
    queryKey: [...PANELS_KEY(client, app), "resolve", name],
    queryFn: () => client.resolveSpecialistPanel(app.id, name),
    retry: false,
    refetchInterval: 15_000,
  });
  if (query.isPending) return <Skeleton className="h-24 w-full" />;
  if (query.isError) return <p role="alert" className="text-xs text-destructive">No se pudo resolver el panel. <Button variant="link" className="h-auto p-0 text-xs" onClick={() => void query.refetch()}>Volver a intentar</Button></p>;
  const { spec, resolutions } = query.data;
  const multi = resolutions.length > 1;
  return <div className="grid gap-3">
    <p className="text-xs text-muted-foreground">Fuente: {"dataset" in spec.source ? `dataset ${spec.source.dataset}` : `archivo ${spec.source.file}`}{spec.refresh ? " · se redibuja solo al cambiar el snapshot" : ""}</p>
    {resolutions.map(resolution => <div key={resolution.workspaceId} className="grid gap-2">
      {multi ? <p className="text-xs font-medium">{resolution.workspaceName}</p> : null}
      <PanelResolutionBlocks resolution={resolution} spec={spec} />
    </div>)}
  </div>;
}

function PanelResolutionBlocks({ resolution, spec }: { resolution: SpecialistPanelResolution; spec: { blocks: SpecialistPanelBlock[]; source: { dataset: string } | { file: string } } }) {
  if (!resolution.ok) {
    return <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">Este panel no se puede dibujar acá: {resolution.error ?? "sin detalle"}</p>;
  }
  const { rows, error: rowsError } = panelRows(resolution.data);
  return <div className="grid gap-2">
    {spec.blocks.map((block, index) => {
      if (block.type === "markdown") return <p key={index} className="whitespace-pre-wrap text-xs text-muted-foreground">{block.text}</p>;
      if (block.type === "changes") {
        const diff = resolution.diff as { at?: number; diff?: { summary?: string } } | null;
        return <div key={index} className="rounded-md bg-muted/40 p-2 text-xs">
          <p className="font-medium">{block.title ?? "Cambios desde la última corrida"}</p>
          {diff?.diff ? <p className="text-muted-foreground">{diff.diff.summary ?? "sin detalle"} · {formatWhen(diff.at ?? null)}</p>
            : "file" in spec.source ? <p className="text-muted-foreground">Este panel lee un archivo, no un dataset: no hay corridas que comparar. Para ver cambios entre versiones, guardá los datos como dataset.</p>
            : <p className="text-muted-foreground">Todavía no hubo una corrida que compare: aparece tras el primer refresh.</p>}
        </div>;
      }
      if (rowsError) return <p key={index} role="alert" className="rounded-md border p-2 text-xs text-destructive">{rowsError}</p>;
      switch (block.type) {
        case "stat": {
          const value = panelAggregate(rows, block.field, block.agg ?? "last");
          return <div key={index} className="rounded-md bg-muted/40 p-2 text-xs">
            <p className="text-muted-foreground">{block.title ?? block.field}</p>
            <p className="text-lg font-semibold">{formatStat(value, block.format)}</p>
          </div>;
        }
        case "table": {
          const allColumns = rows[0] ? Object.keys(rows[0]) : [];
          const columns = block.columns ?? allColumns.slice(0, 8);
          const sorted = block.sort ? [...rows].sort((a, b) => {
            const av = a[block.sort!.by], bv = b[block.sort!.by];
            const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av ?? "").localeCompare(String(bv ?? ""));
            return block.sort!.desc ? -cmp : cmp;
          }) : rows;
          const limit = block.limit ?? 50;
          const visible = sorted.slice(0, limit);
          // Truncation is never silent: the card says how much it is showing of what exists.
          return <div key={index} className="grid gap-1">
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <caption className="sr-only">Tabla del panel</caption>
              <thead><tr>{columns.map(column => <th key={column} scope="col" className="border-b p-1 text-left font-medium">{column}</th>)}</tr></thead>
              <tbody>{visible.map((row, rowIndex) => <tr key={rowIndex}>{columns.map(column => <td key={column} className="border-b p-1">{String(row[column] ?? "")}</td>)}</tr>)}</tbody>
            </table></div>
            {visible.length < sorted.length || (block.columns === undefined && allColumns.length > columns.length)
              ? <p className="text-xs text-muted-foreground">Mostrando {visible.length} de {sorted.length} filas{block.columns === undefined && allColumns.length > columns.length ? ` · ${columns.length} de ${allColumns.length} columnas` : ""}.</p>
              : null}
          </div>;
        }
        case "line":
        case "bar": {
          const xs = rows.map(row => String(row[block.x] ?? ""));
          const series = block.y.map(field => ({ field, values: rows.map(row => { const n = Number(row[field]); return Number.isFinite(n) ? n : null; }) }));
          const flat = series.flatMap(entry => entry.values.filter((v): v is number => v !== null));
          // A chart that can't draw must SAY so, never render a silent blank ([3] fails loud).
          if (!flat.length) return <p key={index} role="alert" className="rounded-md border p-2 text-xs text-muted-foreground">Este gráfico no tiene valores numéricos para dibujar (columna ausente o no numérica).</p>;
          if (block.type === "bar") {
            // Bars are magnitudes from zero: a shared zero baseline keeps widths comparable.
            const barSpan = (Math.max(...flat, 0) || 1) - Math.min(...flat, 0) || 1;
            return <div key={index} className="grid gap-1 text-xs" role="img" aria-label={`Gráfico de barras: ${block.title ?? block.y.join(", ")}`}>
              <p className="font-medium">{block.title ?? block.y.join(", ")}</p>
              {series.flatMap(entry => rows.slice(0, 20).map((row, rowIndex) => {
                const value = entry.values[rowIndex] ?? null;
                return <div key={`${entry.field}-${rowIndex}`} className="grid grid-cols-[7rem_1fr_3.5rem] items-center gap-2">
                  <span className="truncate text-muted-foreground">{xs[rowIndex]}{series.length > 1 ? ` · ${entry.field}` : ""}</span>
                  {/* The percentage is of this track only: the value column keeps the row from overflowing. */}
                  <span className="relative h-3 min-w-0 rounded-sm bg-muted/50">
                    {value === null ? null : <span className="absolute inset-y-0 left-0 rounded-sm bg-primary/70" style={{ width: `${Math.max(1, Math.min(100, Math.abs(value) / barSpan * 100))}%` }} />}
                  </span>
                  <span className="truncate text-right text-muted-foreground">{value ?? "—"}</span>
                </div>;
              }))}
            </div>;
          }
          // A line shows shape, not magnitude: a zero-based scale flattens 486→491 into a straight
          // line. Use the series' own range, with the zero line only when the range crosses zero.
          const lineMin = Math.min(...flat);
          const lineMax = Math.max(...flat);
          const lineSpan = lineMax - lineMin || 1;
          const yFor = (value: number) => 80 - ((value - lineMin) / lineSpan) * 74 - 3;
          return <div key={index} className="grid gap-1 text-xs">
            <p className="font-medium">{block.title ?? block.y.join(", ")}</p>
            <svg viewBox={`0 0 300 80`} className="h-20 w-full" role="img" aria-label={`Gráfico de líneas: ${block.title ?? block.y.join(", ")}`}>
              {lineMin < 0 && lineMax > 0 ? <line x1="0" x2="300" y1={yFor(0)} y2={yFor(0)} stroke="#9ca3af" strokeWidth="0.5" strokeDasharray="3 3" /> : null}
              {series.map((entry, seriesIndex) => {
                const color = ["#2563eb", "#dc2626", "#059669", "#d97706"][seriesIndex % 4];
                const coords = entry.values.map((value, pointIndex) => value === null ? null : { x: (pointIndex / Math.max(1, entry.values.length - 1)) * 300, y: yFor(value) });
                // Split on gaps: interpolation across missing data would be a lie.
                const segments: Array<Array<{ x: number; y: number }>> = [];
                let current: Array<{ x: number; y: number }> = [];
                for (const point of coords) { if (point) current.push(point); else if (current.length) { segments.push(current); current = []; } }
                if (current.length) segments.push(current);
                return <g key={entry.field}>
                  {segments.map((segment, segmentIndex) => segment.length === 1
                    ? <circle key={segmentIndex} cx={segment[0]!.x} cy={segment[0]!.y} r="2.5" fill={color} />
                    : <polyline key={segmentIndex} points={segment.map(point => `${point.x},${point.y}`).join(" ")} fill="none" stroke={color} strokeWidth="1.5" />)}
                </g>;
              })}
            </svg>
            <div className="flex flex-wrap gap-2">{series.map((entry, seriesIndex) => <span key={entry.field} className="flex items-center gap-1 text-muted-foreground">
              <span className="inline-block size-2 rounded-full" style={{ background: ["#2563eb", "#dc2626", "#059669", "#d97706"][seriesIndex % 4] }} />{entry.field}</span>)}</div>
          </div>;
        }
        default: return null;
      }
    })}
  </div>;
}

const OUTPUTS_KEY = (client: OpenworkServerClient, app: SpecialistApplication) => ["specialist-outputs", client.baseUrl, app.id] as const;
function outputsQuery(client: OpenworkServerClient, app: SpecialistApplication) {
  return { queryKey: OUTPUTS_KEY(client, app), queryFn: () => client.getSpecialistOutputs(app.id), retry: false, refetchInterval: 30_000 } as const;
}
const OUTPUT_LABEL: Record<SpecialistOutput["kind"], string> = { mindmap: "Mapa mental", report: "Informe", flashcards: "Flashcards", quiz: "Quiz", table: "Tabla" };
function OutputsSummary({ app, client }: { app: SpecialistApplication; client: OpenworkServerClient }) {
  const query = useQuery(outputsQuery(client, app));
  if (query.isPending) return <Skeleton className="h-8 w-full" />;
  if (query.isError) return <p role="alert" className="text-xs text-destructive">No se pudieron leer las salidas. <Button variant="link" className="h-auto p-0 text-xs" onClick={() => void query.refetch()}>Volver a intentar</Button></p>;
  const outputs = query.data?.outputs ?? [];
  if (!outputs.length) return <p className="text-xs text-muted-foreground">Sin salidas todavía. El asistente convierte un dataset en mapa mental, informe, tarjetas o tabla, con sus citas auditadas.</p>;
  const multi = new Set(outputs.map(output => output.workspaceId)).size > 1;
  return <ul className="grid gap-1 text-xs text-muted-foreground">{outputs.slice(0, 4).map(output => <li key={`${output.workspaceId}/${output.id}`} className="flex items-center gap-2">
    <ScanSearch className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">{output.title}</span><span className="shrink-0">{OUTPUT_LABEL[output.kind]}{multi ? ` · ${output.workspaceName}` : ""}</span>
  </li>)}</ul>;
}

function OutputsView({ app, client, onBack }: { app: SpecialistApplication; client: OpenworkServerClient; onBack(): void }) {
  const query = useQuery(outputsQuery(client, app));
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SpecialistOutput | null>(null);
  async function remove(output: SpecialistOutput) {
    setError(null);
    try { await client.deleteSpecialistOutput(app.id, output.id, output.workspaceId); await queryClient.invalidateQueries({ queryKey: OUTPUTS_KEY(client, app) }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo eliminar la salida."); }
  }
  if (query.isPending) return <><Button variant="ghost" size="sm" className="justify-self-start" onClick={onBack}><ArrowLeft className="size-4" />Volver</Button><Skeleton className="h-24 w-full" /></>;
  if (query.isError) return <><Button variant="ghost" size="sm" className="justify-self-start" onClick={onBack}><ArrowLeft className="size-4" />Volver</Button><p role="alert" className="text-sm text-destructive">No se pudieron leer las salidas. <Button variant="link" onClick={() => void query.refetch()}>Volver a intentar</Button></p></>;
  const outputs = query.data?.outputs ?? [];
  const multi = new Set(outputs.map(output => output.workspaceId)).size > 1;
  return <div className="grid gap-3">
    <Button variant="ghost" size="sm" className="justify-self-start" onClick={onBack}><ArrowLeft className="size-4" />Volver</Button>
    <h3 className="text-sm font-medium">Salidas del mini-Studio de {app.name}</h3>
    <p className="text-xs text-muted-foreground">Un dataset, muchas formas de digerirlo. Cada salida es un archivo del proyecto (versionable en git) y declara si está anclada a sus fuentes.</p>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {pendingDelete ? <div role="alertdialog" aria-label={`Confirmar eliminación de la salida ${pendingDelete.title}`} className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
      <span className="min-w-0 flex-1">¿Eliminar la salida "{pendingDelete.title}"? Se quitan sus archivos del proyecto.</span>
      <Button size="sm" variant="destructive" onClick={() => { const target = pendingDelete; setPendingDelete(null); void remove(target); }}>Eliminar</Button>
      <Button size="sm" variant="ghost" onClick={() => setPendingDelete(null)}>Cancelar</Button>
    </div> : null}
    {outputs.length ? outputs.map(output => <div key={`${output.workspaceId}/${output.id}`} className="grid gap-2 rounded-md border p-3 text-sm">
      <div className="flex items-center gap-2">
        <ScanSearch className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">{output.title}</span>
        <Badge variant="outline">{OUTPUT_LABEL[output.kind]}</Badge>
        <Button size="sm" variant="ghost" aria-expanded={openId === output.id} onClick={() => setOpenId(openId === output.id ? null : output.id)}>{openId === output.id ? "Ocultar" : "Ver"}</Button>
        <Button size="sm" variant="ghost" aria-label={`Eliminar salida ${output.title}`} onClick={() => setPendingDelete(output)}><Trash2 className="size-4" /></Button>
      </div>
      {multi ? <p className="text-xs text-muted-foreground">{output.workspaceName} · {formatWhen(output.updatedAt)}</p> : null}
      {openId === output.id ? <OutputDetail key={output.id} app={app} client={client} output={output} /> : null}
    </div>) : <p className="text-xs text-muted-foreground">Sin salidas todavía. Pedile "haceme un mapa mental de esto" y el asistente lo generará acá.</p>}
  </div>;
}

function OutputDetail({ app, client, output }: { app: SpecialistApplication; client: OpenworkServerClient; output: SpecialistOutput }) {
  const detail = useQuery({
    queryKey: [...OUTPUTS_KEY(client, app), output.workspaceId, output.id],
    queryFn: () => client.getSpecialistOutput(app.id, output.id, output.workspaceId),
    retry: false,
  });
  const auditQuery = useQuery({
    queryKey: [...OUTPUTS_KEY(client, app), output.workspaceId, output.id, "audit"],
    queryFn: () => client.getSpecialistOutputAudit(app.id, output.id, output.workspaceId),
    retry: false,
  });
  if (detail.isPending) return <Skeleton className="h-16 w-full" />;
  if (detail.isError) return <p role="alert" className="text-xs text-destructive">No se pudo leer la salida. <Button variant="link" className="h-auto p-0 text-xs" onClick={() => void detail.refetch()}>Volver a intentar</Button></p>;
  const audit: SpecialistOutputAudit | undefined = auditQuery.data?.audit;
  return <div className="grid gap-2">
    <OutputBody kind={output.kind} content={detail.data.content} />
    {auditQuery.isPending ? <Skeleton className="h-6 w-full" />
      : audit ? <div className="grid gap-1 text-xs" role="status">
        {audit.total === 0 ? <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2">Sin anclas: esta salida no está anclada a fuentes del proyecto.</p>
          : audit.invalid.length ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-2">{audit.invalid.length} cita{audit.invalid.length === 1 ? "" : "s"} no resuelven: {audit.invalid.map(entry => `[fuente:${entry.sourceId}#${entry.chunk}]`).join(", ")}. No la des por buena sin revisarlas.</p>
          : <p className="text-muted-foreground">✓ {audit.valid}/{audit.total} citas resuelven a pasajes reales del proyecto.</p>}
      </div>
      : <p role="alert" className="text-xs text-destructive">No se pudo auditar la salida. <Button variant="link" className="h-auto p-0 text-xs" onClick={() => void auditQuery.refetch()}>Volver a intentar</Button></p>}
  </div>;
}

/** Reads a Studio output the way its kind is meant to be read: Markdown for reports and maps,
 *  flip cards for flashcards, answers you can try for quizzes and a real table for tables. Raw
 *  JSON stays as the fallback so a malformed file still shows something (and the audit says why). */
function OutputBody({ kind, content }: { kind: SpecialistOutput["kind"]; content: string }) {
  if (kind === "report" || kind === "mindmap") return <div className="max-h-80 overflow-auto rounded bg-muted/40 p-2 text-xs"><MarkdownPreview content={content} /></div>;
  let value: unknown;
  try { value = JSON.parse(content); } catch { return <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-xs">{content}</pre>; }
  if (kind === "table" && Array.isArray(value) && value.every(entry => entry && typeof entry === "object")) {
    const rows = value as Array<Record<string, unknown>>;
    const columns = rows[0] ? Object.keys(rows[0]).slice(0, 8) : [];
    return <div className="max-h-64 overflow-auto"><table className="w-full text-xs">
      <thead><tr>{columns.map(column => <th key={column} scope="col" className="border-b p-1 text-left font-medium">{column}</th>)}</tr></thead>
      <tbody>{rows.slice(0, 50).map((row, index) => <tr key={index}>{columns.map(column => <td key={column} className="border-b p-1">{typeof row[column] === "object" && row[column] !== null ? JSON.stringify(row[column]) : String(row[column] ?? "")}</td>)}</tr>)}</tbody>
    </table></div>;
  }
  if (kind === "flashcards" && Array.isArray(value)) {
    const cards = value.flatMap(entry => entry && typeof entry === "object" && typeof (entry as { front?: unknown }).front === "string" && typeof (entry as { back?: unknown }).back === "string" ? [entry as { front: string; back: string }] : []);
    if (cards.length) return <FlashcardsView cards={cards} />;
  }
  if (kind === "quiz" && Array.isArray(value)) {
    const questions = value.flatMap(entry => entry && typeof entry === "object" && typeof (entry as { question?: unknown }).question === "string" && Array.isArray((entry as { options?: unknown }).options) ? [entry as { question: string; options: string[]; answer: number }] : []);
    if (questions.length) return <QuizView questions={questions} />;
  }
  return <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-xs">{content}</pre>;
}

function FlashcardsView({ cards }: { cards: Array<{ front: string; back: string }> }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (index: number) => setOpen(current => {
    const next = new Set(current);
    if (next.has(index)) next.delete(index); else next.add(index);
    return next;
  });
  return <div className="grid gap-2 sm:grid-cols-2">{cards.map((card, index) => <button
    key={index}
    type="button"
    onClick={() => toggle(index)}
    aria-expanded={open.has(index)}
    className="grid gap-1 rounded-md border p-2 text-left text-xs hover:bg-muted/40"
  >
    <span className="font-medium">{card.front}</span>
    <span className={open.has(index) ? "text-muted-foreground" : "text-muted-foreground blur-[3px] select-none"}>{open.has(index) ? card.back : "Tocá para ver la respuesta"}</span>
  </button>)}</div>;
}

function QuizView({ questions }: { questions: Array<{ question: string; options: string[]; answer: number }> }) {
  const [picked, setPicked] = useState<Record<number, number>>({});
  return <ol className="grid gap-3 text-xs">{questions.map((question, qIndex) => <li key={qIndex} className="grid gap-1 rounded-md border p-2">
    <p className="font-medium">{question.question}</p>
    <div className="grid gap-1">{question.options.map((option, index) => {
      const chosen = picked[qIndex];
      const state = chosen === undefined ? "" : index === question.answer ? " border-emerald-500/60 bg-emerald-500/10" : index === chosen ? " border-destructive/60 bg-destructive/5" : " opacity-70";
      return <button key={index} type="button" className={`rounded border p-1 text-left${state}`} onClick={() => setPicked(current => ({ ...current, [qIndex]: index }))}>{option}</button>;
    })}</div>
    {picked[qIndex] === undefined ? <p className="text-muted-foreground">Elegí una opción.</p>
      : <p role="status" className={picked[qIndex] === question.answer ? "text-emerald-600" : "text-destructive"}>{picked[qIndex] === question.answer ? "Correcto." : `Incorrecto: la respuesta es "${question.options[question.answer] ?? "—"}".`}</p>}
  </li>)}</ol>;
}

function ProposalsSection({ app, client, enabled, onChanged }: { app: SpecialistApplication; client: OpenworkServerClient; enabled: boolean; onChanged(): Promise<void> }) {
  const query = useQuery({ queryKey: ["specialist-proposals", client.baseUrl, app.id], queryFn: () => client.getSpecialistProposals(app.id), retry: false, enabled });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Array<{ piece: string; ok: boolean; detail?: string }> | null>(null);
  async function act(kind: "accept" | "dismiss", proposal: SpecialistProposal) {
    setBusy(true); setError(null); setNotice(null);
    try {
      if (kind === "accept") {
        const result = await client.acceptSpecialistProposal(app.id, proposal.id);
        if (result.applied?.length) setNotice(result.applied);
      } else await client.dismissSpecialistProposal(app.id, proposal.id);
      await query.refetch(); await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo procesar la propuesta."); }
    finally { setBusy(false); }
  }
  const proposals = query.data?.proposals ?? [];
  if (!enabled) return null;
  if (query.isPending) return <section className="grid gap-2"><Skeleton className="h-12 w-full" /></section>;
  if (query.isError) return <section className="grid gap-2"><p role="alert" className="text-sm text-destructive">No se pudieron leer las propuestas. <Button variant="link" onClick={() => void query.refetch()}>Volver a intentar</Button></p></section>;
  // F-1: the per-piece accept result must survive even when the inbox became empty after accepting.
  if (!proposals.length && !notice) return null;
  if (!proposals.length && notice) return <section className="grid gap-2">
    <div role="status" className="grid gap-1 rounded-md border p-2 text-xs">
      <p className="font-medium">Resultado de la propuesta aceptada</p>
      {notice.map((entry, index) => <p key={`${entry.piece}-${index}`} className={entry.ok ? "text-muted-foreground" : "text-destructive"}>
        {entry.ok ? "✓" : "✗"} {entry.piece}{entry.detail ? ` — ${entry.detail}` : ""}
      </p>)}
    </div>
  </section>;
  return <section className="grid gap-2">
    <h3 className="text-sm font-medium">Propuestas pendientes ({proposals.length})</h3>
    <p className="text-xs text-muted-foreground">El asistente te aprendió estos procedimientos y propone guardarlos. Nada existe hasta que lo confirmes acá.</p>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {notice ? <div role="status" className="grid gap-1 rounded-md border p-2 text-xs">
      <p className="font-medium">Resultado de la propuesta aceptada</p>
      {notice.map((entry, index) => <p key={`${entry.piece}-${index}`} className={entry.ok ? "text-muted-foreground" : "text-destructive"}>
        {entry.ok ? "✓" : "✗"} {entry.piece}{entry.detail ? ` — ${entry.detail}` : ""}
      </p>)}
    </div> : null}
    {proposals.map(proposal => <div key={proposal.id} className="grid gap-2 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{PROPOSAL_LABEL[proposal.kind]}</Badge>
        <span className="min-w-0 flex-1 truncate font-medium">{proposal.name}</span>
        <span className="text-xs text-muted-foreground">{formatWhen(proposal.createdAt)}</span>
      </div>
      <p className="text-xs text-muted-foreground">{proposal.description}</p>
      {proposalSummary(proposal) ? <p className="text-xs">{proposalSummary(proposal)}</p> : null}
      {proposal.reason ? <p className="text-xs text-muted-foreground">Motivo: {proposal.reason}</p> : null}
      <div className="flex gap-2"><Button size="sm" disabled={busy} onClick={() => void act("accept", proposal)}>{proposal.kind === "task" || proposal.kind === "plan" ? "Aceptar" : "Guardar"}</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void act("dismiss", proposal)}>Descartar</Button></div>
    </div>)}
  </section>;
}

function TasksSummary({ app, client }: { app: SpecialistApplication; client: OpenworkServerClient }) {
  const query = useQuery({ queryKey: TASKS_KEY(client, app), queryFn: () => client.getSpecialistTasks(app.id), retry: false, refetchInterval: q => (q.state.data?.tasks.some(task => task.running) ? 5_000 : 30_000) });
  if (query.isPending) return <Skeleton className="h-8 w-full" />;
  if (query.isError) return <p role="alert" className="text-xs text-destructive">No se pudieron leer las tareas. <Button variant="link" className="h-auto p-0 text-xs" onClick={() => void query.refetch()}>Volver a intentar</Button></p>;
  const tasks = query.data?.tasks ?? [];
  if (!tasks.length) return <p className="text-xs text-muted-foreground">Sin tareas programadas. El asistente puede crearlas si le pedís que revise algo periódicamente.</p>;
  return <ul className="grid gap-1 text-xs text-muted-foreground">{tasks.slice(0, 4).map(task => <li key={task.id} className="flex items-center gap-2">
    <CalendarClock className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">{task.name}</span>
    <span>{task.enabled ? `Próxima: ${formatWhen(task.nextRunAt)}` : "Pausada"}</span>
  </li>)}</ul>;
}

const RUNS_KEY = (client: OpenworkServerClient, app: SpecialistApplication, taskId: string) => ["specialist-task-runs", client.baseUrl, app.id, taskId] as const;

function TasksView({ app, client, dryRun, onBack }: { app: SpecialistApplication; client: OpenworkServerClient; dryRun: boolean; onBack(): void }) {
  const query = useQuery({ queryKey: TASKS_KEY(client, app), queryFn: () => client.getSpecialistTasks(app.id), retry: false, refetchInterval: q => (q.state.data?.tasks.some(task => task.running) ? 5_000 : 30_000) });
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [runsFor, setRunsFor] = useState<{ id: string; name: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const runs = useQuery({ queryKey: runsFor ? RUNS_KEY(client, app, runsFor.id) : ["specialist-task-runs", client.baseUrl, app.id, "idle"], queryFn: () => runsFor ? client.getSpecialistTaskRuns(app.id, runsFor.id) : Promise.resolve({ runs: [] }), retry: false, enabled: runsFor !== null });
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<SpecialistTaskSchedule["kind"]>("interval");
  const [every, setEvery] = useState("20");
  const [clock, setClock] = useState("09:00");
  const [days, setDays] = useState<number[]>([1]);
  const [once, setOnce] = useState("");
  const [modelChoice, setModelChoice] = useState("__default__");
  // The catalog comes from the engine; only needed while the form is open.
  const models = useQuery({
    queryKey: ["specialist-engine-models", client.baseUrl, app.workspaceIds[0] ?? ""],
    queryFn: async () => {
      const raw = await client.listEngineModels(app.workspaceIds[0]!);
      const list = Array.isArray(raw) ? raw : raw.data ?? [];
      return list.flatMap(entry => {
        const providerID = typeof entry.providerID === "string" ? entry.providerID : "";
        const modelID = typeof entry.id === "string" ? entry.id : typeof entry.modelID === "string" ? entry.modelID : "";
        return providerID && modelID ? [{ key: `${providerID}/${modelID}`, providerID, modelID, name: typeof entry.name === "string" ? entry.name : modelID }] : [];
      });
    },
    enabled: creating && Boolean(app.workspaceIds[0]),
    retry: false,
    staleTime: 60_000,
  });
  async function run(action: () => Promise<unknown>, message?: string) {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try { await action(); await query.refetch(); await queryClient.invalidateQueries({ queryKey: ["specialist-task-runs", client.baseUrl, app.id] }); if (message) setNotice(message); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo completar la acción."); }
    finally { setBusy(false); }
  }
  async function create() {
    const hour = Number(clock.slice(0, 2)); const minute = Number(clock.slice(3, 5));
    const minutes = Number(every);
    let schedule: SpecialistTaskSchedule;
    if (kind === "interval") schedule = { kind, everyMinutes: minutes };
    else if (kind === "daily") schedule = { kind, hour, minute };
    else if (kind === "weekly") schedule = { kind, daysOfWeek: [...days].sort(), hour, minute };
    else schedule = { kind, at: once ? new Date(once).getTime() : 0 };
    const [providerID, modelID] = modelChoice.split("/");
    const model = modelChoice !== "__default__" && providerID && modelID ? { providerID, modelID } : null;
    await run(async () => {
      await client.createSpecialistTask(app.id, { name: name.trim(), prompt: prompt.trim(), schedule, ...(model ? { model } : {}) });
      setName(""); setPrompt(""); setModelChoice("__default__"); setCreating(false);
    }, model ? `Tarea creada y activada con ${model.providerID}/${model.modelID}.` : "Tarea creada y activada.");
  }
  const minutesValue = Number(every);
  const scheduleProblem = kind === "interval" && (!Number.isInteger(minutesValue) || minutesValue < 1 || minutesValue > 43_200)
    ? "Indicá cada cuántos minutos: un entero entre 1 y 43200."
    : kind === "weekly" && !days.length ? "Elegí al menos un día de la semana." : null;
  // F4 live estimate (mirrors the server's estimateTaskBudget): time/space cost in local terms.
  const budgetEstimate = (() => {
    if (!prompt.trim() || scheduleProblem) return null;
    const runsPerDay = kind === "interval" && Number.isInteger(minutesValue) && minutesValue >= 1 ? 1440 / minutesValue : kind === "daily" ? 1 : kind === "weekly" ? 1 / 7 : 0;
    if (kind === "once") return "Una sola corrida: sin costo recurrente.";
    const tokens = Math.round(((prompt.length / 4) * 8) * runsPerDay / 1000);
    const mb = Math.round(((prompt.length * 2) * runsPerDay / 1_000_000) * 10) / 10;
    return `≈ ${Math.round(runsPerDay * 10) / 10} corridas/día · ≈ ${tokens}k tokens/día · ≈ ${mb} MB/día de snapshots en el proyecto.`;
  })();
  if (query.isPending) return <div className="grid gap-3"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>;
  if (query.isError) return <><Button variant="ghost" size="sm" className="justify-self-start" onClick={onBack}><ArrowLeft className="size-4" />Volver</Button><p role="alert" className="text-sm text-destructive">No se pudieron leer las tareas. <Button variant="link" onClick={() => void query.refetch()}>Volver a intentar</Button></p></>;
  const tasks = query.data?.tasks ?? [];
  return <div className="grid gap-3">
    <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={onBack}><ArrowLeft className="size-4" />Volver</Button>
    <div className="flex items-center justify-between gap-2">
      <h3 className="font-medium">Tareas programadas de {app.name}</h3>
      {!creating ? <Button size="sm" variant="outline" onClick={() => setCreating(true)}><Plus className="size-4" />Nueva tarea</Button> : null}
    </div>
    <p className="text-xs text-muted-foreground">Cada corrida abre un chat propio en el proyecto de la aplicación con el prompt guardado. Si la PC estuvo apagada, la próxima corrida corre ya (las perdidas se consolidan en una).</p>
    {creating ? <form className="grid gap-2 rounded-md border p-3" onSubmit={event => { event.preventDefault(); void create(); }}>
      <div className="grid gap-1.5"><Label htmlFor="task-name">Nombre</Label><Input id="task-name" autoFocus value={name} onChange={event => setName(event.target.value)} maxLength={120} placeholder="por ejemplo: actualizar precios" required /></div>
      <div className="grid gap-1.5"><Label htmlFor="task-prompt">Qué debe hacer el agente en cada corrida</Label><Textarea id="task-prompt" rows={3} value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={8000} required placeholder="Consultá las fuentes de costo de flete y actualizá la planilla del proyecto." /></div>
      <div className="flex flex-wrap gap-1">{(["interval", "daily", "weekly", "once"] as const).map(option => <Button key={option} type="button" size="sm" variant={kind === option ? "default" : "outline"} onClick={() => setKind(option)}>{option === "interval" ? "Cada X tiempo" : option === "daily" ? "Diaria" : option === "weekly" ? "Semanal" : "Una vez"}</Button>)}</div>
      {kind === "interval" ? <div className="grid gap-1.5"><Label htmlFor="task-every">Cada cuántos minutos</Label><Input id="task-every" type="number" min={1} max={43200} value={every} onChange={event => setEvery(event.target.value)} className="max-w-40" /></div> : null}
      {kind !== "interval" && kind !== "once" ? <div className="grid gap-1.5"><Label htmlFor="task-clock">Hora</Label><Input id="task-clock" type="time" value={clock} onChange={event => setClock(event.target.value)} className="max-w-40" /></div> : null}
      {kind === "weekly" ? <div className="flex flex-wrap gap-1">{DAY_LABELS.map((label, day) => <Button key={label} type="button" size="sm" variant={days.includes(day) ? "default" : "outline"} onClick={() => setDays(current => current.includes(day) ? current.filter(entry => entry !== day) : [...current, day])}>{label}</Button>)}</div> : null}
      {kind === "once" ? <div className="grid gap-1.5"><Label htmlFor="task-once">Fecha y hora</Label><Input id="task-once" type="datetime-local" value={once} onChange={event => setOnce(event.target.value)} required /></div> : null}
      <div className="grid gap-1.5">
        <Label>Modelo de cada corrida</Label>
        <Select
          value={modelChoice}
          // The trigger resolves its label from `items`; without it the raw value showed.
          items={[{ value: "__default__", label: "Modelo predeterminado del motor" }, ...(models.data ?? []).map(entry => ({ value: entry.key, label: `${entry.name} · ${entry.providerID}` }))]}
          onValueChange={value => setModelChoice(value ?? "__default__")}
        >
          <SelectTrigger className="max-w-full"><SelectValue placeholder="Modelo predeterminado del motor" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__default__">Modelo predeterminado del motor</SelectItem>
            {(models.data ?? []).map(entry => <SelectItem key={entry.key} value={entry.key}>{entry.name} · {entry.providerID}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{models.isError ? "No se pudo leer el catálogo de modelos; se usará el predeterminado del motor." : "Se usa en cada corrida. Elegí uno barato si la tarea corre seguido."}</p>
      </div>
      <div className="flex gap-2"><Button type="submit" disabled={busy || !name.trim() || !prompt.trim() || (kind === "once" && !once) || scheduleProblem !== null}>{busy ? "Creando…" : "Crear tarea"}</Button><Button type="button" variant="ghost" onClick={() => setCreating(false)}>Cancelar</Button></div>
      {scheduleProblem ? <p role="alert" className="text-xs text-destructive">{scheduleProblem}</p> : null}
      {budgetEstimate ? <p role="status" className="text-xs text-muted-foreground">Costo estimado: {budgetEstimate}</p> : null}
    </form> : null}
    {notice ? <p role="status" className="text-sm">{notice}</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {pendingDelete ? <div role="alertdialog" aria-label={`Confirmar eliminación de la tarea ${pendingDelete.name}`} className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
      <span className="min-w-0 flex-1">¿Eliminar la tarea "{pendingDelete.name}"? Se quita también su historial de corridas.</span>
      <Button size="sm" variant="destructive" disabled={busy} onClick={() => { const target = pendingDelete; setPendingDelete(null); setRunsFor(current => current?.id === target.id ? null : current); void run(() => client.deleteSpecialistTask(app.id, target.id)); }}>Eliminar</Button>
      <Button size="sm" variant="ghost" onClick={() => setPendingDelete(null)}>Cancelar</Button>
    </div> : null}
    {tasks.length ? tasks.map(task => <div key={task.id} className="grid gap-2 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarClock className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">{task.name}</span>
        {task.running ? <Badge variant="secondary">Corriendo…</Badge> : !task.enabled ? <Badge variant="outline">Pausada</Badge> : task.lastStatus ? <Badge variant={task.lastStatus === "ok" ? "outline" : "destructive"}>{task.lastStatus === "ok" ? "Última: ok" : task.lastStatus === "failed" ? "Última: falló" : task.lastStatus === "blocked" ? "Última: bloqueada" : "Última: corriendo"}</Badge> : null}
      </div>
      <p className="text-xs text-muted-foreground">{describeSchedule(task.schedule)} · próxima {task.enabled ? formatWhen(task.nextRunAt) : "—"} · {task.runs} corrida{task.runs === 1 ? "" : "s"}{task.running?.missed ? ` · ${task.running.missed} perdidas consolidadas` : ""} · {task.model ? `${task.model.providerID}/${task.model.modelID}` : "modelo predeterminado"}</p>
      <p className="line-clamp-2 text-xs text-muted-foreground">{task.prompt}</p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={busy || !!task.running} onClick={() => void run(async () => { const result = await client.runSpecialistTaskNow(app.id, task.id); if (!result.started) throw new Error(result.detail ?? "No se pudo iniciar."); }, "Corrida iniciada: mirá el chat nuevo de la tarea.")}><Play className="size-4" />Correr ahora</Button>
        {dryRun ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(async () => { const result = await client.dryRunSpecialistTask(app.id, task.id); if (!result.started) throw new Error(result.detail ?? "No se pudo lanzar el ensayo."); }, "Ensayo lanzado: corre en una sesión aparte y no guarda nada. Mirá el chat nuevo.")}><ScanSearch className="size-4" />Ensayar</Button> : null}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => client.updateSpecialistTask(app.id, task.id, { enabled: !task.enabled }))}>{task.enabled ? <><Pause className="size-4" />Pausar</> : <><Play className="size-4" />Reanudar</>}</Button>
        <Button size="sm" variant="ghost" aria-expanded={runsFor?.id === task.id} onClick={() => setRunsFor(runsFor?.id === task.id ? null : { id: task.id, name: task.name })}><History className="size-4" />Corridas</Button>
        <Button size="sm" variant="ghost" disabled={busy || !!task.running} aria-label={`Eliminar ${task.name}`} onClick={() => setPendingDelete({ id: task.id, name: task.name })}><Trash2 className="size-4" /></Button>
      </div>
      {runsFor?.id === task.id ? <div className="grid gap-1 border-t pt-2 text-xs text-muted-foreground">
        {runs.isError ? <span role="alert" className="text-destructive">No se pudo leer el historial. <Button variant="link" className="h-auto p-0 text-xs" onClick={() => void runs.refetch()}>Volver a intentar</Button></span>
          : runs.isPending ? <span>…</span>
          : (runs.data?.runs.length ?? 0) ? (runs.data?.runs ?? []).map(entry => <div key={`${entry.at}-${entry.status}`} className="flex items-center gap-2">
            <span>{formatWhen(entry.at)}</span>
            <Badge variant={entry.status === "ok" ? "outline" : entry.status === "dispatched" ? "secondary" : "destructive"}>{entry.status === "ok" ? "ok" : entry.status === "dispatched" ? "corriendo" : entry.status === "failed" ? "falló" : entry.status === "blocked" ? "bloqueada" : "solapada"}</Badge>
            <span>{entry.mode === "manual" ? "a pedido" : "programada"}{entry.missed ? ` · ${entry.missed} perdidas` : ""}</span>
            {entry.detail ? <span className="truncate">{entry.detail}</span> : null}
          </div>) : <span>Sin corridas todavía.</span>}
      </div> : null}
    </div>) : <p className="text-xs text-muted-foreground">Todavía no hay tareas.</p>}
  </div>;
}

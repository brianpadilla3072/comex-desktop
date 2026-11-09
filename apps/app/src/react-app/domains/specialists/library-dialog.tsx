/** @jsxImportSource react */
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, BookText, Bot, CalendarClock, FileText, Pause, Play, Plus, Trash2, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import type { OpenworkServerClient, SpecialistApplication, SpecialistLibrary, SpecialistLibraryEntry, SpecialistProposal, SpecialistSyncResult, SpecialistTask, SpecialistTaskSchedule } from "@/app/lib/openwork-server";

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
  | { kind: "tasks" };

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

export function SpecialistLibraryDialog({ app, client, scheduled, onClose, onChanged }: { app: SpecialistApplication; client: OpenworkServerClient; scheduled: boolean; onClose(): void; onChanged(): Promise<unknown> }) {
  const [view, setView] = useState<View>({ kind: "home" });
  const query = useQuery({ queryKey: ["specialist-library", client.baseUrl, app.id], queryFn: () => client.getSpecialistLibrary(app.id), retry: false });
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[90dvh] gap-4 overflow-y-auto lg:max-w-2xl">
      <DialogHeader><DialogTitle>Contexto, agentes y skills de {app.name}</DialogTitle></DialogHeader>
      {view.kind === "home" ? <Home app={app} client={client} query={query} scheduled={scheduled} onOpen={setView} onChanged={async () => { await query.refetch(); await onChanged(); }} /> : null}
      {view.kind === "context" ? <ContextEditor app={app} client={client} onBack={() => setView({ kind: "home" })} onChanged={async () => { await query.refetch(); await onChanged(); }} /> : null}
      {view.kind === "file" ? <FileEditor key={view.path} app={app} client={client} path={view.path} name={view.name} onBack={() => setView({ kind: "home" })} onChanged={async () => { await query.refetch(); await onChanged(); }} /> : null}
      {view.kind === "new" ? <NewItem app={app} client={client} type={view.type} onBack={() => setView({ kind: "home" })} onChanged={async () => { await query.refetch(); await onChanged(); }} /> : null}
      {view.kind === "tasks" ? <TasksView key="tasks" app={app} client={client} onBack={() => setView({ kind: "home" })} /> : null}
    </DialogContent>
  </Dialog>;
}

function Home({ app, client, query, scheduled, onOpen, onChanged }: {
  app: SpecialistApplication; client: OpenworkServerClient;
  query: ReturnType<typeof useQuery<SpecialistLibrary | null, Error>>;
  scheduled: boolean;
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
  if (query.isPending) return <div className="grid gap-3"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>;
  if (query.isError) return <p role="alert" className="text-sm text-destructive">No se pudo leer la biblioteca. <Button variant="link" onClick={() => void query.refetch()}>Volver a intentar</Button></p>;
  const library = query.data;
  if (!library) return null;
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
    <ProposalsSection app={app} client={client} onChanged={onChanged} />
    {scheduled ? <section className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Tareas programadas</h3>
        <Button variant="ghost" size="sm" onClick={() => onOpen({ kind: "tasks" })}><CalendarClock className="size-4" />Gestionar</Button>
      </div>
      <TasksSummary app={app} client={client} />
    </section> : null}
    <section className="grid gap-2">
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
    </section>
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
  return <form className="grid gap-3" onSubmit={event => { event.preventDefault(); void save(); }}>
    <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={onBack}><ArrowLeft className="size-4" />Volver</Button>
    <Label htmlFor="specialist-context">Contexto de la aplicación</Label>
    <p className="text-xs text-muted-foreground">Lo que esta aplicación siempre debe saber y respetar: tus convenciones, formato de entrega, criterios. Se agrega a cada conversación de todos sus proyectos.</p>
    <Textarea id="specialist-context" rows={12} spellCheck={false} value={value} onChange={event => setContent(event.target.value)} maxLength={8000} placeholder="Por ejemplo: Entregá siempre los informes en Word y las planillas en Excel. Usá unidades métricas. Confirmá antes de enviar algo a un cliente." />
    <p className="text-xs text-muted-foreground">{value.length} / 8000 caracteres. Vaciarlo y guardar lo elimina.</p>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <div className="flex gap-2"><Button type="submit" disabled={busy || query.isError}>{busy ? "Guardando…" : "Guardar contexto"}</Button><Button type="button" variant="ghost" onClick={onBack}>Cancelar</Button></div>
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

function ProposalsSection({ app, client, onChanged }: { app: SpecialistApplication; client: OpenworkServerClient; onChanged(): Promise<void> }) {
  const query = useQuery({ queryKey: ["specialist-proposals", client.baseUrl, app.id], queryFn: () => client.getSpecialistProposals(app.id), retry: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(kind: "accept" | "dismiss", proposal: SpecialistProposal) {
    setBusy(true); setError(null);
    try {
      if (kind === "accept") await client.acceptSpecialistProposal(app.id, proposal.id);
      else await client.dismissSpecialistProposal(app.id, proposal.id);
      await query.refetch(); await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo procesar la propuesta."); }
    finally { setBusy(false); }
  }
  const proposals = query.data?.proposals ?? [];
  if (!query.isSuccess || !proposals.length) return null;
  return <section className="grid gap-2">
    <h3 className="text-sm font-medium">Propuestas pendientes ({proposals.length})</h3>
    <p className="text-xs text-muted-foreground">El asistente te aprendió estos procedimientos y propone guardarlos. Nada existe hasta que lo confirmes acá.</p>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {proposals.map(proposal => <div key={proposal.id} className="grid gap-2 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{proposal.kind === "skill" ? "Skill" : proposal.kind === "agent" ? "Agente" : "Contexto"}</Badge>
        <span className="min-w-0 flex-1 truncate font-medium">{proposal.name}</span>
        <span className="text-xs text-muted-foreground">{formatWhen(proposal.createdAt)}</span>
      </div>
      <p className="text-xs text-muted-foreground">{proposal.description}</p>
      {proposal.reason ? <p className="text-xs text-muted-foreground">Motivo: {proposal.reason}</p> : null}
      <div className="flex gap-2"><Button size="sm" disabled={busy} onClick={() => void act("accept", proposal)}>Guardar</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void act("dismiss", proposal)}>Descartar</Button></div>
    </div>)}
  </section>;
}

function TasksSummary({ app, client }: { app: SpecialistApplication; client: OpenworkServerClient }) {
  const query = useQuery({ queryKey: ["specialist-tasks-summary", client.baseUrl, app.id], queryFn: () => client.getSpecialistTasks(app.id), retry: false });
  if (query.isPending) return <Skeleton className="h-8 w-full" />;
  const tasks = query.data?.tasks ?? [];
  if (!tasks.length) return <p className="text-xs text-muted-foreground">Sin tareas programadas. El asistente puede crearlas si le pedís que revise algo periódicamente.</p>;
  return <ul className="grid gap-1 text-xs text-muted-foreground">{tasks.slice(0, 4).map(task => <li key={task.id} className="flex items-center gap-2">
    <CalendarClock className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">{task.name}</span>
    <span>{task.enabled ? `Próxima: ${formatWhen(task.nextRunAt)}` : "Pausada"}</span>
  </li>)}</ul>;
}

function TasksView({ app, client, onBack }: { app: SpecialistApplication; client: OpenworkServerClient; onBack(): void }) {
  const query = useQuery({ queryKey: ["specialist-tasks", client.baseUrl, app.id], queryFn: () => client.getSpecialistTasks(app.id), retry: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<SpecialistTaskSchedule["kind"]>("interval");
  const [every, setEvery] = useState("20");
  const [clock, setClock] = useState("09:00");
  const [days, setDays] = useState<number[]>([1]);
  const [once, setOnce] = useState("");
  async function run(action: () => Promise<unknown>, message?: string) {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try { await action(); await query.refetch(); if (message) setNotice(message); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo completar la acción."); }
    finally { setBusy(false); }
  }
  async function create() {
    const hour = Number(clock.slice(0, 2)); const minute = Number(clock.slice(3, 5));
    let schedule: SpecialistTaskSchedule;
    if (kind === "interval") schedule = { kind, everyMinutes: Number(every) };
    else if (kind === "daily") schedule = { kind, hour, minute };
    else if (kind === "weekly") schedule = { kind, daysOfWeek: days.length ? days : [1], hour, minute };
    else schedule = { kind, at: once ? new Date(once).getTime() : 0 };
    await run(async () => {
      await client.createSpecialistTask(app.id, { name: name.trim(), prompt: prompt.trim(), schedule });
      setName(""); setPrompt(""); setCreating(false);
    }, "Tarea creada y activada.");
  }
  if (query.isPending) return <div className="grid gap-3"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>;
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
      <div className="flex gap-2"><Button type="submit" disabled={busy || !name.trim() || !prompt.trim()}>{busy ? "Creando…" : "Crear tarea"}</Button><Button type="button" variant="ghost" onClick={() => setCreating(false)}>Cancelar</Button></div>
    </form> : null}
    {notice ? <p role="status" className="text-sm">{notice}</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {tasks.length ? tasks.map(task => <div key={task.id} className="grid gap-2 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarClock className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">{task.name}</span>
        {task.running ? <Badge variant="secondary">Corriendo…</Badge> : !task.enabled ? <Badge variant="outline">Pausada</Badge> : task.lastStatus ? <Badge variant={task.lastStatus === "ok" ? "outline" : "destructive"}>{task.lastStatus === "ok" ? "Última: ok" : task.lastStatus === "failed" ? "Última: falló" : task.lastStatus === "blocked" ? "Última: bloqueada" : "Última: corriendo"}</Badge> : null}
      </div>
      <p className="text-xs text-muted-foreground">{describeSchedule(task.schedule)} · próxima {task.enabled ? formatWhen(task.nextRunAt) : "—"} · {task.runs} corrida{task.runs === 1 ? "" : "s"}{task.running?.missed ? ` · ${task.running.missed} perdidas consolidadas` : ""}</p>
      <p className="line-clamp-2 text-xs text-muted-foreground">{task.prompt}</p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={busy || !!task.running} onClick={() => void run(async () => { const result = await client.runSpecialistTaskNow(app.id, task.id); if (!result.started) throw new Error(result.detail ?? "No se pudo iniciar."); }, "Corrida iniciada: mirá el chat nuevo de la tarea.")}><Play className="size-4" />Correr ahora</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => client.updateSpecialistTask(app.id, task.id, { enabled: !task.enabled }))}>{task.enabled ? <><Pause className="size-4" />Pausar</> : <><Play className="size-4" />Reanudar</>}</Button>
        <Button size="sm" variant="ghost" disabled={busy || !!task.running} aria-label={`Eliminar ${task.name}`} onClick={() => void run(() => client.deleteSpecialistTask(app.id, task.id))}><Trash2 className="size-4" /></Button>
      </div>
    </div>) : <p className="text-xs text-muted-foreground">Todavía no hay tareas.</p>}
  </div>;
}

/** @jsxImportSource react */
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, BookText, Bot, FileText, Plus, Trash2, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import type { OpenworkServerClient, SpecialistApplication, SpecialistLibrary, SpecialistLibraryEntry, SpecialistSyncResult } from "@/app/lib/openwork-server";

const ORIGIN_LABEL: Record<SpecialistLibraryEntry["origin"], string> = { official: "Del pack", "official-modified": "Del pack, editado", custom: "Propio" };

type View =
  | { kind: "home" }
  | { kind: "context" }
  | { kind: "file"; path: string; name: string }
  | { kind: "new"; type: "agent" | "skill" };

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

export function SpecialistLibraryDialog({ app, client, onClose, onChanged }: { app: SpecialistApplication; client: OpenworkServerClient; onClose(): void; onChanged(): Promise<unknown> }) {
  const [view, setView] = useState<View>({ kind: "home" });
  const query = useQuery({ queryKey: ["specialist-library", client.baseUrl, app.id], queryFn: () => client.getSpecialistLibrary(app.id), retry: false });
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[90dvh] gap-4 overflow-y-auto lg:max-w-2xl">
      <DialogHeader><DialogTitle>Contexto, agentes y skills de {app.name}</DialogTitle></DialogHeader>
      {view.kind === "home" ? <Home app={app} client={client} query={query} onOpen={setView} onChanged={async () => { await query.refetch(); await onChanged(); }} /> : null}
      {view.kind === "context" ? <ContextEditor app={app} client={client} onBack={() => setView({ kind: "home" })} onChanged={async () => { await query.refetch(); await onChanged(); }} /> : null}
      {view.kind === "file" ? <FileEditor key={view.path} app={app} client={client} path={view.path} name={view.name} onBack={() => setView({ kind: "home" })} onChanged={async () => { await query.refetch(); await onChanged(); }} /> : null}
      {view.kind === "new" ? <NewItem app={app} client={client} type={view.type} onBack={() => setView({ kind: "home" })} onChanged={async () => { await query.refetch(); await onChanged(); }} /> : null}
    </DialogContent>
  </Dialog>;
}

function Home({ app, client, query, onOpen, onChanged }: {
  app: SpecialistApplication; client: OpenworkServerClient;
  query: ReturnType<typeof useQuery<SpecialistLibrary | null, Error>>;
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

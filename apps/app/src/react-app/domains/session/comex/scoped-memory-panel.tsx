import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { memoryScopeSchema, memoryScopeLabels, type MemoryScope, type MemoryNote, type MemorySnapshot } from "@openwork/types/scoped-memory";
import { OpenworkServerError, type OpenworkServerClient } from "@/app/lib/openwork-server";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";

export function ScopedMemoryPanel(props: { client: OpenworkServerClient; workspaceId: string; sessionId: string }) {
  const [scope, setScope] = useState<MemoryScope>("conversation");
  return <div className="space-y-3" data-testid="scoped-memory-panel"><Tabs value={scope} onValueChange={value => { const parsed = memoryScopeSchema.safeParse(value); if (parsed.success) setScope(parsed.data); }}><TabsList aria-label="Nivel de memoria" className="w-full">{memoryScopeSchema.options.map(level => <TabsTrigger key={level} value={level}>{memoryScopeLabels[level]}</TabsTrigger>)}</TabsList></Tabs><ScopedMemoryEditor key={`${props.client.baseUrl}:${props.workspaceId}:${props.sessionId}:${scope}`} {...props} scope={scope} /></div>;
}
function ScopedMemoryEditor({ client, workspaceId, sessionId, scope }: { client: OpenworkServerClient; workspaceId: string; sessionId: string; scope: MemoryScope }) {
  const cache = useQueryClient();
  const key = ["scoped-memory", client.baseUrl, workspaceId, sessionId, scope];
  const query = useQuery({ queryKey: key, queryFn: () => client.getScopedMemory(workspaceId, sessionId, scope), refetchInterval: 15_000, retry: false });
  const [editor, setEditor] = useState(false); const [editing, setEditing] = useState<MemoryNote | null>(null);
  const [text, setText] = useState(""); const [revision, setRevision] = useState(0);
  const [removing, setRemoving] = useState<MemoryNote | null>(null);
  const [error, setError] = useState(""); const [status, setStatus] = useState("");
  const mutation = useMutation({ mutationFn: (job: () => Promise<MemorySnapshot>) => job(), onSuccess: value => { cache.setQueryData(key, value); setEditor(false); setRemoving(null); setError(""); setStatus(`Memoria de ${memoryScopeLabels[scope].toLocaleLowerCase()} actualizada.`); }, onError: (e: Error) => { setError(e instanceof OpenworkServerError && e.status === 409 ? "La memoria cambió. Copiá tu borrador antes de cancelar y volver a abrir la nota para revisar la versión actual." : e.message); void query.refetch(); } });
  const readOnly = query.data?.writable === false;
  const edit = (note: MemoryNote | null) => { setEditing(note); setText(note?.text ?? ""); setRevision(query.data?.revision ?? 0); setError(""); setEditor(true); };
  return <div className="space-y-3">
    <p className="text-xs text-muted-foreground">{scope === "conversation" ? "Solo este chat." : scope === "project" ? "Todos los chats de este proyecto." : "Todos tus proyectos en esta instalación y conexión."}</p>
    {query.isLoading ? <Skeleton className="h-20 w-full" aria-label="Leyendo memoria" /> : query.isError ? <div role="alert"><p className="text-xs text-muted-foreground">No se pudo leer la memoria.</p><Button variant="ghost" size="sm" onClick={() => void query.refetch()}>Volver a intentar</Button></div> : <>
      {query.data?.notes.length ? <div className="divide-y divide-border">{query.data.notes.map(note => <div key={note.id} className="flex min-h-10 items-start gap-2 py-2"><p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs leading-6">{note.text}</p><DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Opciones de nota: ${note.text.slice(0, 50)}`} />}><MoreHorizontal className="size-4" /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={readOnly} onClick={() => edit(note)}>Editar nota</DropdownMenuItem><DropdownMenuItem disabled={readOnly} onClick={() => { setError(""); setRevision(query.data?.revision ?? 0); setRemoving(note); }}>Eliminar nota</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>)}</div> : <p className="text-xs text-muted-foreground">Sin notas guardadas.</p>}
      <Button size="sm" variant="outline" disabled={readOnly} onClick={() => edit(null)}>Agregar recuerdo</Button>
      <p className="text-xs text-muted-foreground">{`En el chat: “recordá${scope === "conversation" ? "" : ` en ${memoryScopeLabels[scope].toLocaleLowerCase()}`}: …”.`}</p>
    </>}
    {readOnly && <p className="text-xs text-muted-foreground">Solo lectura. Quien administra esta conexión puede habilitar la escritura.</p>}
    {status && <p role="status" className="text-xs text-muted-foreground">{status}</p>}
    <Dialog open={editor} onOpenChange={value => { if (!mutation.isPending) setEditor(value); }}><DialogContent aria-describedby={undefined} className="sm:max-w-lg"><DialogHeader><DialogTitle>{editing ? "Editar recuerdo" : "Agregar recuerdo"} · {memoryScopeLabels[scope]}</DialogTitle></DialogHeader><Textarea aria-label="Texto del recuerdo" maxLength={800} value={text} onChange={event => setText(event.target.value)} className="min-h-32" />{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter><Button variant="ghost" disabled={mutation.isPending} onClick={() => setEditor(false)}>Cancelar</Button><Button disabled={readOnly || !text.trim() || mutation.isPending} onClick={() => mutation.mutate(() => client.saveScopedMemory(workspaceId, sessionId, scope, revision, text.trim(), editing?.id))}>Guardar recuerdo</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(removing)} onOpenChange={value => { if (!value && !mutation.isPending) setRemoving(null); }}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Eliminar recuerdo</DialogTitle><DialogDescription>Se quitará de la memoria de {memoryScopeLabels[scope].toLocaleLowerCase()}. El historial del chat se conserva.</DialogDescription></DialogHeader><p className="whitespace-pre-wrap break-words text-sm">{removing?.text}</p>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter><Button variant="ghost" disabled={mutation.isPending} onClick={() => setRemoving(null)}>Cancelar</Button><Button variant="destructive" disabled={mutation.isPending} onClick={() => { if (removing) mutation.mutate(() => client.deleteScopedMemory(workspaceId, sessionId, scope, revision, removing.id)); }}>Eliminar recuerdo</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

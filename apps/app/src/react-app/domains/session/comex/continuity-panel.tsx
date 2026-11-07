/** @jsxImportSource react */
import { useEffect, useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, X } from "lucide-react";
import { z } from "zod";
import { OpenworkServerError, type OpenworkServerClient } from "@/app/lib/openwork-server";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { readMemoryDraft, writeMemoryDraft } from "./memory-draft";

type Props = { client: OpenworkServerClient; workspaceId: string; sessionId: string };
type ReadResult = Awaited<ReturnType<OpenworkServerClient["getComexCheckpoint"]>>;
type InputCheckpoint = { objective: string; decisions: string[]; progress: string[]; pending: string[]; artifacts: { path: string; evidence: string }[] };
type Draft = { objective: string; decisions: string; progress: string; pending: string; artifacts: { path: string; evidence: string }[] };
const empty: Draft = { objective: "", decisions: "", progress: "", pending: "", artifacts: [] };
const draftSchema = z.strictObject({ objective: z.string().max(1600), decisions: z.string().max(12816), progress: z.string().max(12816), pending: z.string().max(12816), artifacts: z.array(z.strictObject({ path: z.string().max(800), evidence: z.string().max(800) })).max(16) });
function recoverDraft(key: string): { draft: Draft; revision: number } | null {
  const saved = readMemoryDraft(key);
  if (!saved || saved.baseUpdatedAt === null || !Number.isSafeInteger(saved.baseUpdatedAt) || saved.baseUpdatedAt < 0 || saved.text.length > 64 * 1024) return null;
  try {
    const parsed = draftSchema.safeParse(JSON.parse(saved.text));
    return parsed.success ? { draft: parsed.data, revision: saved.baseUpdatedAt } : null;
  } catch { return null; }
}
function toDraft(result: ReadResult): Draft {
  return result.checkpoint ? { objective: result.checkpoint.objective, decisions: result.checkpoint.decisions.join("\n"), progress: result.checkpoint.progress.join("\n"), pending: result.checkpoint.pending.join("\n"), artifacts: result.checkpoint.artifacts.map(item => ({ ...item })) } : empty;
}

export function ComexContinuityPanel(props: Props) {
  return <ContinuityEditor key={`${props.client.baseUrl}:${props.workspaceId}:${props.sessionId}`} {...props} />;
}

function ContinuityEditor({ client, workspaceId, sessionId }: Props) {
  const id = useId();
  const cache = useQueryClient();
  const key = ["comex-continuity", client.baseUrl, workspaceId, sessionId];
  const draftKey = `comex-continuity-draft:${client.baseUrl}:${workspaceId}:${sessionId}`;
  const [cached] = useState(() => recoverDraft(draftKey));
  const [open, setOpen] = useState(false);
  const query = useQuery({ queryKey: key, queryFn: () => client.getComexCheckpoint(workspaceId, sessionId), enabled: open, retry: false, refetchOnWindowFocus: false });
  const [draft, setDraft] = useState<Draft>(cached?.draft ?? empty);
  const [revision, setRevision] = useState<number | null>(cached?.revision ?? null);
  const [dirty, setDirty] = useState(Boolean(cached));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState<ReadResult | null>(null);
  const [recovery, setRecovery] = useState<Draft | null>(null);
  useEffect(() => {
    if (query.data && !dirty) { setDraft(toDraft(query.data)); setRevision(query.data.revision); }
  }, [query.data, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty]);
  function persist(value: Draft, base: number | null) { return writeMemoryDraft(draftKey, { text: JSON.stringify(value), baseUpdatedAt: base }); }
  function update(value: Partial<Draft>) {
    const next = { ...draft, ...value };
    setDraft(next); setDirty(true);
    setMessage(persist(next, revision) ? "" : "No pude conservar el borrador local. Guardá el resumen antes de cerrar.");
  }
  async function save() {
    if (revision === null || saving || conflict || query.data?.status === "invalid") return;
    const lines = (text: string) => text.split("\n").map(item => item.trim()).filter(Boolean);
    const checkpoint: InputCheckpoint = { objective: draft.objective.trim(), decisions: lines(draft.decisions), progress: lines(draft.progress), pending: lines(draft.pending), artifacts: draft.artifacts.map(item => ({ path: item.path.trim(), evidence: item.evidence.trim() })) };
    if ([checkpoint.decisions, checkpoint.progress, checkpoint.pending].some(items => items.length > 16 || items.some(item => item.length > 800)) || checkpoint.artifacts.some(item => !item.path || !item.evidence || item.path.length > 800 || item.evidence.length > 800)) {
      setMessage("Usá hasta 16 notas por campo y 800 caracteres por nota. Cada archivo necesita una ruta y su evidencia."); return;
    }
    setSaving(true); setMessage("");
    try {
      const result = await client.putComexCheckpoint(workspaceId, sessionId, { expectedRevision: revision, checkpoint });
      cache.setQueryData(key, result); setDraft(toDraft(result)); setRevision(result.revision); writeMemoryDraft(draftKey, null); setDirty(false); setMessage("Resumen guardado. Disponible en el próximo mensaje.");
    } catch (error) {
      if (error instanceof OpenworkServerError && error.status === 409) {
        try { setConflict(await client.getComexCheckpoint(workspaceId, sessionId)); setMessage("El resumen cambió o hay otro guardado en curso. Revisá la versión actual antes de guardar."); }
        catch { setMessage("No pude verificar el resumen actual. Conservás el borrador; volvé a guardar cuando se restablezca la conexión."); }
      } else setMessage("No pude guardar el resumen. Conservás el borrador; revisá la conexión y volvé a intentar.");
    } finally { setSaving(false); }
  }
  const labels = [{ field: "objective", label: "Objetivo", maxLength: 1600 }, { field: "decisions", label: "Decisiones confirmadas", maxLength: 12816 }, { field: "progress", label: "Avances y evidencia", maxLength: 12816 }, { field: "pending", label: "Próximos pasos", maxLength: 12816 }] satisfies { field: "objective" | "decisions" | "progress" | "pending"; label: string; maxLength: number }[];
  return <Collapsible open={open} onOpenChange={setOpen} className="border-t border-border pt-3" data-testid="comex-continuity-panel">
    <CollapsibleTrigger className="group flex min-h-10 w-full items-center gap-2 text-left text-sm font-medium"><ChevronRight className="size-4 transition-transform group-aria-expanded:rotate-90" />Continuidad de esta conversación</CollapsibleTrigger>
    <CollapsibleContent keepMounted className="space-y-3 pt-3">
      {query.isLoading ? <Skeleton role="status" aria-label="Leyendo resumen guardado" className="h-48 w-full" /> : query.isError ? <div role="alert" className="space-y-2"><p className="text-xs text-muted-foreground">No pude leer el resumen. Volvé a intentar para recuperar el último guardado.</p><Button size="sm" variant="outline" onClick={() => void query.refetch()}>Volver a intentar</Button></div> : query.data?.status === "invalid" ? <p role="alert" className="text-xs text-muted-foreground">El resumen guardado no se puede leer. Se conservó el archivo original; pedí su recuperación a quien administra esta instalación.</p> : query.data && <>
        <p className="text-xs text-muted-foreground">{query.data.checkpoint ? `Último guardado: ${new Date(query.data.checkpoint.updatedAt).toLocaleString()}.` : "Sin resumen guardado."} Los mensajes no se resumen automáticamente.</p>
        {labels.map(({ field, label, maxLength }) => <div key={field} className="space-y-2"><Label htmlFor={`${id}-${field}`} className="text-xs">{label}</Label><Textarea id={`${id}-${field}`} aria-label={label} value={draft[field]} maxLength={maxLength} disabled={saving} placeholder={field === "objective" ? "Qué querés conseguir" : "Una nota por línea"} onChange={event => update({ [field]: event.target.value })} className="min-h-20 text-xs" /></div>)}
        <div className="space-y-3"><p className="text-xs font-medium">Archivos y evidencia</p>{draft.artifacts.map((artifact, index) => <div key={index} className="space-y-2">
          <div className="flex gap-2"><Input aria-label={`Ruta del archivo ${index + 1}`} placeholder="Ruta del archivo" value={artifact.path} maxLength={800} disabled={saving} onChange={event => update({ artifacts: draft.artifacts.map((item, number) => number === index ? { ...item, path: event.target.value } : item) })} /><Button variant="ghost" size="icon-sm" aria-label={`Quitar archivo ${index + 1}`} disabled={saving} onClick={() => update({ artifacts: draft.artifacts.filter((_, number) => number !== index) })}><X /></Button></div>
          <Input aria-label={`Evidencia del archivo ${index + 1}`} placeholder="Qué se verificó y con qué resultado" value={artifact.evidence} maxLength={800} disabled={saving} onChange={event => update({ artifacts: draft.artifacts.map((item, number) => number === index ? { ...item, evidence: event.target.value } : item) })} />
        </div>)}<Button size="sm" variant="ghost" disabled={saving || draft.artifacts.length >= 16} onClick={() => update({ artifacts: [...draft.artifacts, { path: "", evidence: "" }] })}>Agregar archivo</Button></div>
        <div className="flex items-center gap-3"><Button size="sm" disabled={!dirty || saving || Boolean(conflict) || revision === null} onClick={() => void save()}>Guardar resumen</Button>{dirty && <span className="text-xs text-muted-foreground">Sin guardar</span>}</div>
        {conflict && <div className="space-y-3 border-t border-border pt-3"><p className="text-xs font-medium">Resumen guardado actualmente</p>{conflict.checkpoint ? <div className="space-y-2 text-xs"><p>{conflict.checkpoint.objective}</p>{[{ label: "Decisiones", notes: conflict.checkpoint.decisions }, { label: "Avances", notes: conflict.checkpoint.progress }, { label: "Pendientes", notes: conflict.checkpoint.pending }].map(group => <div key={group.label}><p className="font-medium">{group.label}</p>{group.notes.map((note, index) => <p key={index} className="whitespace-pre-wrap">{note}</p>)}</div>)}{conflict.checkpoint.artifacts.map((artifact, index) => <p key={index}>{artifact.path}: {artifact.evidence}</p>)}</div> : <p className="text-xs text-muted-foreground">{conflict.status === "invalid" ? "El archivo actual requiere recuperación manual." : "No hay resumen guardado."}</p>}
          {conflict.status !== "invalid" && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => { setRevision(conflict.revision); persist(draft, conflict.revision); setConflict(null); setMessage("Borrador conservado. Revisá las notas y guardá el resumen para reemplazar la versión que acabás de leer."); }}>Conservar mi borrador</Button><Button size="sm" variant="ghost" onClick={() => { setRecovery(draft); setDraft(toDraft(conflict)); setRevision(conflict.revision); writeMemoryDraft(draftKey, null); cache.setQueryData(key, conflict); setConflict(null); setDirty(false); setMessage("Versión guardada recuperada. Podés recuperar tu borrador anterior."); }}>Usar versión guardada</Button></div>}
        </div>}
        {recovery && <Button size="sm" variant="ghost" onClick={() => { setDraft(recovery); persist(recovery, revision); setRecovery(null); setDirty(true); setMessage("Borrador recuperado; todavía no se guardó."); }}>Recuperar mi borrador</Button>}
        <p className="text-xs text-muted-foreground">Guardá decisiones y evidencia; evitá claves y datos personales.</p>
      </>}
      {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
    </CollapsibleContent>
  </Collapsible>;
}

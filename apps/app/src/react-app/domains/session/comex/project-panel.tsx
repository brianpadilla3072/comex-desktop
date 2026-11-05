/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, FileText, Globe, RefreshCw } from "lucide-react";
import { OpenworkServerError, type OpenworkServerClient } from "@/app/lib/openwork-server";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { openTargetFromWorkspaceFile, type OpenTarget } from "../artifacts/open-target";

import { readMemoryDraft, writeMemoryDraft } from "./memory-draft";

const projectPath = "comex/estado.md";
const memoryEmpty = "# Notas de esta sesión\n\n## Objetivo\n\n## Avances y decisiones\n\n## Próximo paso\n";

export function ComexProjectPanel({ client, workspaceId, sessionId, onOpenTarget, onOpenBrowser }: {
  client: OpenworkServerClient; workspaceId: string; sessionId: string;
  onOpenTarget: (target: OpenTarget) => void; onOpenBrowser?: () => void;
}) {
  const files = useQuery({ queryKey: ["comex-files", client.baseUrl, workspaceId], queryFn: () => client.listWorkspaceFiles(workspaceId), refetchInterval: 15_000, retry: false });
  const [mode, setMode] = useState<"project" | "session">("project");
  const safeSession = /^[A-Za-z0-9_-]{1,256}$/.test(sessionId);
  const path = mode === "project" ? projectPath : `comex/sesiones/${safeSession ? sessionId : "invalid"}.md`;
  const openFile = (filename: string) => {
    const target = openTargetFromWorkspaceFile(filename);
    if (target) onOpenTarget({ ...target, fileScope: "workspace" });
  };
  const results = (files.data?.items ?? []).filter(item => item.kind === "file" && /\.(docx|xlsx|pdf|csv|png|pptx)$/i.test(item.path));
  const sources = (files.data?.items ?? []).filter(item => item.kind === "file" && /(?:^|\/)(?:fuentes|cumplimiento|consigna)\.md$/i.test(item.path));
  return <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4" data-testid="comex-project-panel">
    <section>
      <div className="mb-2 flex items-center"><h2 className="flex-1 text-sm font-medium">Resultados del proyecto</h2><Button variant="ghost" size="icon-sm" aria-label="Actualizar archivos" disabled={files.isFetching} onClick={() => void files.refetch()}><RefreshCw className={files.isFetching ? "animate-spin" : ""} /></Button></div>
      {files.isLoading ? <div role="status" aria-label="Buscando archivos del proyecto" className="space-y-2"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></div> : files.isError ? <p role="alert" className="text-xs text-muted-foreground">No pude leer los archivos. Volvé a intentar con Actualizar archivos.</p> : !results.length ? <p className="text-xs text-muted-foreground">Todavía no hay documentos. Pedí el informe o la planilla en el chat.</p> : <ul className="space-y-1">{results.map(item => <li key={item.path}><Button variant="ghost" className="w-full justify-start gap-2 rounded-lg text-left" onClick={() => openFile(item.path)}><FileText className="shrink-0" /><span className="truncate">{item.path.split("/").pop()}</span></Button></li>)}</ul>}
    </section>
    <section>
      <h2 className="mb-2 text-sm font-medium">Fuentes y cumplimiento</h2>
      {!sources.length && <p className="text-xs text-muted-foreground">Los registros de fuentes y requisitos aparecerán cuando se guarden.</p>}
      {sources.map(item => <Button key={item.path} variant="ghost" className="w-full justify-start gap-2 rounded-lg" onClick={() => openFile(item.path)}><BookOpen /><span className="truncate">{item.path}</span></Button>)}
      {onOpenBrowser && <Button variant="ghost" className="mt-2 w-full justify-start gap-2 rounded-lg" onClick={onOpenBrowser}><Globe />Abrir navegador</Button>}
    </section>
    <section className="border-t border-border pt-4">
      <h2 className="mb-3 text-sm font-medium">Memoria</h2>
      <div className="mb-3 flex gap-1" role="group" aria-label="Alcance de la memoria">
        <Button variant={mode === "project" ? "secondary" : "ghost"} size="sm" aria-pressed={mode === "project"} onClick={() => setMode("project")}>Proyecto</Button>
        <Button variant={mode === "session" ? "secondary" : "ghost"} size="sm" aria-pressed={mode === "session"} disabled={!safeSession} onClick={() => setMode("session")}>Esta sesión</Button>
      </div>
      <MemoryEditor key={`${client.baseUrl}:${workspaceId}:${path}`} client={client} workspaceId={workspaceId} path={path} />
    </section>
  </div>;
}

function MemoryEditor({ client, workspaceId, path }: { client: OpenworkServerClient; workspaceId: string; path: string }) {
  const cache = useQueryClient();
  const key = ["comex-memory", client.baseUrl, workspaceId, path];
  const query = useQuery({ queryKey: key, queryFn: async () => {
    try { return await client.readWorkspaceFile(workspaceId, path, { fileScope: "workspace" }); }
    catch (error) { if (error instanceof OpenworkServerError && error.status === 404) return { content: memoryEmpty, updatedAt: 0 }; throw error; }
  }, retry: false, refetchOnWindowFocus: false });
  const draftKey = `comex-draft:${client.baseUrl}:${workspaceId}:${path}`;
  const [cached] = useState(() => readMemoryDraft(draftKey));
  const [draft, setDraft] = useState(cached?.text ?? "");
  const [dirty, setDirty] = useState(Boolean(cached));
  const base = useRef<number | null>(cached?.baseUpdatedAt ?? null);
  const [saving, setSaving] = useState(false);
  const [recovery, setRecovery] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [conflict, setConflict] = useState<{ content: string; updatedAt: number | null } | null>(null);
  useEffect(() => { if (query.data && !dirty) { setDraft(query.data.content); base.current = query.data.updatedAt ?? null; } }, [query.data, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty]);
  const save = async () => {
    if (!query.data || saving) return;
    setSaving(true); setStatus("");
    try {
      const result = await client.writeWorkspaceFile(workspaceId, { path, content: draft, baseUpdatedAt: base.current, fileScope: "workspace" });
      cache.setQueryData(key, { content: draft, updatedAt: result.updatedAt });
      writeMemoryDraft(draftKey, null);
      setDirty(false); setConflict(null); setStatus("Memoria guardada");
    } catch (error) {
      if (error instanceof OpenworkServerError && error.status === 409) {
        try {
          const latest = await client.readWorkspaceFile(workspaceId, path, { fileScope: "workspace" });
          setConflict({ content: latest.content, updatedAt: latest.updatedAt ?? null });
          setStatus("Otra sesión cambió la memoria. Revisá la versión guardada antes de elegir cuál conservar.");
        } catch { setStatus("La memoria cambió y no pude leer la versión actual. Tus notas siguen en el borrador; volvé a intentar."); }
      } else { setStatus("No pude guardar la memoria. Tus notas siguen en el borrador; revisá la conexión y volvé a intentar."); }
    }
    finally { setSaving(false); }
  };
  if (query.isLoading) return <Skeleton role="status" aria-label="Leyendo memoria" className="h-64 w-full" />;
  if (query.isError) return <div role="alert"><p className="text-xs text-muted-foreground">No pude leer la memoria del proyecto.</p><Button variant="outline" size="sm" onClick={() => void query.refetch()}>Volver a intentar</Button></div>;
  return <div className="space-y-3">
    <Textarea aria-label="Notas de memoria" value={draft} disabled={saving} onChange={event => { setDraft(event.target.value); setDirty(true); setStatus(writeMemoryDraft(draftKey, { text: event.target.value, baseUpdatedAt: base.current }) ? "" : "No pude conservar el borrador local. Guardá antes de cerrar."); }} className="min-h-64 resize-y text-xs leading-6" />
    <div className="flex items-center gap-3"><Button size="sm" disabled={!dirty || saving || Boolean(conflict)} onClick={() => void save()}>{saving ? "Guardando…" : "Guardar memoria"}</Button>{dirty && <span className="text-xs text-muted-foreground">Sin guardar</span>}</div>
    <p role="status" className="text-xs text-muted-foreground">{status}</p>
    {conflict && <div className="space-y-3 border-t border-border pt-3">
      <h3 className="text-xs font-medium">Versión guardada por otra sesión</h3>
      <Textarea aria-label="Memoria guardada por otra sesión" value={conflict.content} readOnly className="min-h-40 text-xs leading-6" />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={saving} onClick={() => {
          // Keep our notes in the editable draft; rebasing requires a separate Save.
          base.current = conflict.updatedAt;
          cache.setQueryData(key, conflict);
          writeMemoryDraft(draftKey, { text: draft, baseUpdatedAt: base.current });
          setConflict(null); setStatus("Tus notas se conservan. Guardar memoria reemplazará la versión que acabás de revisar.");
        }}>Conservar mis notas</Button>
        <Button size="sm" disabled={saving} onClick={() => {
          setRecovery(draft); writeMemoryDraft(draftKey, null);
          setDraft(conflict.content); base.current = conflict.updatedAt;
          cache.setQueryData(key, conflict); setDirty(false); setConflict(null);
          // Keep a recovery action instead of silently discarding the draft.
          setStatus("Se muestra la versión guardada. Tus notas anteriores siguen disponibles para recuperar.");
        }}>Usar versión guardada</Button>
      </div>
    </div>}

    {recovery !== null && <Button variant="ghost" size="sm" onClick={() => {
      setDraft(recovery); setDirty(true);
      writeMemoryDraft(draftKey, { text: recovery, baseUpdatedAt: base.current });
      setRecovery(null); setStatus("Notas recuperadas como borrador; todavía no se guardaron.");
    }}>Recuperar mis notas anteriores</Button>}
    <p className="text-xs text-muted-foreground">Se guarda en tu carpeta. Registrá decisiones y pendientes; evitá claves y datos personales.</p>
  </div>;
}

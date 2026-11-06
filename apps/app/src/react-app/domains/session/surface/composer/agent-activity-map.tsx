/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isToolUIPart, type UIMessage } from "ai";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { agentName, useSubagentRunState } from "@/components/chat/subagent-run-line";
import { isTaskToolPart, type TaskToolPart } from "@/lib/build-in-tools";
import { cn } from "@/lib/utils";

export function conversationAgentTasks(messages: readonly UIMessage[]): TaskToolPart[] {
  const tasks = new Map<string, TaskToolPart>();
  for (const message of messages) if (message.role === "assistant") {
    for (const part of message.parts) if (isToolUIPart(part) && isTaskToolPart(part)) tasks.set(part.toolCallId, part);
  }
  return [...tasks.values()];
}

type AgentState = { kind: "running" | "waiting" | "done" | "error" | "stopped" | "unknown"; label: string; childId: string | null };
const UNKNOWN: AgentState = { kind: "unknown", label: "Verificando estado", childId: null };
export function agentMapState(state: ReturnType<typeof useSubagentRunState>, syncDegraded: boolean): AgentState {
  const childId = state.childSessionId;
  if (syncDegraded) return { kind: "unknown", label: "Sin conexión", childId };
  if (state.permissionPending || state.questionPending) return { kind: "waiting", label: "Necesita tu respuesta", childId };
  if (state.stoppedByError && !state.childRunning) return { kind: "stopped", label: "Detenido", childId };
  if (state.activity === "failed") return { kind: "error", label: "Falló", childId };
  if (state.activity === "completed") return { kind: "done", label: "Finalizado", childId };
  if (state.activity === "waiting-start" || state.activity === "waiting-result") return { kind: "unknown", label: "Verificando estado", childId };
  return { kind: "running", label: state.activity === "retrying" ? "Reintentando" : "En ejecución", childId };
}

function StateDot({ kind }: { kind: AgentState["kind"] }) {
  return <span aria-hidden data-agent-state={kind} className={cn("size-2 shrink-0 rounded-full bg-muted-foreground/50",
    kind === "running" && "bg-green-9", kind === "waiting" && "bg-amber-9", kind === "error" && "bg-red-9")} />;
}

function ObserveAgent({ part, workspaceId, parentActive, syncDegraded, report }: {
  part: TaskToolPart; workspaceId: string; parentActive: boolean; syncDegraded: boolean; report: (id: string, state: AgentState) => void;
}) {
  const live = useSubagentRunState(part, parentActive, workspaceId, syncDegraded);
  const state = agentMapState(live, syncDegraded);
  useEffect(() => { report(part.toolCallId, state); }, [report, part.toolCallId, state.kind, state.label, state.childId]);
  return null;
}

export function AgentActivityMap({ messages, workspaceId, owner, parentTitle, parentActive, syncDegraded, readChild, onOpenChild }: {
  messages: readonly UIMessage[]; workspaceId: string; owner: string; parentTitle: string; parentActive: boolean; syncDegraded: boolean;
  readChild: (sessionId: string) => Promise<UIMessage[]>; onOpenChild?: (sessionId: string) => void;
}) {
  const tasks = useMemo(() => conversationAgentTasks(messages), [messages]);
  const [states, setStates] = useState<Record<string, AgentState>>({});
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const report = useCallback((id: string, next: AgentState) => {
    setStates(current => current[id]?.kind === next.kind && current[id]?.label === next.label && current[id]?.childId === next.childId ? current : { ...current, [id]: next });
  }, []);
  const running = tasks.filter(task => states[task.toolCallId]?.kind === "running").length;
  const waiting = tasks.some(task => states[task.toolCallId]?.kind === "waiting");
  const selected = tasks.find(task => task.toolCallId === selectedId);
  if (!tasks.length) return null;
  return <>
    {tasks.map(part => <ObserveAgent key={part.toolCallId} part={part} workspaceId={workspaceId} parentActive={parentActive} syncDegraded={syncDegraded} report={report} />)}
    <Button variant="ghost" size="xs" className="gap-1.5 rounded-full bg-muted/60 text-muted-foreground" aria-label="Ver agentes en segundo plano" data-agent-map-button
      onClick={() => { setSelectedId(null); setOpen(true); }}>
      <StateDot kind={running ? "running" : waiting ? "waiting" : "done"} />{tasks.length} {tasks.length === 1 ? "agente" : "agentes"}
      <span className="sr-only">{running} en ejecución</span>
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className={cn("max-h-[85dvh] overflow-y-auto", selected ? "lg:max-w-2xl" : "lg:max-w-4xl")} data-agent-map-dialog>
        <DialogHeader><DialogTitle className="flex min-w-0 items-center gap-2 pr-8">
          {selected ? <Button variant="ghost" size="icon-xs" aria-label="Volver al mapa de agentes" onClick={() => setSelectedId(null)}><ArrowLeft /></Button> : null}
          <span className="truncate">{selected ? selected.input?.description || "Detalle del agente" : "Mapa de agentes"}</span>
        </DialogTitle></DialogHeader>
        {selected ? <AgentDetails key={selected.toolCallId} part={selected} state={states[selected.toolCallId] ?? UNKNOWN} owner={owner} readChild={readChild} onOpenChild={onOpenChild} /> : <>
          <p className="text-sm text-muted-foreground">{tasks.length} {tasks.length === 1 ? "agente" : "agentes"} · {running} en ejecución</p>
          <div className="grid items-center gap-5 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:gap-10" data-agent-flow>
            <div className="relative flex min-w-0 items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-3 md:after:absolute md:after:top-1/2 md:after:-right-10 md:after:w-10 md:after:border-t md:after:border-muted-foreground/30">
              <StateDot kind={syncDegraded ? "unknown" : parentActive ? "running" : "done"} />
              <div className="min-w-0"><p className="truncate text-sm font-medium">{parentTitle || "Conversación principal"}</p><p className="text-xs text-muted-foreground">Agente principal</p></div>
            </div>
            <div className="grid min-w-0 gap-2 md:border-l md:border-muted-foreground/30 md:pl-5">
              {tasks.map(part => { const state = states[part.toolCallId] ?? UNKNOWN; return <Button key={part.toolCallId} variant="outline"
                className="relative h-auto min-h-14 w-full justify-start gap-2 rounded-lg px-3 py-2 text-left md:before:absolute md:before:top-1/2 md:before:-left-5 md:before:w-5 md:before:border-t md:before:border-muted-foreground/30"
                title={part.input?.description} onClick={() => setSelectedId(part.toolCallId)} data-agent-node={part.toolCallId}>
                <StateDot kind={state.kind} /><span className="min-w-0"><span className="block truncate text-sm">{part.input?.description || agentName(part.input?.subagent_type ?? "")}</span><span className="block text-xs font-normal text-muted-foreground">{state.label}</span></span>
              </Button>; })}
            </div>
          </div>
        </>}
      </DialogContent>
    </Dialog>
  </>;
}

function inputField(input: unknown, field: string): string | null {
  const value = input && typeof input === "object" ? Reflect.get(input, field) : null;
  return typeof value === "string" && value.trim() ? value : null;
}

export function agentToolCalls(messages: readonly UIMessage[]) {
  return messages.flatMap(message => message.role !== "assistant" ? [] : message.parts.filter(isToolUIPart));
}

function AgentDetails({ part, state, owner, readChild, onOpenChild }: {
  part: TaskToolPart; state: AgentState; owner: string; readChild: (sessionId: string) => Promise<UIMessage[]>; onOpenChild?: (sessionId: string) => void;
}) {
  const childId = state.childId;
  const query = useQuery({ queryKey: ["agent-activity-map", owner, childId], queryFn: () => readChild(childId!), enabled: Boolean(childId),
    refetchInterval: state.kind === "running" || state.kind === "waiting" || state.kind === "unknown" ? 2000 : false, retry: false });
  const previousKind = useRef(state.kind);
  useEffect(() => {
    const changed = previousKind.current !== state.kind;
    previousKind.current = state.kind;
    // Read the last tool results once more before stopping the live poll.
    if (changed && childId && (state.kind === "done" || state.kind === "error" || state.kind === "stopped")) void query.refetch();
  }, [state.kind, childId, query.refetch]);
  const calls = agentToolCalls(query.data ?? []);
  return <div className="grid min-w-0 gap-4" data-agent-details>
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><StateDot kind={state.kind} /><span>{state.label}</span><span>· {agentName(part.input?.subagent_type ?? "")}</span></div>
    <Collapsible defaultOpen><CollapsibleTrigger className="text-sm font-medium">Prompt del agente</CollapsibleTrigger><CollapsibleContent>
      <pre className="mt-2 max-h-52 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 font-sans text-sm">{part.input?.prompt || "El motor no informó el prompt."}</pre>
    </CollapsibleContent></Collapsible>
    {!childId ? <p className="text-sm text-muted-foreground">El agente todavía no informó su conversación.</p> : null}
    {query.isPending && childId ? <div aria-label="Cargando actividad del agente" className="h-20 rounded-lg bg-muted/40 motion-safe:animate-pulse" /> : null}
    {query.isError ? <div role="alert" className="flex items-center gap-2 text-sm"><span>No se pudo actualizar la actividad.</span><Button size="xs" variant="outline" onClick={() => void query.refetch()}>Reintentar</Button></div> : null}
    {query.data ? <Collapsible defaultOpen><CollapsibleTrigger className="text-sm font-medium">Herramientas y comandos ({calls.length})</CollapsibleTrigger><CollapsibleContent className="mt-2 grid gap-2">
      {calls.length === 0 ? <p className="text-sm text-muted-foreground">Todavía no hay comandos registrados.</p> : calls.map(call => {
        const name = call.type === "dynamic-tool" ? call.toolName : call.type.slice(5);
        const command = inputField(call.input, "command") || inputField(call.input, "code") || inputField(call.input, "script");
        const label = inputField(call.input, "description") || inputField(call.input, "filePath") || name;
        const output = call.state === "output-available" ? (typeof call.output === "string" ? call.output : JSON.stringify(call.output, null, 2)) : call.state === "output-error" ? call.errorText : null;
        return <Collapsible key={call.toolCallId} className="border-b border-border pb-2"><CollapsibleTrigger className="flex w-full min-w-0 gap-2 text-left text-sm"><span className="shrink-0 font-medium">{name}</span><span className="truncate text-muted-foreground">{label}</span></CollapsibleTrigger><CollapsibleContent className="mt-2 grid gap-2">
          <p className="text-xs text-muted-foreground">{call.state === "output-available" ? "Finalizó" : call.state === "output-error" ? "Falló" : call.state === "input-streaming" ? "Preparando" : "En ejecución"}</p>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 text-xs">{command || JSON.stringify(call.input ?? {}, null, 2)}</pre>
          {output ? <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 text-xs">{output.slice(0, 20000)}{output.length > 20000 ? "\n…" : ""}</pre> : null}
        </CollapsibleContent></Collapsible>;
      })}
    </CollapsibleContent></Collapsible> : null}
    {childId && onOpenChild ? <Button variant="outline" className="justify-self-start" onClick={() => onOpenChild(childId)}>Abrir conversación del agente</Button> : null}
  </div>;
}

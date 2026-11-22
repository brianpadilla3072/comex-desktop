/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isToolUIPart, type UIMessage } from "ai";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { agentName, useSubagentRunState, useElapsedSeconds } from "@/components/chat/subagent-run-line";
import { AgentMark } from "@/components/chat/agent-mark";
import { ExecutionRunHeader, ExecutionToolRow } from "@/components/chat/execution-feedback";
import { taskChildSessionId, isTaskToolPart, type TaskToolPart } from "@/lib/build-in-tools";
import { replyModelLabel } from "@/react-app/domains/session/sync/reply-model";
import { cn } from "@/lib/utils";

export function conversationAgentTasks(messages: readonly UIMessage[]): TaskToolPart[] {
  const tasks = new Map<string, TaskToolPart>();
  for (const message of messages) if (message.role === "assistant") {
    for (const part of message.parts) if (isToolUIPart(part) && isTaskToolPart(part)) tasks.set(part.toolCallId, part);
  }
  return [...tasks.values()];
}

type AgentState = { kind: "running" | "waiting" | "done" | "error" | "stopped" | "unknown"; label: string; childId: string | null; startedAt?: number | null };
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
    kind === "running" && "bg-muted-foreground", kind === "waiting" && "bg-amber-9", kind === "error" && "bg-red-9")} />;
}

function ObserveAgent({ part, workspaceId, parentActive, syncDegraded, report }: {
  part: TaskToolPart; workspaceId: string; parentActive: boolean; syncDegraded: boolean; report: (id: string, state: AgentState) => void;
}) {
  const live = useSubagentRunState(part, parentActive, workspaceId, syncDegraded);
  const state = { ...agentMapState(live, syncDegraded), startedAt: live.startedAt };
  useEffect(() => { report(part.toolCallId, state); }, [report, part.toolCallId, state.kind, state.label, state.childId, state.startedAt]);
  return null;
}

export function AgentActivityMap({ messages, workspaceId, owner, parentTitle, parentActive, syncDegraded, readChild, onOpenChild, presentation = "button", onOpenWorkspace, initialChildId, visible = true }: {
  messages: readonly UIMessage[]; workspaceId: string; owner: string; parentTitle: string; parentActive: boolean; syncDegraded: boolean;
  readChild: (sessionId: string) => Promise<UIMessage[]>; onOpenChild?: (sessionId: string) => void;
  presentation?: "button" | "summary" | "workspace"; onOpenWorkspace?: () => void; initialChildId?: string; visible?: boolean;
}) {
  const tasks = useMemo(() => conversationAgentTasks(messages), [messages]);
  const [states, setStates] = useState<Record<string, AgentState>>({});
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const report = useCallback((id: string, next: AgentState) => {
    setStates(current => current[id]?.kind === next.kind && current[id]?.label === next.label && current[id]?.childId === next.childId && current[id]?.startedAt === next.startedAt ? current : { ...current, [id]: next });
  }, []);
  const initialTaskId = initialChildId ? tasks.find(task => taskChildSessionId(task) === initialChildId)?.toolCallId : undefined;
  useEffect(() => { setSelectedId(initialTaskId ?? null); }, [initialChildId, initialTaskId]);
  const running = tasks.filter(task => states[task.toolCallId]?.kind === "running").length;
  const waiting = tasks.some(task => states[task.toolCallId]?.kind === "waiting");
  const selected = tasks.find(task => task.toolCallId === selectedId);
  const unknown = tasks.filter(task => !states[task.toolCallId] || states[task.toolCallId]?.kind === "unknown").length;
  const done = tasks.filter(task => states[task.toolCallId]?.kind === "done").length;
  const stopped = tasks.filter(task => states[task.toolCallId]?.kind === "stopped").length;
  const waitingCount = tasks.filter(task => states[task.toolCallId]?.kind === "waiting").length;
  const failed = tasks.filter(task => states[task.toolCallId]?.kind === "error").length;
  if (!tasks.length) return presentation === "workspace" ? <p className="p-4 text-sm text-muted-foreground">Sin subagentes en esta conversación</p> : null;
  const observers = tasks.map(part => <ObserveAgent key={part.toolCallId} part={part} workspaceId={workspaceId} parentActive={parentActive} syncDegraded={syncDegraded} report={report} />);
  const summary = [running ? `${running} procesando` : "", waitingCount ? `${waitingCount} esperando respuesta` : "", unknown ? `${unknown} sin confirmar` : "", failed ? `${failed} con errores` : "", stopped ? `${stopped} detenidos` : "", done ? `${done} ${done === 1 ? "listo" : "listos"}` : ""].filter(Boolean).join(" · ");
  const content = <>
    <header className="sticky top-0 z-10 flex h-12 min-w-0 items-center gap-3 border-b border-border bg-background px-4 text-sm">
      {selected ? <Button variant="ghost" size="icon-xs" aria-label="Volver a subagentes" onClick={() => setSelectedId(null)}><ArrowLeft /></Button> : null}
      <span className="min-w-0 truncate font-medium">{selected ? selected.input?.description || "Detalle del agente" : "Subagentes"}</span>
      <span className="ml-auto min-w-0 truncate text-xs font-normal text-muted-foreground">{selected ? agentName(selected.input?.subagent_type ?? "") : summary}</span>
    </header>
    <div className="mx-auto w-full max-w-3xl px-4 py-6 pb-32 sm:px-6">
      {selected ? <AgentDetails key={selected.toolCallId} part={selected} state={states[selected.toolCallId] ?? UNKNOWN} owner={owner} readChild={readChild} onOpenChild={onOpenChild} compact={presentation === "workspace"} active={visible} /> : <div data-agent-flow className="divide-y divide-border">
        {tasks.map(part => { const state = states[part.toolCallId] ?? UNKNOWN; return <Button key={part.toolCallId} variant="ghost" className="h-auto min-h-16 w-full justify-start gap-3 rounded-none px-1 py-3 text-left" onClick={() => setSelectedId(part.toolCallId)} data-agent-node={part.toolCallId}>
          <AgentMark id={part.toolCallId} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{part.input?.description || agentName(part.input?.subagent_type ?? "")}</span><span className="mt-1 block text-xs font-normal text-muted-foreground">{state.label}</span></span><StateDot kind={state.kind} /><ChevronRight strokeWidth={1.5} className="size-3.5 shrink-0 text-muted-foreground/60" />
        </Button>; })}
      </div>}
    </div>
  </>;
  if (presentation === "workspace") return <div className="h-full overflow-y-auto" data-agents-workspace>{observers}{content}</div>;
  return <>
    {observers}
    <Button variant="ghost" size="xs" className={presentation === "summary" ? "h-auto min-h-8 w-full justify-start gap-2.5 rounded-md px-1 py-1 text-xs font-normal" : "gap-1.5 rounded-full bg-muted/60 text-muted-foreground"} aria-label="Ver agentes en segundo plano" data-agent-map-button
      onClick={() => { setSelectedId(null); if (onOpenWorkspace) onOpenWorkspace(); else setOpen(true); }}>
      {presentation === "summary" ? <span className="inline-flex shrink-0 items-center gap-0.5" aria-hidden>{tasks.slice(0, 3).map(part => <AgentMark key={part.toolCallId} id={part.toolCallId} />)}</span> : <StateDot kind={running ? "running" : waiting ? "waiting" : unknown ? "unknown" : failed ? "error" : "done"} />}
      <span className="min-w-0 flex-1 whitespace-normal text-left leading-5">{presentation === "summary" ? summary : `${tasks.length} ${tasks.length === 1 ? "agente" : "agentes"}`}</span>
      <span className="sr-only">{tasks.length} subagentes · {running} en ejecución</span>
    </Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85dvh] overflow-y-auto lg:max-w-4xl" data-agent-map-dialog><DialogHeader><DialogTitle>Mapa de agentes</DialogTitle></DialogHeader>{content}</DialogContent></Dialog>
  </>;
}

function inputField(input: unknown, field: string): string | null {
  const value = input && typeof input === "object" ? Reflect.get(input, field) : null;
  return typeof value === "string" && value.trim() ? value : null;
}

export function agentToolCalls(messages: readonly UIMessage[]) {
  return messages.flatMap(message => message.role !== "assistant" ? [] : message.parts.filter(isToolUIPart));
}

function AgentDetails({ part, state, owner, readChild, onOpenChild, compact = false, active = true }: {
  active?: boolean; compact?: boolean; part: TaskToolPart; state: AgentState; owner: string; readChild: (sessionId: string) => Promise<UIMessage[]>; onOpenChild?: (sessionId: string) => void;
}) {
  const childId = state.childId;
  const elapsed = useElapsedSeconds(state.kind === "running", state.startedAt ?? null, state.kind === "unknown", part.toolCallId);
  const query = useQuery({ queryKey: ["agent-activity-map", owner, childId], queryFn: () => readChild(childId!), enabled: Boolean(childId) && active,
    refetchInterval: active && (state.kind === "running" || state.kind === "waiting" || state.kind === "unknown") ? 2000 : false, retry: false });
  const previousKind = useRef(state.kind);
  useEffect(() => {
    const changed = previousKind.current !== state.kind;
    previousKind.current = state.kind;
    // Read the last tool results once more before stopping the live poll.
    if (active && changed && childId && (state.kind === "done" || state.kind === "error" || state.kind === "stopped")) void query.refetch();
  }, [active, state.kind, childId, query.refetch]);
  const calls = agentToolCalls(query.data ?? []);
  const lastReply = query.data?.findLast(message => message.role === "assistant");
  const model = lastReply ? replyModelLabel(lastReply) : null;
  return <div className="grid min-w-0 gap-4" data-agent-details>
    {compact && (state.kind === "running" || state.kind === "waiting" || state.kind === "unknown") ? <ExecutionRunHeader seconds={elapsed} disconnected={state.label === "Sin conexión"} unconfirmed={state.kind === "unknown"} retrying={state.label === "Reintentando"} waiting={state.kind === "waiting"} /> : null}
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><StateDot kind={state.kind} /><span>{state.label}</span><span>· {agentName(part.input?.subagent_type ?? "")}</span>{model ? <span className="ml-auto">{model}</span> : null}</div>
    <Collapsible defaultOpen={!compact}><CollapsibleTrigger className="group flex min-h-8 w-full items-center justify-between gap-2 rounded-sm text-left text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">Prompt del agente<ChevronRight strokeWidth={1.5} className="size-3.5 transition-transform group-data-panel-open:rotate-90 motion-reduce:transition-none" /></CollapsibleTrigger><CollapsibleContent>
      <pre className="mt-2 max-h-52 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 font-sans text-sm">{part.input?.prompt || "El motor no informó el prompt."}</pre>
    </CollapsibleContent></Collapsible>
    {!childId ? <p className="text-sm text-muted-foreground">El agente todavía no informó su conversación.</p> : null}
    {query.isPending && childId ? <div aria-label="Cargando actividad del agente" className="h-20 rounded-lg bg-muted/40 motion-safe:animate-pulse" /> : null}
    {query.isError ? <div role="alert" className="flex items-center gap-2 text-sm"><span>No se pudo actualizar la actividad.</span><Button size="xs" variant="outline" onClick={() => void query.refetch()}>Reintentar</Button></div> : null}
    {query.data ? <Collapsible defaultOpen><CollapsibleTrigger className="group flex min-h-8 w-full items-center justify-between gap-2 rounded-sm text-left text-xs font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">Herramientas y comandos ({calls.length})<ChevronRight strokeWidth={1.5} className="size-3.5 transition-transform group-data-panel-open:rotate-90 motion-reduce:transition-none" /></CollapsibleTrigger><CollapsibleContent className="mt-2 grid gap-2">
      {calls.length === 0 ? <p className="text-sm text-muted-foreground">Todavía no hay comandos registrados.</p> : calls.map(call => {
        const name = call.type === "dynamic-tool" ? call.toolName : call.type.slice(5);
        const label = inputField(call.input, "description") || inputField(call.input, "filePath") || name;
        if (compact) return <ExecutionToolRow key={call.toolCallId} part={call} status={(state.kind === "unknown" || state.kind === "done" || state.kind === "stopped" || state.kind === "error") && call.state !== "output-available" && call.state !== "output-error" ? "unknown" : call.state === "output-error" || call.state === "output-denied" ? "failed" : call.state === "output-available" ? "done" : state.kind === "waiting" ? "waiting" : "running"} />;
        return <Collapsible key={call.toolCallId} className="border-b border-border pb-2"><CollapsibleTrigger className="flex w-full min-w-0 gap-2 text-left text-sm"><span className="shrink-0 font-medium">{name}</span><span className="truncate text-muted-foreground">{label}</span></CollapsibleTrigger><CollapsibleContent className="mt-2 grid gap-2">
          <AgentToolDetails call={call} />
        </CollapsibleContent></Collapsible>;
      })}
    </CollapsibleContent></Collapsible> : null}
    {childId && onOpenChild ? <Button variant="outline" className="justify-self-start" onClick={() => onOpenChild(childId)}>Abrir conversación del agente</Button> : null}
  </div>;
}

/** Keep expensive formatting inside the disclosure's mounted content. A folded
 * row must not stringify its output on every activity poll or parent render. */
function AgentToolDetails({ call }: { call: ReturnType<typeof agentToolCalls>[number] }) {
  const output = useMemo(() => call.state === "output-available"
    ? (typeof call.output === "string" ? call.output : JSON.stringify(call.output, null, 2))
    : call.state === "output-error" ? call.errorText : null, [call]);
  const command = useMemo(() => inputField(call.input, "command") || inputField(call.input, "code") || inputField(call.input, "script") || JSON.stringify(call.input ?? {}, null, 2), [call.input]);
  return <>
    <p className="text-xs text-muted-foreground">{call.state === "output-available" ? "Finalizó" : call.state === "output-error" ? "Falló" : call.state === "input-streaming" ? "Preparando" : "En ejecución"}</p>
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 text-xs">{command}</pre>
    {output ? <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 text-xs">{output.slice(0, 20000)}{output.length > 20000 ? "\n…" : ""}</pre> : null}
  </>;
}

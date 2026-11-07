/** @jsxImportSource react */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import { OpenworkServerError } from "@/app/lib/openwork-server";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { GoalInput } from "@openwork/types/task-continuity";

const labels = { idle: "Sin objetivo activo", active: "En curso", paused: "Pausado", complete: "Finalizado por el agente", blocked: "Necesita tu intervención" };
export function TaskContinuityPanel({ client, workspaceId, sessionId }: { client: OpenworkServerClient; workspaceId: string; sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [objective, setObjective] = useState("");
  const [criteria, setCriteria] = useState("");
  const [maxTurns, setMaxTurns] = useState(8);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const state = useQuery({ queryKey: ["task-continuity", client.baseUrl, workspaceId, sessionId], queryFn: () => client.getTaskContinuity(workspaceId, sessionId), retry: false, refetchInterval: 3000 });
  const task = state.data;
  const update = async (action: "start" | "pause" | "resume", goal?: GoalInput) => {
    if (!task || busy) return;
    setBusy(true); setError("");
    try { await client.updateTaskGoal(workspaceId, sessionId, { revision: task.revision, action, ...(goal ? { goal } : {}) }); setEditing(false); await state.refetch(); }
    catch (e) { setError(e instanceof OpenworkServerError ? e.message : "No pude guardar el objetivo. Actualizá y volvé a intentar."); await state.refetch(); }
    finally { setBusy(false); }
  };
  return <section className="border-t border-border pt-4" data-testid="task-continuity-panel">
    <Button variant="ghost" className="h-auto min-h-9 w-full flex-wrap justify-start gap-x-2 gap-y-1 whitespace-normal text-left" aria-expanded={open} onClick={() => setOpen(v => !v)}><span>Objetivo y continuidad</span><span className="text-xs text-muted-foreground">{task ? labels[task.status] : ""}</span></Button>
    {open && <div className="mt-3 space-y-3">
      {state.isLoading ? <Skeleton className="h-20 w-full" /> : state.isError ? <div role="alert" className="text-xs text-muted-foreground">No pude verificar el objetivo. <Button variant="ghost" size="sm" onClick={() => void state.refetch()}>Actualizar objetivo</Button></div> : task && <>
        {task.objective && <p className="whitespace-pre-wrap text-sm">{task.objective}</p>}
        <p className="text-xs text-muted-foreground">Big Pickle · {task.turns}/{task.maxTurns} turnos{task.phase === "review" && task.status === "active" ? " · Revisando código" : ""}</p>
        {task.reason && <p role="status" className="text-xs text-muted-foreground">{task.reason}</p>}
        <div className="flex flex-wrap gap-2">
          {task.status === "active" ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void update("pause")}>Pausar objetivo</Button> : <>
            {task.objective && task.status !== "complete" && <Button size="sm" disabled={busy} onClick={() => void update("resume")}>Retomar objetivo</Button>}
            <Button size="sm" variant="outline" disabled={busy} onClick={() => { setObjective(task.objective); setCriteria(task.criteria); setMaxTurns(task.maxTurns); setEditing(true); }}>Definir objetivo</Button>
          </>}
        </div>
        {editing && <form className="space-y-3" onSubmit={e => { e.preventDefault(); void update("start", { objective, criteria, maxTurns }); }}>
          <label className="block text-xs">Objetivo<Textarea value={objective} onChange={e => setObjective(e.target.value)} maxLength={1600} required disabled={busy} /></label>
          <label className="block text-xs">Criterios para terminar<Textarea value={criteria} onChange={e => setCriteria(e.target.value)} maxLength={2400} required disabled={busy} /></label>
          <label className="block text-xs">Límite de turnos<Input type="number" value={maxTurns} min={1} max={30} required disabled={busy} onChange={e => setMaxTurns(Number(e.target.value))} /></label>
          <p className="text-xs text-muted-foreground">Iniciar autoriza las continuaciones con Big Pickle y los permisos actuales de este proyecto.</p>
          <div className="flex gap-2"><Button size="sm" disabled={busy || !objective.trim() || !criteria.trim()}>Iniciar objetivo</Button><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>Cancelar edición</Button></div>
        </form>}
        {!!task.evidence && <details><summary className="cursor-pointer text-xs">Ver evidencia del resultado</summary><p className="mt-2 whitespace-pre-wrap text-xs">{task.evidence}</p></details>}
        <details><summary className="cursor-pointer text-xs">Ver continuidad guardada{task.updatedAt ? ` · ${new Date(task.updatedAt).toLocaleString()}` : ""}</summary><p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{task.summary || "El próximo turno completado se guardará automáticamente."}</p></details>
      </>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>}
  </section>;
}

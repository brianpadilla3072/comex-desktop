/** @jsxImportSource react */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/** Reads the agent ecosystem board and lets the person stop all workers. */
export function AgentEcosystemPanel({ client, workspaceId }: { client: OpenworkServerClient; workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const queryClient = useQueryClient();
  const key = ["agent-ecosystem", client.baseUrl, workspaceId];
  const state = useQuery({
    queryKey: key,
    queryFn: () => client.getEcosystemState(workspaceId),
    enabled: open,
    retry: false,
    refetchInterval: open ? 4000 : false,
  });
  const [confirmHalt, setConfirmHalt] = useState(false);
  const halt = async (halted: boolean) => {
    setBusy(true); setError(""); setConfirmHalt(false);
    try {
      await client.ecosystemHalt(workspaceId, halted, "usuario");
      await queryClient.invalidateQueries({ queryKey: key });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pude cambiar el estado del ecosistema.");
    } finally { setBusy(false); }
  };
  const counts = state.data && {
    open: state.data.needs.filter(n => n.status === "open").length,
    claimed: state.data.needs.filter(n => n.status === "claimed").length,
    resolved: state.data.needs.filter(n => n.status === "resolved").length,
  };
  return <section className="border-t border-border pt-4">
    <Button variant="ghost" className="w-full justify-start" aria-expanded={open} onClick={() => setOpen(v => !v)}>Ecosistema de agentes</Button>
    {open && <div className="mt-3 space-y-3">
      {state.isLoading ? <Skeleton className="h-16 w-full" /> : state.isError ? <p role="alert" className="text-xs text-muted-foreground">No pude leer el tablero. Verifica la conexión con el proyecto.</p> : state.data && <>
        <p role="status" className="text-xs text-muted-foreground">
          {state.data.halted ? `Detenido por ${state.data.haltedBy ?? "el usuario"}` : counts ? `${counts.open} abiertos · ${counts.claimed} en curso · ${counts.resolved} resueltos` : "Sin actividad"}
        </p>
        {!!state.data.index.length && <details><summary className="cursor-pointer text-xs">Proyectos ({state.data.index.length})</summary><ul className="mt-2 space-y-1">{state.data.index.map(p => <li key={`${p.projectId}:${p.sessionId}`} className="text-xs"><span className="font-medium">{p.projectId}</span> · {p.oneLiner}</li>)}</ul></details>}
        {!!state.data.board.length && <details><summary className="cursor-pointer text-xs">Entregables ({state.data.board.length})</summary><ul className="mt-2 space-y-1">{state.data.board.map(d => <li key={d.id} className="text-xs"><span className="font-medium">{d.title}</span> · {d.ownerAgent} · {d.status}</li>)}</ul></details>}
        {state.data.halted
          ? <Button variant="outline" size="sm" disabled={busy} onClick={() => void halt(false)}>Reanudar agentes</Button>
          : confirmHalt
            ? <div className="space-y-2"><p className="text-xs">Se detienen las tareas nuevas. Las que están en curso terminan. Puedes reanudar cuando quieras.</p><div className="flex gap-2"><Button variant="destructive" size="sm" disabled={busy} onClick={() => void halt(true)}>Detener</Button><Button variant="ghost" size="sm" onClick={() => setConfirmHalt(false)}>Cancelar</Button></div></div>
            : <Button variant="outline" size="sm" onClick={() => setConfirmHalt(true)}>Detener agentes</Button>}
      </>}
      {error && <p role="alert" className="text-xs text-muted-foreground">{error}</p>}
      <Button variant="ghost" size="sm" disabled={state.isFetching} onClick={() => void state.refetch()}>Actualizar</Button>
    </div>}
  </section>;
}

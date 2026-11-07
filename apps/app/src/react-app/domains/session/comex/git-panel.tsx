/** @jsxImportSource react */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { OpenworkServerClient, ComexGitWorktree } from "@/app/lib/openwork-server";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function ComexGitPanel({ client, workspaceId, sessionId }: { client: OpenworkServerClient; workspaceId: string; sessionId?: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [worktree, setWorktree] = useState<ComexGitWorktree | null>(null);
  const task = useQuery({ queryKey: ["task-continuity", client.baseUrl, workspaceId, sessionId], queryFn: () => client.getTaskContinuity(workspaceId, sessionId!), enabled: Boolean(sessionId), retry: false, refetchInterval: open && sessionId ? 3000 : false });
  const worktrees = useQuery({ queryKey: ["task-worktrees", client.baseUrl, workspaceId, sessionId], queryFn: () => client.listTaskWorktrees(workspaceId, sessionId!), enabled: Boolean(open && sessionId), retry: false });
  const change = async (action: "isolate" | "return" | "remove", path?: string, expectedHead?: string) => {
    if (!sessionId) return;
    setBusy(true); setError("");
    try { await client.changeTaskWorktree(workspaceId, sessionId, { action, ...(path ? { path } : {}), ...(expectedHead ? { expectedHead } : {}) }); await task.refetch(); await worktrees.refetch(); }
    catch (e) { setError(e instanceof Error ? e.message : "No pude cambiar el trabajo aislado. Actualizá y volvé a intentar."); }
    finally { setBusy(false); }
  };
  const review = useQuery({ queryKey: ["comex-git-review", client.baseUrl, workspaceId, sessionId], queryFn: () => client.getComexGitReview(workspaceId, sessionId), enabled: open, retry: false, staleTime: 0 });
  return <section className="border-t border-border pt-4">
    <Button variant="ghost" className="w-full justify-start" aria-expanded={open} onClick={() => setOpen(value => !value)}>{sessionId ? "Trabajo aislado y cambios" : "Revisar cambios de código"}</Button>
    {open && <div className="mt-3 space-y-3">
      {review.isLoading ? <Skeleton className="h-20 w-full" /> : review.isError ? <p role="alert" className="text-xs text-muted-foreground">No pude revisar el repositorio. Abrí su carpeta raíz y verificá Git.</p> : review.data && <>
        <p className="text-xs text-muted-foreground">{review.data.status.length ? `${review.data.status.length} entradas de cambios` : sessionId ? "Sin cambios de código" : "Sin cambios locales"}</p>
        {!!review.data.status.length && <pre className="overflow-auto whitespace-pre-wrap break-all text-xs">{review.data.status.join("\n")}</pre>}
        {!!review.data.diff && <pre aria-label="Diferencias de código" className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{review.data.diff}</pre>}
        {review.data.truncated && <p className="text-xs text-muted-foreground">La vista de diferencias está recortada. Revisá el resto con Git.</p>}
        {sessionId && task.data?.worktree && <p role="status" className="select-all break-all text-xs">Esta conversación trabaja en {task.data.worktree}</p>}
        <p className="text-xs text-muted-foreground">El trabajo aislado parte del último commit; los cambios sin commit quedan en este proyecto.</p>
        <Button variant="outline" size="sm" className="h-auto min-h-8 whitespace-normal text-left" disabled={busy || !review.data.head || review.isFetching || Boolean(sessionId && (task.isError || !task.data || task.data.status === "active" || task.data.worktree))} onClick={() => {
          const head = review.data?.head;
          if (!head) return;
          if (sessionId) { void change("isolate", undefined, head); return; }
          setBusy(true); setError("");
          void client.createComexGitWorktree(workspaceId, head).then(setWorktree).catch(() => setError("No pude crear el trabajo aislado. Actualizá la revisión y volvé a intentar.")).finally(() => setBusy(false));
        }}>{sessionId ? "Continuar este chat en trabajo aislado" : "Crear trabajo aislado"}</Button>
        {sessionId && task.data?.status === "active" && <p className="text-xs text-muted-foreground">Pausá el objetivo antes de cambiar la carpeta de trabajo.</p>}
        {sessionId && task.data?.worktree && <Button variant="outline" size="sm" className="h-auto min-h-8 whitespace-normal text-left" disabled={busy || task.data.status === "active"} onClick={() => void change("return")}>Volver al proyecto con este chat</Button>}
      </>}
      <Button variant="ghost" size="sm" disabled={review.isFetching} onClick={() => { void review.refetch(); if (sessionId) { void task.refetch(); void worktrees.refetch(); } }}>Actualizar revisión</Button>
      {sessionId && worktrees.isError && <p role="alert" className="text-xs text-muted-foreground">No pude listar los trabajos aislados. Actualizá la revisión.</p>}
      {sessionId && !!worktrees.data?.items.length && <details><summary className="cursor-pointer text-xs">Administrar trabajos aislados</summary><ul className="mt-2 space-y-2">{worktrees.data.items.map(item => <li key={item.path} className="space-y-1 border-t border-border pt-2"><p className="break-all text-xs">{item.path}</p><Button variant="outline" size="sm" className="h-auto min-h-8 whitespace-normal text-left" disabled={busy || item.locked || task.data?.worktree === item.path || task.data?.status === "active"} onClick={() => void change("remove", item.path, item.head)}>Retirar trabajo limpio e integrado</Button></li>)}</ul></details>}
      {error && <p role="alert" className="text-xs text-muted-foreground">{error}</p>}
      {worktree && <div role="status" className="space-y-1 text-xs"><p>Trabajo aislado creado. Abrí esta carpeta como un proyecto:</p><p className="select-all break-all font-mono">{worktree.path}</p></div>}
    </div>}
  </section>;
}

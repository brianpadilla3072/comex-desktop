/** @jsxImportSource react */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ISOLATION_ERROR_KEYS, isolationErrorCode, sessionIsolationSchema, type SessionIsolationClient } from "@/app/lib/task-isolation";
import { TaskIsolationReview } from "../../specialists/task-isolation-review";
import { t } from "../../../../i18n";

/** A conversation of a specialist application can continue in an isolated copy of the project;
 *  its changes reach the project only through the review (docs/features/task-isolation-review). */
export function ConversationIsolationPanel({ client, workspaceId, sessionId }: { client: SessionIsolationClient; workspaceId: string; sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = useQuery({
    queryKey: ["task-isolation-session", workspaceId, sessionId],
    queryFn: async () => sessionIsolationSchema.parse(await client.getSessionIsolation(workspaceId, sessionId)),
    enabled: open,
    retry: false,
  });
  const isolate = async () => {
    setPending(true); setError(null);
    try { await client.isolateSession(workspaceId, sessionId); await state.refetch(); }
    catch (cause) { setError(t(ISOLATION_ERROR_KEYS[isolationErrorCode(cause)] ?? "task_isolation.error_generic")); }
    finally { setPending(false); }
  };
  const isolation = state.data?.isolation ?? null;
  return <section className="border-t border-border pt-4" data-testid="conversation-isolation-panel">
    <Button variant="ghost" className="w-full justify-start" aria-expanded={open} onClick={() => setOpen(value => !value)}>{t("task_isolation.session_title")}</Button>
    {open ? <div className="mt-3 grid gap-3">
      {state.isPending ? <Skeleton className="h-16 w-full" />
        : state.isError ? <p role="alert" className="text-xs text-muted-foreground">{t(ISOLATION_ERROR_KEYS[isolationErrorCode(state.error)] ?? "task_isolation.load_error")} <Button variant="link" className="h-auto p-0 text-xs" onClick={() => void state.refetch()}>{t("task_isolation.retry")}</Button></p>
        : isolation && state.data ? <>
          <p role="status" className="text-xs text-muted-foreground">{t("task_isolation.session_active")} {t(isolation.mode === "git" ? "task_isolation.mode_git" : "task_isolation.mode_snapshot")}</p>
          <TaskIsolationReview client={client} applicationId={state.data.applicationId} isolationId={isolation.id} onFinished={() => void state.refetch()} />
        </>
        : <>
          <p className="text-xs text-muted-foreground">{t("task_isolation.session_off")}</p>
          <Button variant="outline" size="sm" className="h-auto min-h-8 justify-self-start whitespace-normal text-left" disabled={pending} onClick={() => void isolate()}>{t("task_isolation.session_start")}</Button>
        </>}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div> : null}
  </section>;
}

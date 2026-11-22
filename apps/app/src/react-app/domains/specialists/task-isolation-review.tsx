/** @jsxImportSource react */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileDiff, RefreshCw, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ISOLATION_ERROR_KEYS, formatBytes, isolationActionResultSchema, isolationDetailSchema, isolationDiffSchema, isolationErrorCode,
  type IsolationChange, type IsolationDiff, type TaskIsolationClient,
} from "@/app/lib/task-isolation";
import { t } from "../../../i18n";

/** Review of an isolated task copy (docs/features/task-isolation-review): the changed files on
 *  one side, the selected file's diff on the other; accept or discard per file or all at once. */

const detailKey = (applicationId: string, isolationId: string) => ["task-isolation", applicationId, isolationId] as const;
const errorText = (error: unknown) => t(ISOLATION_ERROR_KEYS[isolationErrorCode(error)] ?? "task_isolation.error_generic");
const TYPE_KEYS: Record<string, string> = {
  image: "task_isolation.type_image", pdf: "task_isolation.type_pdf", spreadsheet: "task_isolation.type_spreadsheet",
  document: "task_isolation.type_document", presentation: "task_isolation.type_presentation", archive: "task_isolation.type_archive",
  media: "task_isolation.type_media",
};
const typeLabel = (type: string) => t(TYPE_KEYS[type] ?? "task_isolation.type_file");

function ChangeBadge({ change }: { change: IsolationChange }) {
  if (change.conflict) return <Badge variant="outline" className="shrink-0 border-amber-7 text-amber-11"><TriangleAlert className="size-3" />{t("task_isolation.conflict_badge")}</Badge>;
  if (change.alreadyApplied) return <Badge variant="outline" className="shrink-0">{t("task_isolation.already_applied")}</Badge>;
  return <Badge variant="secondary" className="shrink-0">{t(`task_isolation.change_${change.change}`)}</Badge>;
}

function DiffView({ diff }: { diff: IsolationDiff }) {
  if (diff.kind === "binary") {
    return <div className="grid gap-1 text-xs text-muted-foreground" data-testid="task-isolation-binary">
      <p>{t("task_isolation.binary_hint", { type: typeLabel(diff.type) })}</p>
      <p>{t("task_isolation.size_change", { before: formatBytes(diff.before.size), after: formatBytes(diff.after.size) })}</p>
    </div>;
  }
  if (!diff.hunks.length) return <p className="text-xs text-muted-foreground">{diff.truncated ? t("task_isolation.truncated") : t("task_isolation.whitespace_only")}</p>;
  return <div className="grid gap-2">
    <div className="max-h-[28rem] overflow-auto rounded-md border font-mono text-xs" role="region" aria-label={t("task_isolation.diff_label", { path: diff.path })}>
      {diff.hunks.map(hunk => <div key={`${hunk.oldStart}-${hunk.newStart}`} className="border-b last:border-b-0">
        <div className="bg-muted px-2 py-0.5 text-muted-foreground">@@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@</div>
        {hunk.lines.map((line, index) => <div key={index} data-line={line.kind} className={`whitespace-pre-wrap break-all px-2 ${line.kind === "added" ? "bg-green-3 text-green-11" : line.kind === "removed" ? "bg-red-3 text-red-11" : ""}`}>
          <span aria-hidden className="mr-2 select-none text-muted-foreground">{line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}</span>{line.text || " "}
        </div>)}
      </div>)}
    </div>
    {diff.truncated ? <p className="text-xs text-muted-foreground">{t("task_isolation.truncated")}</p> : null}
  </div>;
}

export function TaskIsolationReview({ client, applicationId, isolationId, onFinished }: {
  client: TaskIsolationClient; applicationId: string; isolationId: string; onFinished?: () => void;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: detailKey(applicationId, isolationId),
    queryFn: async () => isolationDetailSchema.parse(await client.getTaskIsolation(applicationId, isolationId)),
    retry: false,
    refetchInterval: query => (query.state.data?.busy ? 5_000 : false),
  });
  const changes = detail.data?.changes ?? [];
  const current = changes.find(change => change.path === selected) ?? changes[0] ?? null;
  const diff = useQuery({
    queryKey: [...detailKey(applicationId, isolationId), "diff", current?.path ?? "", current?.size ?? null, current?.conflict ?? false],
    queryFn: async () => isolationDiffSchema.parse(await client.getTaskIsolationDiff(applicationId, isolationId, current?.path ?? "")),
    enabled: current !== null && detail.data?.isolation.status === "active",
    retry: false,
  });

  const act = async (work: () => Promise<unknown>) => {
    setPending(true); setError(null);
    try {
      const result = isolationActionResultSchema.parse(await work());
      queryClient.setQueryData(detailKey(applicationId, isolationId), { isolation: result.isolation, busy: false, changes: result.changes });
      if (result.isolation.status === "closed") onFinished?.();
    } catch (cause) {
      setError(errorText(cause));
      await detail.refetch();
    } finally { setPending(false); }
  };
  const close = async () => {
    setPending(true); setError(null);
    try { await client.closeTaskIsolation(applicationId, isolationId); await detail.refetch(); onFinished?.(); }
    catch (cause) { setError(errorText(cause)); }
    finally { setPending(false); }
  };

  if (detail.isPending) return <div role="status" aria-label={t("task_isolation.loading")} className="grid gap-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-24 w-full" /></div>;
  if (detail.isError) return <p role="alert" className="text-xs text-muted-foreground">{errorText(detail.error) === t("task_isolation.error_generic") ? t("task_isolation.load_error") : errorText(detail.error)} <Button variant="link" className="h-auto p-0 text-xs" onClick={() => void detail.refetch()}>{t("task_isolation.retry")}</Button></p>;
  const data = detail.data;
  if (data.isolation.status === "closed") return <p role="status" className="text-xs text-muted-foreground">{t("task_isolation.closed")}</p>;
  const acceptable = changes.filter(change => !change.conflict).map(change => change.path);
  const conflicts = changes.filter(change => change.conflict).length;
  const locked = pending || data.busy;

  return <div className="grid min-w-0 gap-3" data-testid="task-isolation-review">
    <div className="flex flex-wrap items-center gap-2">
      <p className="min-w-0 flex-1 text-xs text-muted-foreground">{changes.length ? t("task_isolation.summary", { count: changes.length }) : t("task_isolation.no_changes")}{conflicts ? ` ${t("task_isolation.summary_conflicts", { count: conflicts })}` : ""}</p>
      <Button size="icon-sm" variant="ghost" aria-label={t("task_isolation.refresh")} disabled={detail.isFetching} onClick={() => void detail.refetch()}><RefreshCw className={detail.isFetching ? "animate-spin" : ""} /></Button>
    </div>
    {data.busy ? <p role="status" className="text-xs text-muted-foreground">{t("task_isolation.busy")}</p> : null}
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    {changes.length ? <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <ul aria-label={t("task_isolation.file_list_label")} className="grid content-start gap-1">
        {changes.map(change => <li key={change.path} className={`grid gap-1 rounded-md px-2 py-1.5 ${current?.path === change.path ? "bg-muted" : ""}`} data-change-path={change.path}>
          <button type="button" className="flex min-w-0 items-center gap-2 text-left text-xs" aria-pressed={current?.path === change.path} onClick={() => setSelected(change.path)}>
            <FileDiff className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate" title={change.path}>{change.path}</span>
            <ChangeBadge change={change} />
          </button>
          <div className="flex flex-wrap gap-1 pl-6">
            {change.conflict
              ? <Button size="sm" variant="outline" disabled={locked} onClick={() => void act(() => client.acceptTaskIsolationFiles(applicationId, isolationId, [change.path], true))}>{t("task_isolation.overwrite")}</Button>
              : <Button size="sm" variant="outline" disabled={locked} onClick={() => void act(() => client.acceptTaskIsolationFiles(applicationId, isolationId, [change.path]))}>{t("task_isolation.accept")}</Button>}
            <Button size="sm" variant="ghost" disabled={locked} onClick={() => void act(() => client.discardTaskIsolationFiles(applicationId, isolationId, [change.path]))}>{t("task_isolation.discard")}</Button>
          </div>
        </li>)}
      </ul>
      <section className="grid min-w-0 content-start gap-2" aria-live="polite">
        {current ? <>
          <h3 className="truncate text-sm font-medium" title={current.path}>{current.path}</h3>
          {current.conflict ? <p className="text-xs text-amber-11">{t("task_isolation.conflict_hint")}</p> : null}
          {diff.isPending ? <Skeleton className="h-24 w-full" />
            : diff.isError ? <p role="alert" className="text-xs text-muted-foreground">{t("task_isolation.diff_error")} <Button variant="link" className="h-auto p-0 text-xs" onClick={() => void diff.refetch()}>{t("task_isolation.retry")}</Button></p>
            : <DiffView diff={diff.data} />}
        </> : <p className="text-xs text-muted-foreground">{t("task_isolation.select_file")}</p>}
      </section>
    </div> : null}
    <div className="flex flex-wrap gap-2 border-t pt-3">
      {acceptable.length ? <Button size="sm" disabled={locked} onClick={() => void act(() => client.acceptTaskIsolationFiles(applicationId, isolationId, acceptable))}>{t("task_isolation.accept_all", { count: acceptable.length })}</Button> : null}
      {changes.length ? <Button size="sm" variant="outline" disabled={locked} onClick={() => void act(() => client.discardTaskIsolationFiles(applicationId, isolationId, changes.map(change => change.path)))}>{t("task_isolation.discard_all")}</Button> : null}
      {data.isolation.origin.kind === "session" || !changes.length ? <Button size="sm" variant="ghost" disabled={locked} onClick={() => void close()}>{changes.length ? t("task_isolation.finish_discard") : t("task_isolation.finish")}</Button> : null}
    </div>
  </div>;
}

/** The review in a dialog, opened from a task run. */
export function TaskIsolationReviewDialog({ client, applicationId, isolationId, title, onOpenChange }: {
  client: TaskIsolationClient; applicationId: string; isolationId: string | null; title: string; onOpenChange: (open: boolean) => void;
}) {
  return <Dialog open={isolationId !== null} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90vh] w-[min(64rem,calc(100vw-2rem))] max-w-none overflow-y-auto sm:max-w-none">
      <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
      {isolationId ? <TaskIsolationReview client={client} applicationId={applicationId} isolationId={isolationId} /> : null}
    </DialogContent>
  </Dialog>;
}

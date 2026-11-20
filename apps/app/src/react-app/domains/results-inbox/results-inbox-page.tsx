/** @jsxImportSource react */
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCheck, ExternalLink, FileDiff, FileText, Mail, MailOpen, RefreshCw } from "lucide-react";

import { t } from "@/i18n";
import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import type { TaskIsolationClient } from "@/app/lib/task-isolation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { MarkdownPreview } from "@/react-app/domains/session/artifacts/preview";
import { TaskIsolationReviewDialog } from "@/react-app/domains/specialists/task-isolation-review";
import { workspaceSessionRoute } from "@/react-app/shell/workspace-routes";

import {
  RESULTS_INBOX_FILTERS, filterResultsInbox, groupResultsInboxByDay, needsReview, primaryResultsInboxAction, resultsInboxActions,
  resultsInboxStatus, resultsInboxTime,
  type ResultsInboxAction, type ResultsInboxFilter, type ResultsInboxItem, type ResultsInboxOutput, type ResultsInboxSnapshot,
} from "./results-inbox-model";
import { useResultsInboxConnection, useResultsInboxSeen, useResultsInboxSnapshot, type ResultsInboxClient } from "./use-results-inbox";

export type ResultsInboxPageClient = ResultsInboxClient & TaskIsolationClient & Pick<OpenworkServerClient, "getSpecialistOutput" | "getArtifact">;

type Notice = { tone: "info" | "error"; text: string };
type Review = { applicationId: string; isolationId: string; title: string };
type OpenOutput = { applicationId: string; output: ResultsInboxOutput };

const FILTER_LABEL: Record<ResultsInboxFilter, string> = {
  all: "results_inbox.filter_all",
  review: "results_inbox.filter_review",
  failed: "results_inbox.filter_failed",
};

const ACTION_LABEL: Record<ResultsInboxAction, string> = {
  review: "results_inbox.action_review",
  open: "results_inbox.action_open",
  output: "results_inbox.action_output",
};

const PROBLEM_LABEL: Record<ResultsInboxSnapshot["problems"][number]["source"], string> = {
  applications: "results_inbox.problem_applications",
  tasks: "results_inbox.problem_tasks",
  outputs: "results_inbox.problem_outputs",
  seen: "results_inbox.problem_seen",
};

function errorText(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : t("results_inbox.unknown_error");
}

/** Route entry: resolves the owner connection, then shows the inbox. */
export function ResultsInboxPage() {
  const navigate = useNavigate();
  const connection = useResultsInboxConnection();
  const client = connection.data;
  if (connection.isPending) return <ResultsInboxFrame><ResultsInboxSkeleton /></ResultsInboxFrame>;
  if (!client) {
    return <ResultsInboxFrame>
      <ResultsInboxError message={connection.error ? errorText(connection.error) : t("results_inbox.unknown_error")} onRetry={() => void connection.refetch()} />
    </ResultsInboxFrame>;
  }
  return <ResultsInboxPanel client={client} active onOpenSession={(workspaceId, sessionId) => navigate(workspaceSessionRoute(workspaceId, sessionId))} />;
}

export function ResultsInboxPanel({ client, active, onOpenSession }: {
  client: ResultsInboxPageClient;
  active: boolean;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
}) {
  const query = useResultsInboxSnapshot(client, active);
  const seen = useResultsInboxSeen(client);
  const [filter, setFilter] = useState<ResultsInboxFilter>("all");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [openOutput, setOpenOutput] = useState<OpenOutput | null>(null);

  const changeSeen = async (ids: string[], value: boolean) => {
    setNotice(null);
    try {
      await seen.setSeen(ids, value);
    } catch (error) {
      setNotice({ tone: "error", text: t("results_inbox.seen_failed", { message: errorText(error) }) });
    }
  };

  const markOpened = (item: ResultsInboxItem) => {
    if (!item.seen) void changeSeen([item.id], true);
  };

  const runAction = (item: ResultsInboxItem, action: ResultsInboxAction) => {
    markOpened(item);
    if (action === "review" && item.isolation) {
      setReview({ applicationId: item.applicationId, isolationId: item.isolation.id, title: t("results_inbox.review_title", { name: item.taskName }) });
    } else if (action === "open" && item.workspaceId && item.sessionId) {
      onOpenSession(item.workspaceId, item.sessionId);
    } else if (action === "output" && item.outputs[0]) {
      setOpenOutput({ applicationId: item.applicationId, output: item.outputs[0] });
    }
  };

  const markAll = async () => {
    const snapshot = query.data;
    if (!snapshot) return;
    setNotice(null);
    try {
      await seen.setAllSeen(snapshot.generatedAt);
      setNotice({ tone: "info", text: t("results_inbox.all_seen") });
    } catch (error) {
      setNotice({ tone: "error", text: t("results_inbox.seen_failed", { message: errorText(error) }) });
    }
  };

  const unseen = query.data?.counts.unseen ?? 0;
  return <ResultsInboxFrame
    toolbar={<div className="flex flex-wrap gap-1.5">
      <Button variant="outline" size="sm" data-results-inbox-mark-all onClick={() => void markAll()} disabled={!query.data || unseen === 0}>
        <CheckCheck className="size-4" aria-hidden />
        <span className="max-sm:sr-only">{t("results_inbox.mark_all_seen")}</span>
      </Button>
      <Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching} aria-label={query.isFetching ? t("results_inbox.refreshing") : t("results_inbox.refresh")}>
        <RefreshCw className={cn("size-4", query.isFetching && "motion-safe:animate-spin")} aria-hidden />
        <span className="max-sm:sr-only">{query.isFetching ? t("results_inbox.refreshing") : t("results_inbox.refresh")}</span>
      </Button>
    </div>}
  >
    {notice ? <p role={notice.tone === "error" ? "alert" : "status"} className={cn("rounded-lg border border-border px-3 py-2 text-sm", notice.tone === "error" && "text-destructive")}>{notice.text}</p> : null}
    <ResultsInboxBody
      snapshot={query.data ?? null}
      loading={query.isPending}
      error={query.isError ? errorText(query.error) : null}
      filter={filter}
      now={Date.now()}
      onFilter={setFilter}
      onRetryLoad={() => void query.refetch()}
      onAction={runAction}
      onOutput={(item, output) => { markOpened(item); setOpenOutput({ applicationId: item.applicationId, output }); }}
      onToggleSeen={item => void changeSeen([item.id], !item.seen)}
    />
    <TaskIsolationReviewDialog
      client={client}
      applicationId={review?.applicationId ?? ""}
      isolationId={review?.isolationId ?? null}
      title={review?.title ?? ""}
      onOpenChange={open => { if (!open) { setReview(null); void query.refetch(); } }}
    />
    <ResultsInboxOutputDialog client={client} target={openOutput} onClose={() => setOpenOutput(null)} />
  </ResultsInboxFrame>;
}

function ResultsInboxFrame({ toolbar, children }: { toolbar?: ReactNode; children: ReactNode }) {
  return <main data-results-inbox className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-4 overflow-y-auto p-3 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h1 className="text-base font-semibold tracking-tight">{t("results_inbox.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("results_inbox.subtitle")}</p>
      </div>
      {toolbar}
    </header>
    {children}
  </main>;
}

function ResultsInboxSkeleton() {
  return <div aria-busy="true" aria-label={t("results_inbox.loading")} className="flex flex-col gap-2">
    {[0, 1, 2].map(index => <Skeleton key={index} className="h-20 w-full rounded-xl" />)}
  </div>;
}

function ResultsInboxError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div role="alert" data-results-inbox-error className="flex flex-col items-start gap-2 rounded-xl border border-border p-4">
    <p className="flex items-center gap-2 text-sm font-medium"><AlertTriangle className="size-4 text-destructive" aria-hidden />{t("results_inbox.error_title")}</p>
    <p className="text-sm text-muted-foreground">{t("results_inbox.error_body", { message })}</p>
    <Button variant="outline" size="sm" onClick={onRetry}>{t("results_inbox.retry_load")}</Button>
  </div>;
}

export function ResultsInboxBody({ snapshot, loading, error, filter, now, onFilter, onRetryLoad, onAction, onOutput, onToggleSeen }: {
  snapshot: ResultsInboxSnapshot | null;
  loading: boolean;
  error: string | null;
  filter: ResultsInboxFilter;
  now: number;
  onFilter: (filter: ResultsInboxFilter) => void;
  onRetryLoad: () => void;
  onAction: (item: ResultsInboxItem, action: ResultsInboxAction) => void;
  onOutput: (item: ResultsInboxItem, output: ResultsInboxOutput) => void;
  onToggleSeen: (item: ResultsInboxItem) => void;
}) {
  // A failed read with nothing known yet is an error, never "no results".
  if (!snapshot) return loading && !error ? <ResultsInboxSkeleton /> : <ResultsInboxError message={error ?? t("results_inbox.unknown_error")} onRetry={onRetryLoad} />;
  const visible = filterResultsInbox(snapshot.items, filter);
  const days = groupResultsInboxByDay(visible, now);
  const time = new Date(snapshot.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const count: Record<ResultsInboxFilter, number> = { all: snapshot.counts.total, review: snapshot.counts.needsReview, failed: snapshot.counts.failed };
  return <div className="flex flex-col gap-4">
    {error ? <p role="alert" data-results-inbox-stale className="rounded-lg border border-amber-6/40 bg-amber-3/60 px-3 py-2 text-sm text-amber-11">{t("results_inbox.stale", { time, message: error })}</p> : null}
    {!snapshot.complete ? <div role="status" data-results-inbox-incomplete className="rounded-lg border border-amber-6/40 bg-amber-3/60 px-3 py-2 text-sm text-amber-11">
      <p>{t("results_inbox.incomplete")}</p>
      <ul className="mt-1 list-disc ps-5">
        {snapshot.problems.map((problem, index) => <li key={`${problem.source}:${problem.id ?? index}`}>
          {t(PROBLEM_LABEL[problem.source], { label: problem.label })}
        </li>)}
      </ul>
    </div> : null}
    <div role="group" aria-label={t("results_inbox.filter_label")} className="flex flex-wrap gap-1.5">
      {RESULTS_INBOX_FILTERS.map(option => <Button key={option} size="sm" variant={filter === option ? "secondary" : "ghost"}
        data-results-inbox-filter={option} aria-pressed={filter === option} onClick={() => onFilter(option)}>
        {t(FILTER_LABEL[option])} <span className="tabular-nums text-muted-foreground">{count[option]}</span>
      </Button>)}
    </div>
    <p aria-live="polite" className="text-sm text-muted-foreground">{t("results_inbox.summary", { unseen: snapshot.counts.unseen, review: snapshot.counts.needsReview, failed: snapshot.counts.failed })}</p>
    {visible.length === 0 ? <div data-results-inbox-empty className="rounded-xl border border-dashed border-border p-6 text-center">
      {!snapshot.complete ? <p className="text-sm text-muted-foreground">{t("results_inbox.empty_incomplete")}</p>
        : snapshot.items.length > 0 ? <p className="text-sm text-muted-foreground">{t("results_inbox.empty_filter")}</p>
        : <>
          <p className="text-sm font-medium">{t("results_inbox.empty_title")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("results_inbox.empty_body")}</p>
        </>}
    </div> : null}
    {days.map(day => <section key={day.key} aria-labelledby={`results-inbox-day-${day.key}`} className="flex flex-col gap-2">
      <h2 id={`results-inbox-day-${day.key}`} className="text-xs font-semibold text-muted-foreground first-letter:uppercase">{day.label}</h2>
      <ul aria-label={day.label} className="flex flex-col gap-2">
        {day.items.map(item => <ResultsInboxRow key={item.id} item={item} onAction={onAction} onOutput={onOutput} onToggleSeen={onToggleSeen} />)}
      </ul>
    </section>)}
  </div>;
}

function ResultsInboxRow({ item, onAction, onOutput, onToggleSeen }: {
  item: ResultsInboxItem;
  onAction: (item: ResultsInboxItem, action: ResultsInboxAction) => void;
  onOutput: (item: ResultsInboxItem, output: ResultsInboxOutput) => void;
  onToggleSeen: (item: ResultsInboxItem) => void;
}) {
  const status = resultsInboxStatus(item);
  const primary = primaryResultsInboxAction(item);
  const place = [item.applicationName, item.workspaceName].filter((value): value is string => Boolean(value));
  const mode = t(item.mode === "manual" ? "results_inbox.mode_manual" : "results_inbox.mode_scheduled");
  return <li data-results-inbox-item={item.id} data-status={item.status} data-seen={item.seen ? "true" : "false"}
    className={cn("flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-start sm:justify-between", !item.seen && "bg-muted/40")}>
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {!item.seen ? <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden /> : null}
        {primary ? <button type="button" data-results-inbox-open className="min-w-0 truncate text-start text-sm font-medium underline-offset-2 hover:underline focus-visible:underline"
          title={item.taskName} aria-label={t("results_inbox.action_label", { action: t(ACTION_LABEL[primary]), name: item.taskName })}
          onClick={() => onAction(item, primary)}>{item.taskName}</button>
          : <span className="min-w-0 truncate text-sm font-medium" title={item.taskName}>{item.taskName}</span>}
        {!item.seen ? <span className="sr-only">{t("results_inbox.unread")}</span> : null}
        <Badge variant={status.tone === "danger" ? "destructive" : "outline"} className={status.tone === "muted" ? "text-muted-foreground" : undefined} data-results-inbox-status>{status.label}</Badge>
        {needsReview(item) ? <Badge variant="outline" className="border-amber-6/40 bg-amber-3/60 text-amber-11" data-results-inbox-review>{t("results_inbox.review_pending")}</Badge> : null}
        {item.isolation?.review === "reviewed" ? <Badge variant="outline" className="text-muted-foreground">{t("results_inbox.review_done")}</Badge> : null}
      </div>
      <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
        {place.map((value, index) => <span key={`${index}:${value}`}>{index > 0 ? "· " : ""}{value}</span>)}
        <span>· {mode}</span>
        <span>· {resultsInboxTime(item)}</span>
      </p>
      {item.detail ? <p className="break-words text-xs text-destructive">{item.detail}</p> : null}
      {item.outputs.length > 0 ? <div className="flex flex-col gap-1">
        <p className="text-xs font-medium text-muted-foreground">{t("results_inbox.outputs")}</p>
        <ul className="flex flex-wrap gap-1.5">
          {item.outputs.map(output => <li key={`${output.kind}:${output.id}`}>
            <Button size="sm" variant="ghost" className="h-auto max-w-full px-2 py-1 text-xs" data-results-inbox-output={output.id}
              aria-label={t("results_inbox.output_label", { name: output.title })} onClick={() => onOutput(item, output)}>
              <FileText className="size-3.5" aria-hidden /><span className="truncate">{output.title}</span>
            </Button>
          </li>)}
        </ul>
      </div> : null}
    </div>
    <div className="flex shrink-0 flex-wrap gap-1.5">
      {resultsInboxActions(item).map(action => <Button key={action} size="sm" variant={action === "review" ? "default" : "outline"}
        data-results-inbox-action={action}
        aria-label={t("results_inbox.action_label", { action: t(ACTION_LABEL[action]), name: item.taskName })}
        onClick={() => onAction(item, action)}>
        {action === "review" ? <FileDiff className="size-4" aria-hidden /> : <ExternalLink className="size-4" aria-hidden />}{t(ACTION_LABEL[action])}
      </Button>)}
      <Button size="sm" variant="ghost" data-results-inbox-toggle-seen
        aria-label={t(item.seen ? "results_inbox.mark_unseen_label" : "results_inbox.mark_seen_label", { name: item.taskName })}
        onClick={() => onToggleSeen(item)}>
        {item.seen ? <Mail className="size-4" aria-hidden /> : <MailOpen className="size-4" aria-hidden />}
        <span className="max-sm:sr-only">{t(item.seen ? "results_inbox.mark_unseen" : "results_inbox.mark_seen")}</span>
      </Button>
    </div>
  </li>;
}

const MARKDOWN_TYPES = new Set(["report", "mindmap", "doc"]);

function ResultsInboxOutputDialog({ client, target, onClose }: {
  client: Pick<OpenworkServerClient, "baseUrl" | "getSpecialistOutput" | "getArtifact">;
  target: OpenOutput | null;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: ["results-inbox-output", client.baseUrl, target?.applicationId, target?.output.kind, target?.output.workspaceId, target?.output.id],
    queryFn: async () => {
      if (!target) throw new Error("No output");
      const { applicationId, output } = target;
      if (output.kind === "artifact") {
        const record = await client.getArtifact(applicationId, output.id, output.workspaceId);
        return { content: record.content, truncated: record.truncated };
      }
      const record = await client.getSpecialistOutput(applicationId, output.id, output.workspaceId);
      return { content: record.content, truncated: record.truncated };
    },
    enabled: target !== null,
    retry: false,
  });
  return <Dialog open={target !== null} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[90vh] w-[min(48rem,calc(100vw-2rem))] max-w-none overflow-y-auto sm:max-w-none">
      <DialogHeader><DialogTitle>{target?.output.title ?? ""}</DialogTitle></DialogHeader>
      {query.isPending ? <Skeleton className="h-24 w-full" />
        : query.isError ? <div role="alert" className="flex flex-col items-start gap-2 text-sm">
          <p className="text-destructive">{t("results_inbox.output_error", { message: errorText(query.error) })}</p>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>{t("results_inbox.retry_load")}</Button>
        </div>
        : <div className="flex flex-col gap-2">
          {target && MARKDOWN_TYPES.has(target.output.type)
            ? <div className="text-sm"><MarkdownPreview content={query.data.content} /></div>
            : <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-xs">{query.data.content}</pre>}
          {query.data.truncated ? <p className="text-xs text-muted-foreground">{t("results_inbox.output_truncated")}</p> : null}
        </div>}
    </DialogContent>
  </Dialog>;
}

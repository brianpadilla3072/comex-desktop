/** @jsxImportSource react */
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { AlertTriangle, ExternalLink, Play, RefreshCw, RotateCcw, Square, type LucideIcon } from "lucide-react";

import { t } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { workspaceSessionRoute } from "@/react-app/shell/workspace-routes";

import {
  commandCenterActions, commandCenterStatus, commandCenterTiming, commandCenterTitle, groupCommandCenterItems,
  type CommandCenterAction, type CommandCenterItem, type CommandCenterSection, type CommandCenterSnapshot, type CommandCenterTone,
} from "./command-center-model";
import { useCommandCenterConnection, useCommandCenterSnapshot, useNow, type CommandCenterClient } from "./use-command-center";

type Notice = { tone: "info" | "error"; text: string };

const SECTION_TITLE: Record<CommandCenterSection, string> = {
  waiting: "command_center.section_waiting",
  running: "command_center.section_running",
  recent: "command_center.section_recent",
};

const TONE_CLASS: Record<CommandCenterTone, string> = {
  attention: "border-amber-6/40 bg-amber-3/60 text-amber-11",
  danger: "",
  neutral: "",
  muted: "text-muted-foreground",
};

const ACTION_ICON = { open: ExternalLink, stop: Square, retry: RotateCcw, run_now: Play } satisfies Record<CommandCenterAction, LucideIcon>;
const ACTION_LABEL: Record<CommandCenterAction, string> = {
  open: "command_center.action_open",
  stop: "command_center.action_stop",
  retry: "command_center.action_retry",
  run_now: "command_center.action_run_now",
};

function errorText(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : t("command_center.unknown_error");
}

/** Route entry: resolves the owner connection, then shows the panel. */
export function CommandCenterPage() {
  const navigate = useNavigate();
  const connection = useCommandCenterConnection();
  const client = connection.data;
  if (connection.isPending) return <CommandCenterFrame><CommandCenterSkeleton /></CommandCenterFrame>;
  if (!client) {
    return <CommandCenterFrame>
      <CommandCenterError message={connection.error ? errorText(connection.error) : t("command_center.unknown_error")} onRetry={() => void connection.refetch()} />
    </CommandCenterFrame>;
  }
  return <CommandCenterPanel client={client} active onOpenSession={(workspaceId, sessionId) => navigate(workspaceSessionRoute(workspaceId, sessionId))} />;
}

export function CommandCenterPanel({ client, active, onOpenSession }: {
  client: CommandCenterClient;
  active: boolean;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
}) {
  const query = useCommandCenterSnapshot(client, active);
  const now = useNow(active);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const runAction = async (item: CommandCenterItem, action: CommandCenterAction) => {
    if (action === "open") {
      if (item.workspaceId && item.sessionId) onOpenSession(item.workspaceId, item.sessionId);
      return;
    }
    setPending(`${item.id}:${action}`);
    setNotice(null);
    try {
      if (action === "stop") {
        if (!item.workspaceId || !item.sessionId) return;
        const result = await client.stopCommandCenterSession(item.workspaceId, item.sessionId);
        setNotice({ tone: "info", text: result.stopped ? t("command_center.stopped") : t("command_center.stop_noop") });
      } else if (item.kind === "task") {
        const result = await client.runSpecialistTaskNow(item.applicationId, item.taskId);
        setNotice(result.started
          ? { tone: "info", text: t("command_center.started") }
          : { tone: "error", text: t("command_center.not_started", { message: result.detail ?? t("command_center.unknown_error") }) });
      }
    } catch (error) {
      setNotice({ tone: "error", text: t("command_center.action_failed", { message: errorText(error) }) });
    } finally {
      setPending(null);
      void query.refetch();
    }
  };

  return <CommandCenterFrame
    toolbar={<Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching} aria-label={query.isFetching ? t("command_center.refreshing") : t("command_center.refresh")}>
      <RefreshCw className={cn("size-4", query.isFetching && "motion-safe:animate-spin")} aria-hidden />
      <span className="max-sm:sr-only">{query.isFetching ? t("command_center.refreshing") : t("command_center.refresh")}</span>
    </Button>}
  >
    {notice ? <p role={notice.tone === "error" ? "alert" : "status"} className={cn("rounded-lg border border-border px-3 py-2 text-sm", notice.tone === "error" && "text-destructive")}>{notice.text}</p> : null}
    <CommandCenterBody
      snapshot={query.data ?? null}
      loading={query.isPending}
      error={query.isError ? errorText(query.error) : null}
      now={now}
      pending={pending}
      onRetryLoad={() => void query.refetch()}
      onAction={(item, action) => void runAction(item, action)}
    />
  </CommandCenterFrame>;
}

function CommandCenterFrame({ toolbar, children }: { toolbar?: ReactNode; children: ReactNode }) {
  return <main data-command-center className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-4 overflow-y-auto p-3 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h1 className="text-base font-semibold tracking-tight">{t("command_center.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("command_center.subtitle")}</p>
      </div>
      {toolbar}
    </header>
    {children}
  </main>;
}

function CommandCenterSkeleton() {
  return <div aria-busy="true" aria-label={t("command_center.loading")} className="flex flex-col gap-2">
    {[0, 1, 2].map(index => <Skeleton key={index} className="h-20 w-full rounded-xl" />)}
  </div>;
}

function CommandCenterError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div role="alert" data-command-center-error className="flex flex-col items-start gap-2 rounded-xl border border-border p-4">
    <p className="flex items-center gap-2 text-sm font-medium"><AlertTriangle className="size-4 text-destructive" aria-hidden />{t("command_center.error_title")}</p>
    <p className="text-sm text-muted-foreground">{t("command_center.error_body", { message })}</p>
    <Button variant="outline" size="sm" onClick={onRetry}>{t("command_center.retry_load")}</Button>
  </div>;
}

export function CommandCenterBody({ snapshot, loading, error, now, pending, onRetryLoad, onAction }: {
  snapshot: CommandCenterSnapshot | null;
  loading: boolean;
  error: string | null;
  now: number;
  pending: string | null;
  onRetryLoad: () => void;
  onAction: (item: CommandCenterItem, action: CommandCenterAction) => void;
}) {
  // A failed check with nothing known yet is an error, never "nothing running".
  if (!snapshot) return loading && !error ? <CommandCenterSkeleton /> : <CommandCenterError message={error ?? t("command_center.unknown_error")} onRetry={onRetryLoad} />;
  const groups = groupCommandCenterItems(snapshot.items);
  const time = new Date(snapshot.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return <div className="flex flex-col gap-4">
    {error ? <p role="alert" data-command-center-stale className="rounded-lg border border-amber-6/40 bg-amber-3/60 px-3 py-2 text-sm text-amber-11">{t("command_center.stale", { time, message: error })}</p> : null}
    {!snapshot.complete ? <div role="status" data-command-center-incomplete className="rounded-lg border border-amber-6/40 bg-amber-3/60 px-3 py-2 text-sm text-amber-11">
      <p>{t("command_center.incomplete")}</p>
      <ul className="mt-1 list-disc ps-5">
        {snapshot.problems.map((problem, index) => <li key={`${problem.source}:${problem.id ?? index}`}>
          {problem.source === "workspace" ? t("command_center.problem", { label: problem.label, message: problem.message }) : t("command_center.problem_tasks", { message: problem.message })}
        </li>)}
      </ul>
    </div> : null}
    <p aria-live="polite" className="text-sm text-muted-foreground">{t("command_center.summary", { running: snapshot.counts.running, waiting: snapshot.counts.waiting, failed: snapshot.counts.failed })}</p>
    {snapshot.items.length === 0 ? <div data-command-center-empty className="rounded-xl border border-dashed border-border p-6 text-center">
      {snapshot.complete ? <>
        <p className="text-sm font-medium">{t("command_center.empty_title")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t("command_center.empty_body")}</p>
      </> : <p className="text-sm text-muted-foreground">{t("command_center.empty_incomplete")}</p>}
    </div> : null}
    {(["waiting", "running", "recent"] satisfies CommandCenterSection[]).map(section => groups[section].length ? <section key={section} aria-labelledby={`command-center-${section}`} className="flex flex-col gap-2">
      <h2 id={`command-center-${section}`} className="text-xs font-semibold text-muted-foreground">{t(SECTION_TITLE[section])}</h2>
      <ul aria-label={t("command_center.list_label")} className="flex flex-col gap-2">
        {groups[section].map(item => <CommandCenterRow key={item.id} item={item} now={now} pending={pending} onAction={onAction} />)}
      </ul>
    </section> : null)}
  </div>;
}

function CommandCenterRow({ item, now, pending, onAction }: {
  item: CommandCenterItem; now: number; pending: string | null;
  onAction: (item: CommandCenterItem, action: CommandCenterAction) => void;
}) {
  const status = commandCenterStatus(item);
  const title = commandCenterTitle(item);
  const timing = commandCenterTiming(item, now);
  const place = [item.workspaceName, item.applicationName].filter((value): value is string => Boolean(value));
  const model = item.model ? `${item.model.providerID}/${item.model.modelID}` : t("command_center.model_default");
  const kind = item.kind === "task" ? t("command_center.kind_task") : t("command_center.kind_chat");
  const mode = item.kind === "task" && item.mode ? t(item.mode === "manual" ? "command_center.mode_manual" : "command_center.mode_scheduled") : null;
  return <li data-command-center-item={item.id} data-status={item.status} className="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-start sm:justify-between">
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="min-w-0 truncate text-sm font-medium" title={title}>{title}</span>
        <Badge variant={status.tone === "danger" ? "destructive" : "outline"} className={TONE_CLASS[status.tone]} data-command-center-status>{status.label}</Badge>
      </div>
      <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
        <span>{kind}</span>
        {place.map(value => <span key={value}>· {value}</span>)}
        <span className="font-mono">· {model}</span>
        {mode ? <span>· {mode}</span> : null}
        {timing ? <span>· {timing}</span> : null}
        {item.kind === "session" && item.subtasks > 0 ? <span>· {t("command_center.subtasks", { count: item.subtasks })}</span> : null}
      </p>
      {item.lastError ? <p className="break-words text-xs text-destructive">{t("command_center.last_error", { message: item.lastError })}</p> : null}
    </div>
    <div className="flex shrink-0 flex-wrap gap-1.5">
      {commandCenterActions(item).map(action => {
        const Icon = ACTION_ICON[action];
        const label = t(ACTION_LABEL[action]);
        return <Button key={action} size="sm" variant={action === "stop" ? "destructive" : "outline"}
          data-command-center-action={action}
          disabled={pending !== null && pending.startsWith(`${item.id}:`)}
          aria-label={t("command_center.action_label", { action: label, name: title })}
          onClick={() => onAction(item, action)}>
          <Icon className="size-4" aria-hidden />{label}
        </Button>;
      })}
    </div>
  </li>;
}

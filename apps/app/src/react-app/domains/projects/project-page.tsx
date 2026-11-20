/** @jsxImportSource react */
import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookText, Brain, CalendarClock, ChevronRight, FolderOpen, Lock, MessageSquare, Pencil } from "lucide-react";

import { OpenworkServerError } from "@/app/lib/openwork-server";
import { PROJECT_LIMITS, type ProjectDetail } from "@/app/lib/projects";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import { PairDeviceHint } from "@/react-app/shell/pair-device-hint";

import { ProjectContextDialog } from "./project-context-dialog";
import { ProjectInstructionsDialog } from "./project-instructions-dialog";
import { ProjectMemoryDialog } from "./project-memory-dialog";
import { projectQueryKeys, useProjectPageConnection, type ProjectPageClient } from "./project-page-data";
import { formatRelative, projectErrorText } from "./project-page-model";
import { PROJECTS_ROUTE } from "./projects-list-model";
import { projectsListQueryKey } from "./use-projects-list";
import { ProjectTasksDialog, type ProjectTasksView } from "./project-tasks-dialog";

type OpenDialog = { kind: "instructions" } | { kind: "context" } | { kind: "memory" } | { kind: "tasks"; view: ProjectTasksView } | null;

/** Long descriptions fold to three lines behind "Mostrar más". */
const DESCRIPTION_FOLD_CHARS = 240;
const descriptionIsLong = (text: string) => text.length > DESCRIPTION_FOLD_CHARS || text.split("\n").length > 3;

export type ProjectPageProps = {
  workspaceId: string;
  /** The app's new-session composer bound to this project's workspace (null while it is not known locally). */
  composer: ReactNode;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
};

/** Route entry of `/projects/:workspaceId`: resolves the owner connection, then shows the project. */
export function ProjectPage(props: ProjectPageProps) {
  const connection = useProjectPageConnection();
  const client = connection.data;
  if (connection.isPending) return <ProjectPageFrame><ProjectPageSkeleton /></ProjectPageFrame>;
  if (!client) {
    return <ProjectPageFrame>
      <ProjectPageError message={t("projects_ui.page.error.connection")} onRetry={() => void connection.refetch()} />
    </ProjectPageFrame>;
  }
  return <ProjectPagePanel client={client} {...props} />;
}

export function ProjectPagePanel({ client, workspaceId, composer, onOpenSession }: ProjectPageProps & { client: ProjectPageClient }) {
  const query = useQuery({
    queryKey: projectQueryKeys.detail(client.baseUrl, workspaceId),
    queryFn: () => client.getProject(workspaceId),
    retry: false,
    refetchOnWindowFocus: true,
  });
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const close = (open: boolean) => { if (!open) setDialog(null); };

  if (query.isPending) return <ProjectPageFrame><ProjectPageSkeleton /></ProjectPageFrame>;
  if (query.isError || !query.data) {
    const missing = query.error instanceof OpenworkServerError && query.error.code === "project_not_found";
    return <ProjectPageFrame>
      <ProjectPageError message={missing ? t("projects_ui.page.error.project_not_found") : projectErrorText(query.error, "projects_ui.page.load_failed")}
        onRetry={missing ? undefined : () => void query.refetch()} />
    </ProjectPageFrame>;
  }
  const project = query.data;

  return <ProjectPageFrame name={project.name}>
    {!project.writable ? <p role="note" data-project-read-only className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
      <Lock className="size-3.5" aria-hidden />{t("projects_ui.page.read_only")} <PairDeviceHint />
    </p> : null}
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)]">
      <div className="grid min-w-0 content-start gap-6">
        <ProjectHeader client={client} project={project} />
        <section aria-labelledby={`${project.workspaceId}-composer`} data-project-composer className="grid gap-2">
          <h2 id={`${project.workspaceId}-composer`} className="text-sm font-medium">{t("projects_ui.page.new_session_in", { name: project.name })}</h2>
          {composer ?? <p className="text-sm text-muted-foreground">{t("projects_ui.page.composer_unavailable")}</p>}
        </section>
        <ProjectRecents project={project} onOpenSession={sessionId => onOpenSession(project.workspaceId, sessionId)} onRetry={() => void query.refetch()} retrying={query.isFetching} />
      </div>
      <ProjectSideRows project={project} onOpen={setDialog} />
    </div>

    <ProjectInstructionsDialog client={client} workspaceId={project.workspaceId} writable={project.writable} open={dialog?.kind === "instructions"} onOpenChange={close} />
    <ProjectContextDialog client={client} workspaceId={project.workspaceId} writable={project.writable} open={dialog?.kind === "context"} onOpenChange={close} />
    <ProjectMemoryDialog client={client} workspaceId={project.workspaceId} writable={project.writable} open={dialog?.kind === "memory"} onOpenChange={close} />
    <ProjectTasksDialog client={client} workspaceId={project.workspaceId} applicationId={project.applicationId} writable={project.writable}
      open={dialog?.kind === "tasks"} initialView={dialog?.kind === "tasks" ? dialog.view : "list"} onOpenChange={close}
      onOpenSession={(targetWorkspace, sessionId) => { setDialog(null); onOpenSession(targetWorkspace, sessionId); }} />
  </ProjectPageFrame>;
}

function ProjectPageFrame({ name, children }: { name?: string; children: ReactNode }) {
  return <main data-project-page className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-5 overflow-y-auto p-3 sm:p-6">
    <nav aria-label={t("projects_ui.page.breadcrumb")} className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
      <Link to={PROJECTS_ROUTE} data-project-breadcrumb-list className="rounded hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">{t("projects_ui.page.projects")}</Link>
      {name ? <>
        <ChevronRight className="size-3.5 shrink-0" aria-hidden />
        <span aria-current="page" className="min-w-0 truncate text-foreground">{name}</span>
      </> : null}
    </nav>
    {children}
  </main>;
}

function ProjectPageSkeleton() {
  return <div aria-busy="true" aria-label={t("projects_ui.page.loading")} className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)]">
    <div className="grid content-start gap-4">
      <Skeleton className="h-7 w-64 rounded-lg" />
      <Skeleton className="h-4 w-full max-w-md rounded" />
      <Skeleton className="h-28 w-full rounded-2xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
    <div className="grid content-start gap-2">{[0, 1, 2, 3].map(index => <Skeleton key={index} className="h-12 w-full rounded-lg" />)}</div>
  </div>;
}

function ProjectPageError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div role="alert" data-project-error className="flex flex-col items-start gap-2 text-sm">
    <span>{message}</span>
    <div className="flex flex-wrap gap-2">
      {onRetry ? <Button size="sm" variant="outline" onClick={onRetry}>{t("projects_ui.page.retry")}</Button> : null}
      <Link to={PROJECTS_ROUTE} className={buttonVariants({ size: "sm", variant: "ghost" })}>{t("projects_ui.page.back_to_projects")}</Link>
    </div>
  </div>;
}

function ProjectHeader({ client, project }: { client: ProjectPageClient; project: ProjectDetail }) {
  const queryClient = useQueryClient();
  const fieldId = useId();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const long = descriptionIsLong(project.description);

  const save = async () => {
    if (editing === null || saving) return;
    setSaving(true);
    setError(null);
    try {
      const summary = await client.updateProject(project.workspaceId, { description: editing.trim() });
      queryClient.setQueryData<ProjectDetail>(projectQueryKeys.detail(client.baseUrl, project.workspaceId), current => current ? { ...current, ...summary } : current);
      // The Projects list and the sidebar's pinned group read the registry under this key.
      void queryClient.invalidateQueries({ queryKey: projectsListQueryKey(client.baseUrl) });
      setEditing(null);
    } catch (cause) {
      setError(projectErrorText(cause, "projects_ui.page.description_save_failed"));
    } finally {
      setSaving(false);
    }
  };

  return <header className="grid gap-2">
    <h1 data-project-title className="text-xl font-semibold tracking-tight break-words">{project.name}</h1>
    {editing !== null ? <form className="grid gap-2" onSubmit={event => { event.preventDefault(); void save(); }}>
      <label htmlFor={fieldId} className="sr-only">{t("projects_ui.page.description")}</label>
      <Textarea id={fieldId} data-project-description-input autoFocus rows={4} maxLength={PROJECT_LIMITS.descriptionChars} value={editing}
        placeholder={t("projects_ui.page.description_placeholder")}
        onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setEditing(null); setError(null); } }}
        onChange={event => setEditing(event.target.value)} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" data-project-description-save disabled={saving}>{saving ? t("projects_ui.page.saving") : t("projects_ui.page.save")}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => { setEditing(null); setError(null); }}>{t("projects_ui.page.cancel")}</Button>
        <span className="ms-auto text-xs text-muted-foreground tabular-nums">{t("projects_ui.page.char_count", { count: editing.length.toLocaleString(), max: PROJECT_LIMITS.descriptionChars.toLocaleString() })}</span>
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </form> : <div className="flex min-w-0 items-start gap-1">
      <div className="grid min-w-0 flex-1 justify-items-start gap-1">
        {project.description
          ? <p data-project-description data-expanded={expanded || !long || undefined} className={cn("text-sm whitespace-pre-wrap text-muted-foreground break-words", long && !expanded && "line-clamp-3")}>{project.description}</p>
          : project.writable ? <button type="button" data-project-description-add className="text-sm text-muted-foreground hover:text-foreground hover:underline" onClick={() => setEditing("")}>{t("projects_ui.page.description_add")}</button> : null}
        {long ? <button type="button" data-project-description-toggle aria-expanded={expanded} className="text-xs font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none" onClick={() => setExpanded(value => !value)}>
          {expanded ? t("projects_ui.page.show_less") : t("projects_ui.page.show_more")}
        </button> : null}
      </div>
      {project.writable && project.description ? <Button type="button" size="icon-sm" variant="ghost" data-project-description-edit aria-label={t("projects_ui.page.description_edit")} onClick={() => setEditing(project.description)}>
        <Pencil className="size-4" />
      </Button> : null}
    </div>}
  </header>;
}

function ProjectRecents({ project, onOpenSession, onRetry, retrying }: { project: ProjectDetail; onOpenSession: (sessionId: string) => void; onRetry: () => void; retrying: boolean }) {
  const sessions = project.recentSessions;
  return <section aria-labelledby={`${project.workspaceId}-recents`} data-project-recents className="grid gap-2">
    <h2 id={`${project.workspaceId}-recents`} className="text-sm font-medium">{t("projects_ui.page.recents")}</h2>
    {sessions.length ? <ul className="divide-y divide-border">
      {sessions.map(session => <li key={session.id}>
        <button type="button" data-project-recent={session.id} onClick={() => onOpenSession(session.id)}
          className="flex min-h-11 w-full min-w-0 items-center gap-3 rounded-lg px-2 text-start hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
          <MessageSquare className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-sm">{session.title?.trim() || t("projects_ui.page.untitled_session")}</span>
          {session.updatedAt !== null ? <span className="shrink-0 text-xs text-muted-foreground">{formatRelative(session.updatedAt)}</span> : null}
        </button>
      </li>)}
    </ul> : null}
    {!project.recentSessionsComplete ? <div role="status" data-project-recents-incomplete className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span>{sessions.length ? t("projects_ui.page.recents_partial") : t("projects_ui.page.recents_unavailable")}</span>
      <Button size="xs" variant="outline" disabled={retrying} onClick={onRetry}>{t("projects_ui.page.retry")}</Button>
    </div> : !sessions.length ? <p data-project-recents-empty className="text-sm text-muted-foreground">{t("projects_ui.page.recents_empty")}</p> : null}
  </section>;
}

function SideRow({ icon, label, summary, action, onAction, disabled, data, children }: {
  icon: ReactNode; label: string; summary: ReactNode; action?: string; onAction?: () => void; disabled?: boolean; data: string; children?: ReactNode;
}) {
  return <li data-project-row={data} className="flex min-h-12 items-center gap-3 py-2">
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden>{icon}</span>
    <div className="grid min-w-0 flex-1">
      <span className="text-sm font-medium">{label}</span>
      <span className="truncate text-xs text-muted-foreground" data-project-row-summary>{summary}</span>
    </div>
    {children}
    {action && onAction ? <Button type="button" size="sm" variant="outline" data-project-row-action={data} disabled={disabled} onClick={onAction}
      aria-label={`${action}: ${label}`}>{action}</Button> : null}
  </li>;
}

function ProjectSideRows({ project, onOpen }: { project: ProjectDetail; onOpen: (dialog: OpenDialog) => void }) {
  const writable = project.writable;
  return <aside aria-label={t("projects_ui.page.details")} className="grid content-start gap-4">
    <ul className="divide-y divide-border">
      <SideRow data="instructions" icon={<BookText className="size-4" />} label={t("projects_ui.page.instructions.title")}
        summary={project.instructions.set ? t("projects_ui.page.instructions.set") : t("projects_ui.page.instructions.unset")}
        action={writable ? project.instructions.set ? t("projects_ui.page.edit") : t("projects_ui.page.add") : t("projects_ui.page.view")}
        onAction={() => onOpen({ kind: "instructions" })} />
      <SideRow data="context" icon={<FolderOpen className="size-4" />} label={t("projects_ui.page.context.title")}
        summary={t("projects_ui.page.context.files", { count: project.context.files })}
        action={writable ? t("projects_ui.page.add") : t("projects_ui.page.view")} onAction={() => onOpen({ kind: "context" })}>
        {writable && project.context.files ? <Button type="button" size="sm" variant="ghost" data-project-context-view onClick={() => onOpen({ kind: "context" })}>{t("projects_ui.page.view")}</Button> : null}
      </SideRow>
      <SideRow data="memory" icon={<Brain className="size-4" />} label={t("projects_ui.page.memory.title")}
        summary={project.memory.enabled ? t("projects_ui.page.memory.notes", { count: project.memory.entries }) : t("projects_ui.page.memory.disabled")}
        action={t("projects_ui.page.view")} disabled={!project.memory.enabled} onAction={() => onOpen({ kind: "memory" })} />
      <SideRow data="scheduled" icon={<CalendarClock className="size-4" />} label={t("projects_ui.page.tasks.row_label")}
        summary={project.scheduled.tasks
          ? <button type="button" data-project-tasks-view className="hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none" onClick={() => onOpen({ kind: "tasks", view: "list" })}>{t("projects_ui.page.tasks.count", { count: project.scheduled.tasks })}</button>
          : t("projects_ui.page.tasks.none")}
        action={writable ? t("projects_ui.page.add") : t("projects_ui.page.view")}
        onAction={() => onOpen({ kind: "tasks", view: writable ? "create" : "list" })} />
    </ul>
    <div data-project-private className="flex items-start gap-2 text-xs text-muted-foreground">
      <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <div className="grid gap-0.5">
        <span className="font-medium text-foreground">{t("projects_ui.page.private")}</span>
        <span>{t("projects_ui.page.private_detail")}</span>
      </div>
    </div>
  </aside>;
}

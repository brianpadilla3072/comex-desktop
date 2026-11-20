/** @jsxImportSource react */
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { AlertTriangle, ChevronDown, FolderOpen, Pin, Plus } from "lucide-react";

import { t } from "@/i18n";
import type { ProjectSummary } from "@/app/lib/projects";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { SettingsListSearchInput } from "@/react-app/domains/settings/settings-list";
import { useSpecialistApplications } from "@/react-app/domains/specialists/provider";
import { PairDeviceHint } from "@/react-app/shell/pair-device-hint";

import { PROJECT_SORTS, formatProjectTime, isProjectSort, projectPageRoute, visibleProjects, type ProjectSort } from "./projects-list-model";
import { projectsErrorText, useProjectPin, useProjectsConnection, useProjectsList, type ProjectsListClient } from "./use-projects-list";

/** Where a new project can go: one entry per specialist application. */
export type NewProjectTarget = { applications: { id: string; name: string }[]; onCreate: (applicationId: string | null) => void };

const SORT_LABEL: Record<ProjectSort, string> = {
  activity: "projects_ui.sort_activity",
  name: "projects_ui.sort_name",
  created: "projects_ui.sort_created",
};

/** Route entry (`/projects`): resolves the owner connection, then shows the list. */
export function ProjectsPage() {
  const navigate = useNavigate();
  const connection = useProjectsConnection();
  const specialist = useSpecialistApplications();
  const applications = specialist?.catalog?.enabled ? specialist.catalog.applications : [];
  const newProject: NewProjectTarget | null = specialist?.catalog?.enabled ? {
    applications: applications.map(app => ({ id: app.id, name: app.name })),
    onCreate: applicationId => {
      const application = applications.find(app => app.id === applicationId);
      // With no application yet, the first project comes with the first application.
      if (application) specialist.createProject(application); else specialist.create();
    },
  } : null;
  const client = connection.data;
  if (connection.isPending) return <ProjectsFrame><ProjectsSkeleton /></ProjectsFrame>;
  if (!client) {
    return <ProjectsFrame>
      <ProjectsError message={connection.error ? projectsErrorText(connection.error) : t("projects_ui.error_unknown")} onRetry={() => void connection.refetch()} />
    </ProjectsFrame>;
  }
  return <ProjectsPanel client={client} newProject={newProject} onOpenProject={workspaceId => navigate(projectPageRoute(workspaceId))} />;
}

export function ProjectsPanel({ client, newProject, onOpenProject, now = Date.now() }: {
  client: ProjectsListClient;
  newProject: NewProjectTarget | null;
  onOpenProject: (workspaceId: string) => void;
  now?: number;
}) {
  const query = useProjectsList(client);
  const pin = useProjectPin(client);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ProjectSort>("activity");
  const [pinError, setPinError] = useState<string | null>(null);
  const list = query.data ?? null;
  const writable = list?.writable === true;

  const togglePin = (project: ProjectSummary) => {
    setPinError(null);
    pin.mutate({ workspaceId: project.workspaceId, pinned: !project.pinned }, {
      onError: cause => setPinError(t("projects_ui.pin_failed", { name: project.name, message: projectsErrorText(cause) })),
    });
  };

  const toolbar = list && list.projects.length > 0 ? <div className="flex w-full flex-wrap items-center gap-2">
    <SettingsListSearchInput
      containerClassName="min-w-0 flex-1 basis-56"
      type="search"
      value={search}
      onChange={event => setSearch(event.target.value)}
      placeholder={t("projects_ui.search_placeholder")}
      aria-label={t("projects_ui.search_label")}
      data-projects-search
    />
    <Select value={sort} items={PROJECT_SORTS.map(value => ({ value, label: t(SORT_LABEL[value]) }))} onValueChange={value => { if (isProjectSort(value)) setSort(value); }}>
      <SelectTrigger aria-label={t("projects_ui.sort_label")} data-projects-sort className="w-auto"><SelectValue /></SelectTrigger>
      <SelectContent><SelectGroup>{PROJECT_SORTS.map(value => <SelectItem key={value} value={value}>{t(SORT_LABEL[value])}</SelectItem>)}</SelectGroup></SelectContent>
    </Select>
  </div> : null;

  return <ProjectsFrame action={list ? <NewProjectButton target={newProject} writable={writable} /> : null} toolbar={toolbar}>
    {list && !writable ? <p role="status" data-projects-read-only className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
      {t("projects_ui.read_only")} <PairDeviceHint />
    </p> : null}
    {pinError ? <p role="alert" data-projects-pin-error className="text-sm text-destructive">{pinError}</p> : null}
    <ProjectsBody
      list={list}
      loading={query.isPending}
      error={query.isError ? projectsErrorText(query.error) : null}
      search={search}
      sort={sort}
      now={now}
      newProject={newProject}
      pinBusyId={pin.isPending ? pin.variables?.workspaceId ?? null : null}
      onRetry={() => void query.refetch()}
      onOpenProject={onOpenProject}
      onTogglePin={togglePin}
      onClearSearch={() => setSearch("")}
    />
  </ProjectsFrame>;
}

function ProjectsFrame({ action, toolbar, children }: { action?: ReactNode; toolbar?: ReactNode; children: ReactNode }) {
  return <main data-projects-page className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-4 overflow-y-auto p-3 sm:p-6">
    <header className="flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-xl font-semibold tracking-tight">{t("projects_ui.title")}</h1>
      {action}
    </header>
    {toolbar}
    {children}
  </main>;
}

function NewProjectButton({ target, writable }: { target: NewProjectTarget | null; writable: boolean }) {
  if (!target) return null;
  const label = t("projects_ui.new_project");
  const content = <><Plus className="size-4" aria-hidden /><span>{label}</span></>;
  if (!writable) return <Button size="sm" disabled data-projects-new title={t("projects_ui.read_only")}>{content}</Button>;
  if (target.applications.length > 1) {
    return <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="sm" data-projects-new />}>{content}<ChevronDown className="size-3.5" aria-hidden /></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <p className="px-2 py-1.5 text-xs text-muted-foreground">{t("projects_ui.new_project_choose")}</p>
        {target.applications.map(app => <DropdownMenuItem key={app.id} data-projects-new-in={app.id} onClick={() => target.onCreate(app.id)}>{app.name}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>;
  }
  return <Button size="sm" data-projects-new onClick={() => target.onCreate(target.applications[0]?.id ?? null)}>{content}</Button>;
}

function ProjectsSkeleton() {
  return <div aria-busy="true" aria-label={t("projects_ui.loading")} data-projects-loading className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {[0, 1, 2, 3, 4, 5].map(index => <Skeleton key={index} className="h-24 w-full rounded-xl" />)}
  </div>;
}

function ProjectsError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div role="alert" data-projects-error className="flex flex-col items-start gap-2 rounded-xl border border-border p-4">
    <p className="flex items-center gap-2 text-sm font-medium"><AlertTriangle className="size-4 text-destructive" aria-hidden />{t("projects_ui.error_title")}</p>
    <p className="text-sm text-muted-foreground">{message}</p>
    <Button variant="outline" size="sm" onClick={onRetry}>{t("projects_ui.retry")}</Button>
  </div>;
}

export function ProjectsBody({ list, loading, error, search, sort, now, newProject, pinBusyId, onRetry, onOpenProject, onTogglePin, onClearSearch }: {
  list: { projects: ProjectSummary[]; writable: boolean } | null;
  loading: boolean;
  error: string | null;
  search: string;
  sort: ProjectSort;
  now: number;
  newProject: NewProjectTarget | null;
  pinBusyId: string | null;
  onRetry: () => void;
  onOpenProject: (workspaceId: string) => void;
  onTogglePin: (project: ProjectSummary) => void;
  onClearSearch: () => void;
}) {
  // A failed read with nothing known yet is an error, never "no projects".
  if (!list) return loading && !error ? <ProjectsSkeleton /> : <ProjectsError message={error ?? t("projects_ui.error_unknown")} onRetry={onRetry} />;
  const stale = error ? <p role="alert" data-projects-stale className="rounded-lg border border-amber-6/40 bg-amber-3/60 px-3 py-2 text-sm text-amber-11">{t("projects_ui.stale", { message: error })}</p> : null;
  if (!list.projects.length) {
    return <>{stale}<Empty data-projects-empty variant="ghost">
      <EmptyHeader>
        <EmptyMedia><FolderOpen className="size-6 text-muted-foreground" aria-hidden /></EmptyMedia>
        <EmptyTitle>{t("projects_ui.empty_title")}</EmptyTitle>
        <EmptyDescription>{list.writable ? t("projects_ui.empty_body") : t("projects_ui.empty_read_only")}</EmptyDescription>
      </EmptyHeader>
      {list.writable && newProject ? <NewProjectButton target={newProject} writable /> : null}
    </Empty></>;
  }
  const visible = visibleProjects(list.projects, search, sort);
  return <>
    {stale}
    {visible.length ? <ul data-projects-grid className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {visible.map(project => <ProjectCard key={project.workspaceId} project={project} now={now} writable={list.writable} busy={pinBusyId === project.workspaceId} onOpen={() => onOpenProject(project.workspaceId)} onTogglePin={() => onTogglePin(project)} />)}
    </ul> : <div data-projects-no-match className="flex flex-col items-start gap-2 py-6 text-sm text-muted-foreground">
      <p>{t("projects_ui.no_match", { query: search.trim() })}</p>
      <Button variant="outline" size="sm" onClick={onClearSearch}>{t("projects_ui.clear_search")}</Button>
    </div>}
  </>;
}

function ProjectCard({ project, now, writable, busy, onOpen, onTogglePin }: {
  project: ProjectSummary; now: number; writable: boolean; busy: boolean; onOpen: () => void; onTogglePin: () => void;
}) {
  const time = formatProjectTime(project.lastActivityAt, now);
  const pinLabel = project.pinned ? t("projects_ui.unpin", { name: project.name }) : t("projects_ui.pin", { name: project.name });
  return <li data-project-card={project.workspaceId} data-pinned={project.pinned ? "true" : undefined}
    className="group/project relative flex min-w-0 items-start gap-1 rounded-xl border border-border bg-background transition-colors duration-150 ease-out hover:bg-muted/50 focus-within:bg-muted/50">
    <button type="button" data-project-open onClick={onOpen} className="flex min-h-24 min-w-0 flex-1 flex-col items-start gap-1 rounded-xl p-4 text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
      <span className="w-full truncate text-sm font-medium" title={project.name}>{project.name}</span>
      <span className="w-full truncate text-xs text-muted-foreground" title={project.applicationName}>{project.applicationName}</span>
      <time data-project-time dateTime={new Date(project.lastActivityAt).toISOString()} className="mt-auto text-xs text-muted-foreground">{time}</time>
    </button>
    {writable ? <Button variant="ghost" size="icon-sm" data-project-pin aria-pressed={project.pinned} aria-label={pinLabel} title={pinLabel} disabled={busy}
      onClick={onTogglePin}
      className={cn("m-2 shrink-0 text-muted-foreground", !project.pinned && "pointer-fine:opacity-0 pointer-fine:group-hover/project:opacity-100 pointer-fine:group-focus-within/project:opacity-100")}>
      <Pin className={cn("size-4", project.pinned && "fill-current")} aria-hidden />
    </Button> : project.pinned ? <Pin data-project-pinned-mark className="m-4 size-4 shrink-0 text-muted-foreground" aria-label={t("projects_ui.pinned")} /> : null}
  </li>;
}

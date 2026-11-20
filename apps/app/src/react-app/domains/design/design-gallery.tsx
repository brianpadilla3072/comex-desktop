/** @jsxImportSource react */
import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { AlertTriangle, LayoutGrid, List, MonitorSmartphone, Palette, PenTool, Presentation, type LucideIcon } from "lucide-react";

import { DESIGN_KINDS, designKindLabel, designPageRoute, formatDesignTime, type DesignKind, type DesignManifest, type DesignSummary } from "@/app/lib/designs";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { useProjectsList } from "@/react-app/domains/projects/use-projects-list";
import { SettingsListSearchInput } from "@/react-app/domains/settings/settings-list";
import { PairDeviceHint } from "@/react-app/shell/pair-device-hint";

import { DesignClientContext, designErrorText, designQueryKeys, type DesignClient } from "./design-client";
import { DesignCreateDialog, type DesignProjectOption } from "./design-create-dialog";
import { designProjectOptions, isDesignScope, isDesignView, visibleDesigns, type DesignScope, type DesignView } from "./design-gallery-model";
import { useDesignConnection, useDesignList } from "./use-designs";

export const KIND_ICON: Record<DesignKind, LucideIcon> = { slides: Presentation, mockup: MonitorSmartphone, system: Palette, board: PenTool };

/** Route entry (`/design`): resolves the owner connection, then shows the gallery. */
export function DesignGalleryPage({ currentWorkspaceId }: { currentWorkspaceId: string | null }) {
  const navigate = useNavigate();
  const connection = useDesignConnection();
  const client = connection.data ?? null;
  // Every project a design can go in (the Projects registry); designs add theirs when it is off.
  const projects = useProjectsList(client);
  if (connection.isPending) return <GalleryFrame><GallerySkeleton /></GalleryFrame>;
  if (!client) {
    return <GalleryFrame>
      <GalleryError message={connection.error ? designErrorText(connection.error) : t("design_ui.studio.error_unknown")} onRetry={() => void connection.refetch()} />
    </GalleryFrame>;
  }
  return <DesignGalleryPanel client={client} currentWorkspaceId={currentWorkspaceId}
    projects={(projects.data?.projects ?? []).map(project => ({ workspaceId: project.workspaceId, name: project.name }))}
    onOpenDesign={(workspaceId, designId) => navigate(designPageRoute(workspaceId, designId))} />;
}

export function DesignGalleryPanel({ client, currentWorkspaceId, projects, onOpenDesign, now = Date.now() }: {
  client: DesignClient;
  /** The project the window is working in, for "Este proyecto"; null hides that filter. */
  currentWorkspaceId: string | null;
  projects: DesignProjectOption[];
  onOpenDesign: (workspaceId: string, designId: string) => void;
  now?: number;
}) {
  const queryClient = useQueryClient();
  const query = useDesignList(client);
  const [scope, setScope] = useState<DesignScope>("all");
  const [view, setView] = useState<DesignView>("grid");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState<DesignKind | null>(null);
  const list = query.data ?? null;
  const writable = list?.writable === true;
  const options = designProjectOptions(projects, list?.designs ?? []);

  const created = (design: DesignManifest, workspaceId: string) => {
    setCreating(null);
    void queryClient.invalidateQueries({ queryKey: designQueryKeys.list(client.baseUrl) });
    onOpenDesign(workspaceId, design.id);
  };

  return <DesignClientContext value={client}>
    <GalleryFrame>
      <section aria-labelledby="design-create-heading" className="flex flex-col gap-2">
        <h2 id="design-create-heading" className="text-sm font-medium">{t("design_ui.studio.create_heading")}</h2>
        <ul data-design-create-tiles className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {DESIGN_KINDS.map(kind => {
            const Icon = KIND_ICON[kind];
            return <li key={kind}>
              <button type="button" data-design-create={kind} disabled={!list || !writable}
                title={list && !writable ? t("design_ui.studio.read_only") : undefined}
                onClick={() => setCreating(kind)}
                className="flex h-20 w-full items-center gap-3 rounded-xl border border-border bg-background px-4 text-start text-sm font-medium transition-colors duration-150 ease-out hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60">
                <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                <span>{designKindLabel(kind)}</span>
              </button>
            </li>;
          })}
        </ul>
      </section>
      {list && !writable ? <p role="status" data-design-read-only className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        {t("design_ui.studio.read_only")} <PairDeviceHint />
      </p> : null}
      {list && list.designs.length > 0 ? <div className="flex w-full flex-wrap items-center gap-2">
        {currentWorkspaceId ? <ToggleGroup aria-label={t("design_ui.studio.filter_label")} value={[scope]} variant="outline" size="sm"
          onValueChange={value => { if (isDesignScope(value[0])) setScope(value[0]); }}>
          <ToggleGroupItem value="all" data-design-scope="all">{t("design_ui.studio.filter_all")}</ToggleGroupItem>
          <ToggleGroupItem value="project" data-design-scope="project">{t("design_ui.studio.filter_project")}</ToggleGroupItem>
        </ToggleGroup> : null}
        <SettingsListSearchInput containerClassName="min-w-0 flex-1 basis-56" type="search" value={search}
          onChange={event => setSearch(event.target.value)} placeholder={t("design_ui.studio.search_placeholder")}
          aria-label={t("design_ui.studio.search_label")} data-design-search />
        <ToggleGroup aria-label={t("design_ui.studio.view_label")} value={[view]} variant="outline" size="sm"
          onValueChange={value => { if (isDesignView(value[0])) setView(value[0]); }}>
          <ToggleGroupItem value="grid" data-design-view="grid" aria-label={t("design_ui.studio.view_grid")} title={t("design_ui.studio.view_grid")}><LayoutGrid className="size-4" aria-hidden /></ToggleGroupItem>
          <ToggleGroupItem value="list" data-design-view="list" aria-label={t("design_ui.studio.view_list")} title={t("design_ui.studio.view_list")}><List className="size-4" aria-hidden /></ToggleGroupItem>
        </ToggleGroup>
      </div> : null}
      <GalleryBody list={list} loading={query.isPending} error={query.isError ? designErrorText(query.error) : null}
        designs={list ? visibleDesigns(list.designs, { scope: currentWorkspaceId ? scope : "all", workspaceId: currentWorkspaceId, query: search, kindLabel: designKindLabel }) : []}
        search={search} view={view} now={now} client={client}
        onRetry={() => void query.refetch()} onOpenDesign={onOpenDesign} onClearSearch={() => { setSearch(""); setScope("all"); }} />
      <DesignCreateDialog client={client} kind={creating} projects={options} defaultWorkspaceId={currentWorkspaceId}
        onOpenChange={open => { if (!open) setCreating(null); }} onCreated={created} />
    </GalleryFrame>
  </DesignClientContext>;
}

function GalleryFrame({ children }: { children: ReactNode }) {
  return <main data-design-gallery className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-4 overflow-y-auto p-3 sm:p-6">
    <header className="flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-xl font-semibold tracking-tight">{t("design_ui.studio.title")}</h1>
    </header>
    {children}
  </main>;
}

function GallerySkeleton() {
  return <div aria-busy="true" aria-label={t("design_ui.studio.loading")} data-design-loading className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {[0, 1, 2, 3, 4, 5].map(index => <Skeleton key={index} className="aspect-[4/3] w-full rounded-xl" />)}
  </div>;
}

function GalleryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div role="alert" data-design-error className="flex flex-col items-start gap-2 rounded-xl border border-border p-4">
    <p className="flex items-center gap-2 text-sm font-medium"><AlertTriangle className="size-4 text-destructive" aria-hidden />{t("design_ui.studio.error_title")}</p>
    <p className="text-sm text-muted-foreground">{message}</p>
    <Button variant="outline" size="sm" onClick={onRetry}>{t("design_ui.studio.retry")}</Button>
  </div>;
}

function GalleryBody({ list, loading, error, designs, search, view, now, client, onRetry, onOpenDesign, onClearSearch }: {
  list: { designs: DesignSummary[]; writable: boolean } | null;
  loading: boolean;
  error: string | null;
  designs: DesignSummary[];
  search: string;
  view: DesignView;
  now: number;
  client: DesignClient;
  onRetry: () => void;
  onOpenDesign: (workspaceId: string, designId: string) => void;
  onClearSearch: () => void;
}) {
  // A failed read with nothing known yet is an error, never "no designs".
  if (!list) return loading && !error ? <GallerySkeleton /> : <GalleryError message={error ?? t("design_ui.studio.error_unknown")} onRetry={onRetry} />;
  const stale = error ? <p role="alert" data-design-stale className="rounded-lg border border-amber-6/40 bg-amber-3/60 px-3 py-2 text-sm text-amber-11">{t("design_ui.studio.stale", { message: error })}</p> : null;
  if (!list.designs.length) {
    return <>{stale}<Empty data-design-empty variant="ghost">
      <EmptyHeader>
        <EmptyMedia><Presentation className="size-6 text-muted-foreground" aria-hidden /></EmptyMedia>
        <EmptyTitle>{t("design_ui.studio.empty_title")}</EmptyTitle>
        <EmptyDescription>{list.writable ? t("design_ui.studio.empty_body") : t("design_ui.studio.empty_read_only")}</EmptyDescription>
      </EmptyHeader>
    </Empty></>;
  }
  if (!designs.length) {
    return <>{stale}<div data-design-no-match className="flex flex-col items-start gap-2 py-6 text-sm text-muted-foreground">
      <p>{search.trim() ? t("design_ui.studio.no_match", { query: search.trim() }) : t("design_ui.studio.no_match_project")}</p>
      <Button variant="outline" size="sm" onClick={onClearSearch}>{t("design_ui.studio.clear_filters")}</Button>
    </div></>;
  }
  return <>
    {stale}
    {view === "grid" ? <ul data-design-grid className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {designs.map(design => <li key={`${design.workspaceId}/${design.id}`} data-design-card={design.id}>
        <button type="button" data-design-open onClick={() => onOpenDesign(design.workspaceId, design.id)}
          className="flex w-full flex-col gap-2 rounded-xl p-2 text-start transition-colors duration-150 ease-out hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          <DesignThumbnail client={client} design={design} className="aspect-video w-full rounded-lg" />
          <span className="flex w-full min-w-0 flex-col gap-0.5 px-1">
            <span className="truncate text-sm font-medium" title={design.title}>{design.title}</span>
            <span className="flex min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="truncate">{designKindLabel(design.kind)}</span>
              <time dateTime={new Date(design.updatedAt).toISOString()} className="shrink-0">{formatDesignTime(design.updatedAt, now)}</time>
            </span>
          </span>
        </button>
      </li>)}
    </ul> : <ul data-design-list className="flex flex-col">
      {designs.map(design => <li key={`${design.workspaceId}/${design.id}`} data-design-row={design.id}>
        <button type="button" data-design-open onClick={() => onOpenDesign(design.workspaceId, design.id)}
          className="flex w-full min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 text-start text-sm transition-colors duration-150 ease-out hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring">
          <DesignThumbnail client={client} design={design} className="h-10 w-16 shrink-0 rounded-md" />
          <span className="min-w-0 flex-1 truncate font-medium" title={design.title}>{design.title}</span>
          <span className="hidden w-36 truncate text-xs text-muted-foreground sm:block">{designKindLabel(design.kind)}</span>
          <span className="hidden w-40 truncate text-xs text-muted-foreground md:block" title={design.projectName}>{design.projectName}</span>
          <time dateTime={new Date(design.updatedAt).toISOString()} className="w-24 shrink-0 text-end text-xs text-muted-foreground">{formatDesignTime(design.updatedAt, now)}</time>
        </button>
      </li>)}
    </ul>}
  </>;
}

/** The captured preview when there is one, otherwise the kind's mark. Never a live page (cheap). */
export function DesignThumbnail({ client, design, className }: { client: Pick<DesignClient, "readDesignFile">; design: Pick<DesignSummary, "workspaceId" | "id" | "kind" | "hasThumbnail" | "updatedAt">; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!design.hasThumbnail) { setUrl(null); return; }
    let created: string | null = null;
    let cancelled = false;
    void client.readDesignFile(design.workspaceId, design.id, "thumbnail.png").then(blob => {
      if (cancelled) return;
      created = URL.createObjectURL(blob);
      setUrl(created);
    }).catch(() => { if (!cancelled) setUrl(null); });
    return () => { cancelled = true; if (created) URL.revokeObjectURL(created); };
  }, [client, design.workspaceId, design.id, design.hasThumbnail, design.updatedAt]);
  const Icon = KIND_ICON[design.kind];
  return <span data-design-thumbnail={url ? "image" : "placeholder"} className={cn("flex items-center justify-center overflow-hidden bg-muted", className)}>
    {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <Icon className="size-6 text-muted-foreground" aria-hidden />}
  </span>;
}

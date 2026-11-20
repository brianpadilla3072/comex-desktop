/** @jsxImportSource react */
import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, File, Folder, FolderPlus, Info, Search, Trash2, Upload, X } from "lucide-react";

import { PROJECT_LIMITS, type ProjectContextEntry, type ProjectContextListing, type ProjectUsage } from "@/app/lib/projects";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import { PairDeviceHint } from "@/react-app/shell/pair-device-hint";

import { projectQueryKeys, type ProjectPageClient } from "./project-page-data";
import {
  contextBreadcrumb, contextFolderNameProblem, filterContextEntries, formatContextSize, formatRelative, isContextExists,
  joinContextPath, projectErrorText, upsertContextEntry,
} from "./project-page-model";

type Upload = { id: number; name: string; status: "uploading" | "done" | "skipped" | "error"; message?: string };

/** The project's context files: browse folders, search, upload, create folders, delete. */
export function ProjectContextDialog({ client, workspaceId, open, writable, onOpenChange }: {
  client: ProjectPageClient;
  workspaceId: string;
  open: boolean;
  writable: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [path, setPath] = useState("");
  const [search, setSearch] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderError, setFolderError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [usage, setUsage] = useState<ProjectUsage | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadId = useRef(0);
  const searchId = useId();
  const folderId = useId();

  const listingKey = projectQueryKeys.context(client.baseUrl, workspaceId, path);
  const query = useQuery({
    queryKey: listingKey,
    queryFn: () => client.listProjectContext(workspaceId, path),
    enabled: open,
    retry: false,
  });

  useEffect(() => {
    if (open) return;
    setPath(""); setSearch(""); setSelecting(false); setSelected(new Set()); setUploads([]);
    setFolderOpen(false); setFolderName(""); setFolderError(null); setError(null); setUsage(null);
  }, [open]);
  useEffect(() => { setSelected(new Set()); setSearch(""); }, [path]);

  const listing = query.data;
  const entries = listing?.entries ?? [];
  const shown = filterContextEntries(entries, search);
  const currentUsage = usage ?? listing?.usage ?? null;

  /** Apply a change the server answered: the listing in place, the bar from `usage`, and mark the rest stale. */
  const applyChange = (folder: string, change: { usage: ProjectUsage; entry?: ProjectContextEntry | null; removed?: string }) => {
    setUsage(change.usage);
    const key = projectQueryKeys.context(client.baseUrl, workspaceId, folder);
    queryClient.setQueryData<ProjectContextListing>(key, current => {
      if (!current) return current;
      let next = current.entries;
      if (change.entry) next = upsertContextEntry(next, change.entry);
      if (change.removed) next = next.filter(entry => entry.path !== change.removed);
      return { ...current, entries: next, usage: change.usage };
    });
    void queryClient.invalidateQueries({
      queryKey: projectQueryKeys.contextAll(client.baseUrl, workspaceId),
      predicate: item => item.queryKey[4] !== folder,
    });
    void queryClient.invalidateQueries({ queryKey: projectQueryKeys.detail(client.baseUrl, workspaceId) });
  };

  const setUploadState = (id: number, patch: Partial<Upload>) => setUploads(current => current.map(item => item.id === id ? { ...item, ...patch } : item));

  const uploadFiles = async (files: readonly File[]) => {
    if (!writable || !files.length) return;
    const folder = path;
    setError(null);
    setBusy(true);
    try {
      for (const file of files) {
        const id = ++uploadId.current;
        setUploads(current => [...current, { id, name: file.name, status: "uploading" }]);
        if (file.size > PROJECT_LIMITS.contextFileBytes) {
          setUploadState(id, { status: "error", message: t("projects_ui.page.error.context_file_too_large") });
          continue;
        }
        const listed = queryClient.getQueryData<ProjectContextListing>(projectQueryKeys.context(client.baseUrl, workspaceId, folder));
        const clash = listed?.entries.find(entry => entry.name === file.name);
        if (clash?.kind === "folder") {
          setUploadState(id, { status: "error", message: t("projects_ui.page.error.context_exists") });
          continue;
        }
        let replace = false;
        if (clash) {
          replace = await confirmReplace(file.name);
          if (!replace) { setUploadState(id, { status: "skipped", message: t("projects_ui.page.context.upload_skipped") }); continue; }
        }
        try {
          const change = await uploadOnce(file, folder, replace);
          if (change === null) { setUploadState(id, { status: "skipped", message: t("projects_ui.page.context.upload_skipped") }); continue; }
          applyChange(folder, change);
          setUploadState(id, { status: "done" });
        } catch (cause) {
          setUploadState(id, { status: "error", message: projectErrorText(cause, "projects_ui.page.context.upload_failed") });
        }
      }
    } finally {
      setBusy(false);
    }
  };

  /** One upload; a name taken since the listing asks once more before replacing. Null: the person kept the old file. */
  const uploadOnce = async (file: File, folder: string, replace: boolean) => {
    try {
      return await client.uploadProjectContextFile(workspaceId, file, { name: file.name, folder, replace });
    } catch (cause) {
      if (replace || !isContextExists(cause)) throw cause;
      if (!(await confirmReplace(file.name))) return null;
      return client.uploadProjectContextFile(workspaceId, file, { name: file.name, folder, replace: true });
    }
  };

  const createFolder = async () => {
    const problem = contextFolderNameProblem(folderName, entries);
    if (problem) { setFolderError(t(problem)); return; }
    setBusy(true);
    setFolderError(null);
    try {
      const change = await client.createProjectContextFolder(workspaceId, joinContextPath(path, folderName.trim()));
      applyChange(path, change);
      setFolderName("");
      setFolderOpen(false);
    } catch (cause) {
      setFolderError(projectErrorText(cause, "projects_ui.page.context.folder_failed"));
    } finally {
      setBusy(false);
    }
  };

  const deleteSelected = async () => {
    const targets = entries.filter(entry => selected.has(entry.path));
    if (!targets.length || !writable) return;
    const folders = targets.filter(entry => entry.kind === "folder").length;
    const confirmed = await confirmDialog({
      title: t("projects_ui.page.context.delete_title", { count: targets.length }),
      description: folders ? t("projects_ui.page.context.delete_folders_description") : t("projects_ui.page.context.delete_description"),
      confirmLabel: t("projects_ui.page.delete"),
      cancelLabel: t("projects_ui.page.cancel"),
      destructive: true,
    });
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    const folder = path;
    const failed: string[] = [];
    for (const entry of targets) {
      try {
        const change = await client.deleteProjectContextEntry(workspaceId, entry.path);
        applyChange(folder, { usage: change.usage, removed: entry.path });
      } catch (cause) {
        failed.push(`${entry.name}: ${projectErrorText(cause, "projects_ui.page.context.delete_failed")}`);
      }
    }
    setSelected(new Set());
    if (failed.length) setError(failed.join("\n"));
    else setSelecting(false);
    setBusy(false);
  };

  const toggle = (entryPath: string, checked: boolean) => setSelected(current => {
    const next = new Set(current);
    if (checked) next.add(entryPath); else next.delete(entryPath);
    return next;
  });

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!writable) return;
    void uploadFiles([...event.dataTransfer.files]);
  };

  const crumbs = contextBreadcrumb(path);

  return <Dialog open={open} onOpenChange={next => { if (!busy || next) onOpenChange(next); }}>
    <DialogContent data-project-context-dialog className="flex max-h-[min(92dvh,46rem)] flex-col gap-4 lg:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{t("projects_ui.page.context.title")}</DialogTitle>
      </DialogHeader>

      <nav aria-label={t("projects_ui.page.context.breadcrumb")} className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
        <button type="button" data-context-crumb="" className={cn("rounded px-1 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none", !path && "font-medium")}
          aria-current={!path ? "page" : undefined} onClick={() => setPath("")}>{t("projects_ui.page.context.root")}</button>
        {crumbs.map(crumb => <span key={crumb.path} className="flex min-w-0 items-center gap-1">
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <button type="button" data-context-crumb={crumb.path} className={cn("max-w-48 truncate rounded px-1 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none", crumb.path === path && "font-medium")}
            aria-current={crumb.path === path ? "page" : undefined} onClick={() => setPath(crumb.path)}>{crumb.name}</button>
        </span>)}
      </nav>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <label htmlFor={searchId} className="sr-only">{t("projects_ui.page.context.search")}</label>
          <Input id={searchId} data-context-search value={search} onChange={event => setSearch(event.target.value)} placeholder={t("projects_ui.page.context.search")} className="ps-8" />
        </div>
        {writable ? <>
          {selecting
            ? <Button type="button" size="sm" variant="ghost" data-context-select-done onClick={() => { setSelecting(false); setSelected(new Set()); }}><X className="size-4" />{t("projects_ui.page.cancel")}</Button>
            : <Button type="button" size="sm" variant="outline" data-context-select disabled={!entries.length} onClick={() => setSelecting(true)}>{t("projects_ui.page.context.select")}</Button>}
          {selecting
            ? <Button type="button" size="sm" variant="destructive" data-context-delete-selected disabled={!selected.size || busy} onClick={() => void deleteSelected()}><Trash2 className="size-4" />{t("projects_ui.page.context.delete_selected", { count: selected.size })}</Button>
            : <>
              <Button type="button" size="sm" variant="outline" data-context-new-folder onClick={() => { setFolderOpen(value => !value); setFolderError(null); }}><FolderPlus className="size-4" />{t("projects_ui.page.context.new_folder")}</Button>
              <Button type="button" size="sm" data-context-add disabled={busy} onClick={() => fileInput.current?.click()}><Upload className="size-4" />{t("projects_ui.page.add")}</Button>
            </>}
          <input ref={fileInput} type="file" multiple hidden data-context-file-input aria-label={t("projects_ui.page.context.upload")}
            onChange={event => { const files = [...(event.currentTarget.files ?? [])]; event.currentTarget.value = ""; void uploadFiles(files); }} />
        </> : null}
      </div>

      {folderOpen && writable ? <form className="flex flex-wrap items-start gap-2" onSubmit={event => { event.preventDefault(); void createFolder(); }}>
        <div className="grid min-w-40 flex-1 gap-1">
          <label htmlFor={folderId} className="sr-only">{t("projects_ui.page.context.folder_name")}</label>
          <Input id={folderId} data-context-folder-name autoFocus value={folderName} placeholder={t("projects_ui.page.context.folder_name")}
            aria-invalid={folderError ? true : undefined} aria-describedby={folderError ? `${folderId}-error` : undefined}
            onChange={event => { setFolderName(event.target.value); setFolderError(null); }} />
          {folderError ? <p id={`${folderId}-error`} role="alert" className="text-xs text-destructive">{folderError}</p> : null}
        </div>
        <Button type="submit" size="sm" data-context-folder-create disabled={busy}>{t("projects_ui.page.create")}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => { setFolderOpen(false); setFolderName(""); setFolderError(null); }}>{t("projects_ui.page.cancel")}</Button>
      </form> : null}

      <div data-context-drop-zone data-dragging={dragging || undefined}
        className={cn("min-h-40 flex-1 overflow-y-auto rounded-xl border border-border", dragging && "border-dashed border-foreground/40 bg-muted/40")}
        onDragOver={event => { if (!writable) return; event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}>
        {query.isPending ? <div aria-busy="true" aria-label={t("projects_ui.page.loading")} className="grid gap-1 p-2">{[0, 1, 2].map(index => <Skeleton key={index} className="h-10 w-full rounded-lg" />)}</div>
          : query.isError ? <div role="alert" className="flex flex-col items-start gap-2 p-4 text-sm">
            <span>{projectErrorText(query.error, "projects_ui.page.context.load_failed")}</span>
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>{t("projects_ui.page.retry")}</Button>
          </div>
          : !entries.length ? <p data-context-empty className="p-6 text-center text-sm text-muted-foreground">{writable ? t("projects_ui.page.context.empty_writable") : t("projects_ui.page.context.empty")}</p>
          : !shown.length ? <p data-context-no-match className="p-6 text-center text-sm text-muted-foreground">{t("projects_ui.page.context.no_match", { query: search.trim() })}</p>
          : <ul className="divide-y divide-border" aria-label={t("projects_ui.page.context.title")}>
            {shown.map(entry => <li key={entry.path} data-context-entry={entry.path} className="flex min-h-11 items-center gap-3 px-3 py-1.5">
              {selecting ? <Checkbox aria-label={t("projects_ui.page.context.select_entry", { name: entry.name })} data-context-check={entry.path}
                checked={selected.has(entry.path)} onCheckedChange={checked => toggle(entry.path, checked === true)} /> : null}
              {entry.kind === "folder" ? <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <File className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
              {entry.kind === "folder" && !selecting
                ? <button type="button" data-context-open={entry.path} className="min-w-0 flex-1 truncate rounded text-start font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none" onClick={() => setPath(entry.path)}>{entry.name}</button>
                : <span className="min-w-0 flex-1 truncate">{entry.name}</span>}
              <span className="hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:inline">
                {entry.kind === "folder" ? t("projects_ui.page.context.items", { count: entry.items ?? 0 }) : formatRelative(entry.updatedAt)}
              </span>
              <span className="w-16 shrink-0 text-end text-xs text-muted-foreground tabular-nums">{formatContextSize(entry.size)}</span>
            </li>)}
          </ul>}
      </div>

      {uploads.length ? <ul data-context-uploads aria-live="polite" className="grid max-h-28 gap-1 overflow-y-auto text-xs">
        {uploads.map(upload => <li key={upload.id} data-context-upload={upload.status} className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate">{upload.name}</span>
          <span className={cn("shrink-0", upload.status === "error" ? "text-destructive" : "text-muted-foreground")}>
            {upload.status === "uploading" ? t("projects_ui.page.context.uploading") : upload.status === "done" ? t("projects_ui.page.context.uploaded") : upload.message}
          </span>
        </li>)}
      </ul> : null}
      {error ? <p role="alert" className="text-sm whitespace-pre-line text-destructive">{error}</p> : null}
      {!writable ? <p role="note" className="text-xs text-muted-foreground">{t("projects_ui.page.read_only")} <PairDeviceHint /></p> : null}

      {currentUsage ? <ContextCapacityBar usage={currentUsage} agentPath={listing?.agentPath ?? ""} /> : null}
    </DialogContent>
  </Dialog>;
}

async function confirmReplace(name: string) {
  return confirmDialog({
    title: t("projects_ui.page.context.replace_title", { name }),
    description: t("projects_ui.page.context.replace_description"),
    confirmLabel: t("projects_ui.page.context.replace"),
    cancelLabel: t("projects_ui.page.context.keep"),
  });
}

/** "N archivos · X % de la capacidad del proyecto utilizada", with the limits in a tooltip. */
export function ContextCapacityBar({ usage, agentPath }: { usage: ProjectUsage; agentPath: string }) {
  // The server computes it with projectUsagePercent (the fuller of bytes and files, floored).
  const percent = usage.usedPercent;
  return <div data-context-capacity className="grid gap-1.5 border-t border-border pt-3">
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span data-context-capacity-label className="min-w-0 flex-1">{t("projects_ui.page.context.capacity", { count: usage.files, percent })}</span>
      <Tooltip>
        <TooltipTrigger render={<button type="button" data-context-capacity-info aria-label={t("projects_ui.page.context.limits_label")} className="inline-flex size-6 items-center justify-center rounded-full hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none" />}>
          <Info className="size-4" aria-hidden />
        </TooltipTrigger>
        <TooltipContent className="flex-col items-start">
          <span>{t("projects_ui.page.context.limits", {
            bytes: formatContextSize(usage.capacityBytes), files: usage.capacityFiles, file: formatContextSize(PROJECT_LIMITS.contextFileBytes),
            folders: PROJECT_LIMITS.contextFolders, depth: PROJECT_LIMITS.contextDepth,
          })}</span>
          <span>{t("projects_ui.page.context.used", { bytes: formatContextSize(usage.bytes), capacity: formatContextSize(usage.capacityBytes) })}</span>
          {agentPath ? <span>{t("projects_ui.page.context.agent_path", { path: agentPath })}</span> : null}
        </TooltipContent>
      </Tooltip>
    </div>
    <Progress value={percent} aria-label={t("projects_ui.page.context.capacity_label")} data-context-capacity-bar />
  </div>;
}

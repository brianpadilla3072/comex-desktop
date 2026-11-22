/** @jsxImportSource react */
import { useEffect, useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { OpenworkServerError } from "@/app/lib/openwork-server";
import type { ProjectMemory } from "@/app/lib/projects";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import { PairDeviceHint } from "@/react-app/shell/pair-device-hint";

import { projectQueryKeys, type ProjectPageClient } from "./project-page-data";
import { formatRelative, isMemoryConflict, projectErrorText } from "./project-page-model";

/** `null`: adding a note; a note id: editing it. */
type Editing = { id: string | null; text: string };

/**
 * Runs a memory write with the last revision; when someone else changed the memory meanwhile
 * (`memory_conflict`) it reads it again and retries once with the new revision.
 */
export async function withMemoryRevision(
  read: () => Promise<ProjectMemory>,
  current: ProjectMemory,
  write: (revision: number, memory: ProjectMemory) => Promise<ProjectMemory>,
): Promise<ProjectMemory> {
  try {
    return await write(current.revision, current);
  } catch (cause) {
    if (!isMemoryConflict(cause)) throw cause;
    const fresh = await read();
    return write(fresh.revision, fresh);
  }
}

export function ProjectMemoryDialog({ client, workspaceId, open, writable, onOpenChange }: {
  client: ProjectPageClient;
  workspaceId: string;
  open: boolean;
  writable: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const fieldId = useId();
  const key = projectQueryKeys.memory(client.baseUrl, workspaceId);
  const query = useQuery({ queryKey: key, queryFn: () => client.getProjectMemory(workspaceId), enabled: open, retry: false });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!open) { setEditing(null); setError(null); } }, [open]);

  const memory = query.data;
  const canWrite = writable && Boolean(memory?.writable);
  const full = Boolean(memory && memory.notes.length >= memory.maxNotes);
  const maxChars = memory?.maxChars ?? 800;
  const editingTooLong = Boolean(editing && editing.text.length > maxChars);

  const read = () => client.getProjectMemory(workspaceId);
  const commit = async (write: (revision: number, memory: ProjectMemory) => Promise<ProjectMemory>, fallbackKey: string) => {
    if (!memory || busy) return false;
    setBusy(true);
    setError(null);
    try {
      const next = await withMemoryRevision(read, memory, write);
      queryClient.setQueryData(key, next);
      void queryClient.invalidateQueries({ queryKey: projectQueryKeys.detail(client.baseUrl, workspaceId) });
      return true;
    } catch (cause) {
      setError(projectErrorText(cause, fallbackKey));
      void query.refetch();
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!editing || !editing.text.trim() || editingTooLong) return;
    const { id, text } = editing;
    const saved = await commit(async (revision, latest) => {
      // A note removed meanwhile cannot be replaced: say so instead of adding it back.
      if (id && !latest.notes.some(note => note.id === id)) throw new OpenworkServerError(404, "memory_note_missing", "Note missing");
      return client.saveProjectMemoryNote(workspaceId, { expectedRevision: revision, text: text.trim(), ...(id ? { id } : {}) });
    }, "projects_ui.page.memory.save_failed");
    if (saved) setEditing(null);
  };

  const remove = async (noteId: string) => {
    const confirmed = await confirmDialog({
      title: t("projects_ui.page.memory.delete_title"),
      description: t("projects_ui.page.memory.delete_description"),
      confirmLabel: t("projects_ui.page.delete"),
      cancelLabel: t("projects_ui.page.cancel"),
      destructive: true,
    });
    if (!confirmed) return;
    await commit((revision, latest) => latest.notes.some(note => note.id === noteId)
      ? client.deleteProjectMemoryNote(workspaceId, noteId, revision)
      : Promise.resolve(latest), "projects_ui.page.memory.delete_failed");
  };

  const editor = editing ? <form data-memory-editor className="grid gap-2" onSubmit={event => { event.preventDefault(); void save(); }}>
    <Label htmlFor={fieldId} className="sr-only">{editing.id ? t("projects_ui.page.memory.edit_note") : t("projects_ui.page.memory.add_note")}</Label>
    <Textarea id={fieldId} data-memory-text autoFocus rows={4} value={editing.text} aria-invalid={editingTooLong || undefined}
      placeholder={t("projects_ui.page.memory.placeholder")} onChange={event => setEditing({ ...editing, text: event.target.value })} />
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className={cn("text-xs text-muted-foreground tabular-nums", editingTooLong && "text-destructive")}>
        {t("projects_ui.page.char_count", { count: editing.text.length.toLocaleString(), max: maxChars.toLocaleString() })}
      </span>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={busy}>{t("projects_ui.page.cancel")}</Button>
        <Button type="submit" size="sm" data-memory-save disabled={busy || !editing.text.trim() || editingTooLong}>{busy ? t("projects_ui.page.saving") : t("projects_ui.page.save")}</Button>
      </div>
    </div>
  </form> : null;

  return <Dialog open={open} onOpenChange={next => { if (!busy) onOpenChange(next); }}>
    <DialogContent data-project-memory-dialog className="flex max-h-[min(92dvh,40rem)] flex-col lg:max-w-xl">
      <DialogHeader>
        <DialogTitle>{t("projects_ui.page.memory.title")}</DialogTitle>
      </DialogHeader>
      {query.isPending ? <div aria-busy="true" aria-label={t("projects_ui.page.loading")} className="grid gap-2">{[0, 1].map(index => <Skeleton key={index} className="h-14 w-full rounded-xl" />)}</div>
        : query.isError || !memory ? <div role="alert" className="flex flex-col items-start gap-2 text-sm">
          <span>{projectErrorText(query.error, "projects_ui.page.memory.load_failed")}</span>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>{t("projects_ui.page.retry")}</Button>
        </div>
        : <div className="grid min-h-0 gap-3 overflow-y-auto">
          {memory.notes.length ? <ul className="divide-y divide-border" aria-label={t("projects_ui.page.memory.title")}>
            {memory.notes.map(note => <li key={note.id} data-memory-note={note.id} className="grid gap-1 py-2">
              {editing?.id === note.id ? editor : <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 text-sm whitespace-pre-wrap">{note.text}</p>
                {canWrite ? <div className="flex shrink-0 gap-1">
                  <Button type="button" size="icon-sm" variant="ghost" data-memory-edit={note.id} aria-label={t("projects_ui.page.memory.edit_note")} disabled={busy}
                    onClick={() => setEditing({ id: note.id, text: note.text })}><Pencil className="size-4" /></Button>
                  <Button type="button" size="icon-sm" variant="ghost" data-memory-delete={note.id} aria-label={t("projects_ui.page.memory.delete_note")} disabled={busy}
                    onClick={() => void remove(note.id)}><Trash2 className="size-4" /></Button>
                </div> : null}
              </div>}
              <span className="text-xs text-muted-foreground">{formatRelative(Date.parse(note.updatedAt))}</span>
            </li>)}
          </ul> : <p data-memory-empty className="text-sm text-muted-foreground">{t("projects_ui.page.memory.empty")}</p>}
          {editing && editing.id === null ? editor : null}
          {canWrite && !editing ? <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" data-memory-add disabled={full || busy} onClick={() => setEditing({ id: null, text: "" })}><Plus className="size-4" />{t("projects_ui.page.memory.add_note")}</Button>
            <span className="text-xs text-muted-foreground">{full ? t("projects_ui.page.memory.full", { max: memory.maxNotes }) : t("projects_ui.page.memory.count", { count: memory.notes.length, max: memory.maxNotes })}</span>
          </div> : null}
          {!canWrite ? <p role="note" className="text-xs text-muted-foreground">{t("projects_ui.page.read_only")} <PairDeviceHint /></p> : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>}
    </DialogContent>
  </Dialog>;
}

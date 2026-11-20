/** @jsxImportSource react */
import { useEffect, useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { PROJECT_LIMITS } from "@/app/lib/projects";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import { PairDeviceHint } from "@/react-app/shell/pair-device-hint";

import { projectQueryKeys, type ProjectPageClient } from "./project-page-data";
import { projectErrorText } from "./project-page-model";

/** Instructions that reach every session of the project. An empty text removes them. */
export function ProjectInstructionsDialog({ client, workspaceId, open, writable, onOpenChange }: {
  client: ProjectPageClient;
  workspaceId: string;
  open: boolean;
  writable: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const fieldId = useId();
  const query = useQuery({
    queryKey: projectQueryKeys.instructions(client.baseUrl, workspaceId),
    queryFn: () => client.getProjectInstructions(workspaceId),
    enabled: open,
    retry: false,
  });
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loaded = query.data?.text;
  useEffect(() => {
    if (open && loaded !== undefined) setText(loaded);
  }, [open, loaded]);
  useEffect(() => {
    if (!open) setError(null);
  }, [open]);

  const maxChars = query.data?.maxChars ?? PROJECT_LIMITS.instructionsChars;
  const tooLong = text.length > maxChars;
  const unchanged = loaded !== undefined && text === loaded;

  const save = async () => {
    if (!writable || saving || tooLong) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await client.setProjectInstructions(workspaceId, text.trim() ? text : "");
      queryClient.setQueryData(projectQueryKeys.instructions(client.baseUrl, workspaceId), saved);
      await queryClient.invalidateQueries({ queryKey: projectQueryKeys.detail(client.baseUrl, workspaceId) });
      onOpenChange(false);
    } catch (cause) {
      setError(projectErrorText(cause, "projects_ui.page.instructions.save_failed"));
    } finally {
      setSaving(false);
    }
  };

  return <Dialog open={open} onOpenChange={next => { if (!saving) onOpenChange(next); }}>
    <DialogContent data-project-instructions-dialog className="lg:max-w-xl">
      <DialogHeader>
        <DialogTitle>{t("projects_ui.page.instructions.title")}</DialogTitle>
        <DialogDescription>{t("projects_ui.page.instructions.description")}</DialogDescription>
      </DialogHeader>
      {query.isPending ? <Skeleton className="h-40 w-full rounded-xl" aria-label={t("projects_ui.page.loading")} />
        : query.isError ? <div role="alert" className="flex flex-col items-start gap-2 text-sm">
          <span>{projectErrorText(query.error, "projects_ui.page.instructions.load_failed")}</span>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>{t("projects_ui.page.retry")}</Button>
        </div>
        : <form className="grid gap-2" onSubmit={event => { event.preventDefault(); void save(); }}>
          <Label htmlFor={fieldId} className="sr-only">{t("projects_ui.page.instructions.title")}</Label>
          <Textarea id={fieldId} data-project-instructions-text autoFocus={writable} readOnly={!writable} rows={10} value={text}
            aria-invalid={tooLong || undefined} aria-describedby={`${fieldId}-count`}
            placeholder={t("projects_ui.page.instructions.placeholder")} className="max-h-[50dvh] min-h-40"
            onChange={event => setText(event.target.value)} />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{!writable ? <>{t("projects_ui.page.read_only")} <PairDeviceHint /></> : !text.trim() && loaded ? t("projects_ui.page.instructions.empty_removes") : null}</span>
            <span id={`${fieldId}-count`} data-project-instructions-count className={cn("tabular-nums", tooLong && "text-destructive")}>
              {t("projects_ui.page.char_count", { count: text.length.toLocaleString(), max: maxChars.toLocaleString() })}
            </span>
          </div>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{writable ? t("projects_ui.page.cancel") : t("projects_ui.page.close")}</Button>
            {writable ? <Button type="submit" data-project-instructions-save disabled={saving || tooLong || unchanged}>{saving ? t("projects_ui.page.saving") : t("projects_ui.page.save")}</Button> : null}
          </DialogFooter>
        </form>}
    </DialogContent>
  </Dialog>;
}

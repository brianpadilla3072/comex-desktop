/** @jsxImportSource react */
import { useEffect, useId, useState } from "react";

import { DESIGN_LIMITS, designKindLabel, type DesignKind, type DesignManifest } from "@/app/lib/designs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { t } from "@/i18n";

import { designErrorText, type DesignClient } from "./design-client";

export type DesignProjectOption = { workspaceId: string; name: string };

/** "Nuevo diseño": the project it goes in and its title. Creating opens it. */
export function DesignCreateDialog({ client, kind, projects, defaultWorkspaceId, onOpenChange, onCreated }: {
  client: Pick<DesignClient, "createDesign">;
  /** The kind being created; null closes the dialog. */
  kind: DesignKind | null;
  projects: DesignProjectOption[];
  defaultWorkspaceId: string | null;
  onOpenChange: (open: boolean) => void;
  onCreated: (design: DesignManifest, workspaceId: string) => void;
}) {
  const titleId = useId();
  const projectId = useId();
  const [title, setTitle] = useState("");
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!kind) return;
    setTitle(t("design_ui.studio.untitled", { kind: designKindLabel(kind) }));
    setWorkspaceId(projects.some(project => project.workspaceId === defaultWorkspaceId) ? defaultWorkspaceId : projects[0]?.workspaceId ?? null);
    setError(null);
  }, [kind, defaultWorkspaceId, projects]);

  const clean = title.trim();
  const valid = Boolean(kind && workspaceId && clean && clean.length <= DESIGN_LIMITS.titleChars);

  const create = async () => {
    if (!kind || !workspaceId || !valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const design = await client.createDesign({ workspaceId, kind, title: clean });
      onCreated(design, workspaceId);
    } catch (cause) { setError(designErrorText(cause)); }
    finally { setBusy(false); }
  };

  return <Dialog open={kind !== null} onOpenChange={next => { if (!busy) onOpenChange(next); }}>
    <DialogContent data-design-create-dialog className="lg:max-w-md">
      <DialogHeader>
        <DialogTitle>{kind ? t("design_ui.studio.create_title", { kind: designKindLabel(kind) }) : null}</DialogTitle>
      </DialogHeader>
      {projects.length === 0 ? <p role="status" className="text-sm text-muted-foreground">{t("design_ui.studio.create_no_projects")}</p>
        : <form className="grid gap-3" onSubmit={event => { event.preventDefault(); void create(); }}>
          <div className="grid gap-1.5">
            <Label htmlFor={projectId}>{t("design_ui.studio.create_project")}</Label>
            <Select value={workspaceId ?? ""} items={projects.map(project => ({ value: project.workspaceId, label: project.name }))} onValueChange={value => { if (typeof value === "string") setWorkspaceId(value); }}>
              <SelectTrigger id={projectId} data-design-create-project className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>{projects.map(project => <SelectItem key={project.workspaceId} value={project.workspaceId}>{project.name}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={titleId}>{t("design_ui.studio.create_name")}</Label>
            <Input id={titleId} data-design-create-name autoFocus value={title} maxLength={DESIGN_LIMITS.titleChars} onChange={event => setTitle(event.target.value)} />
          </div>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>{t("design_ui.studio.cancel")}</Button>
            <Button type="submit" data-design-create-submit disabled={!valid || busy}>{busy ? t("design_ui.studio.creating") : t("design_ui.studio.create")}</Button>
          </DialogFooter>
        </form>}
    </DialogContent>
  </Dialog>;
}

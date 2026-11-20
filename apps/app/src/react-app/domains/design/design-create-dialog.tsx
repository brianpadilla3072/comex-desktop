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

/**
 * How the dialog gets a project when there is none yet. A project lives in an application:
 * with one, the dialog creates the project and the design in one step; without one, it opens
 * the application form, which comes back here with its first project.
 */
export type DesignNewProject = {
  applications: { id: string; name: string }[];
  createProject: (applicationId: string, name: string) => Promise<string>;
  createApplication: ((kind: DesignKind) => void) | null;
};

/** "Nuevo diseño": the project it goes in and its title. Creating opens it. */
export function DesignCreateDialog({ client, kind, projects, defaultWorkspaceId, newProject = null, onOpenChange, onCreated }: {
  client: Pick<DesignClient, "createDesign">;
  /** The kind being created; null closes the dialog. */
  kind: DesignKind | null;
  projects: DesignProjectOption[];
  defaultWorkspaceId: string | null;
  newProject?: DesignNewProject | null;
  onOpenChange: (open: boolean) => void;
  onCreated: (design: DesignManifest, workspaceId: string) => void;
}) {
  const titleId = useId();
  const projectId = useId();
  const [title, setTitle] = useState("");
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const newProjectId = useId();
  const applicationId = useId();
  const [projectName, setProjectName] = useState("");
  const [application, setApplication] = useState<string | null>(null);
  // A project made by this dialog whose design then failed: a retry reuses it instead of making another.
  const [createdProject, setCreatedProject] = useState<string | null>(null);
  const creatingProject = projects.length === 0 && (newProject?.applications.length ?? 0) > 0;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!kind) return;
    setTitle(t("design_ui.studio.untitled", { kind: designKindLabel(kind) }));
    setWorkspaceId(projects.some(project => project.workspaceId === defaultWorkspaceId) ? defaultWorkspaceId : projects[0]?.workspaceId ?? null);
    setProjectName(t("design_ui.studio.new_project_default"));
    setApplication(newProject?.applications[0]?.id ?? null);
    setCreatedProject(null);
    setError(null);
  }, [kind, defaultWorkspaceId, projects, newProject]);

  const clean = title.trim();
  const cleanProject = projectName.trim();
  const valid = Boolean(kind && clean && clean.length <= DESIGN_LIMITS.titleChars
    && (creatingProject ? application && cleanProject && cleanProject.length <= 80 : workspaceId));

  const create = async () => {
    if (!kind || !valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      // The project first (when there is none), then the design inside it: one action for the person.
      let target = creatingProject ? createdProject : workspaceId;
      if (!target && creatingProject && newProject && application) {
        target = await newProject.createProject(application, cleanProject);
        setCreatedProject(target);
      }
      if (!target) return;
      const design = await client.createDesign({ workspaceId: target, kind, title: clean });
      onCreated(design, target);
    } catch (cause) { setError(designErrorText(cause)); }
    finally { setBusy(false); }
  };

  const needsApplication = projects.length === 0 && !creatingProject;

  return <Dialog open={kind !== null} onOpenChange={next => { if (!busy) onOpenChange(next); }}>
    <DialogContent data-design-create-dialog className="lg:max-w-md">
      <DialogHeader>
        <DialogTitle>{kind ? t("design_ui.studio.create_title", { kind: designKindLabel(kind) }) : null}</DialogTitle>
      </DialogHeader>
      {needsApplication ? <div className="grid gap-3">
          <p role="status" className="text-sm text-muted-foreground">{t(newProject?.createApplication ? "design_ui.studio.create_needs_application" : "design_ui.studio.create_no_projects")}</p>
          {newProject?.createApplication && kind ? <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("design_ui.studio.cancel")}</Button>
            <Button type="button" data-design-create-application onClick={() => { const chosen = kind; onOpenChange(false); newProject.createApplication?.(chosen); }}>{t("design_ui.studio.create_application")}</Button>
          </DialogFooter> : null}
        </div>
        : <form className="grid gap-3" onSubmit={event => { event.preventDefault(); void create(); }}>
          {creatingProject && newProject ? <>
            {newProject.applications.length > 1 ? <div className="grid gap-1.5">
              <Label htmlFor={applicationId}>{t("design_ui.studio.create_application_label")}</Label>
              <Select value={application ?? ""} items={newProject.applications.map(item => ({ value: item.id, label: item.name }))} onValueChange={value => { if (typeof value === "string") setApplication(value); }}>
                <SelectTrigger id={applicationId} data-design-create-application-select className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>{newProject.applications.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
            </div> : null}
            <div className="grid gap-1.5">
              <Label htmlFor={newProjectId}>{t("design_ui.studio.create_new_project")}</Label>
              <Input id={newProjectId} data-design-create-new-project value={projectName} maxLength={80} onChange={event => setProjectName(event.target.value)} />
            </div>
          </> : <div className="grid gap-1.5">
            <Label htmlFor={projectId}>{t("design_ui.studio.create_project")}</Label>
            <Select value={workspaceId ?? ""} items={projects.map(project => ({ value: project.workspaceId, label: project.name }))} onValueChange={value => { if (typeof value === "string") setWorkspaceId(value); }}>
              <SelectTrigger id={projectId} data-design-create-project className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>{projects.map(project => <SelectItem key={project.workspaceId} value={project.workspaceId}>{project.name}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          </div>}
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

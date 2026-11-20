/** @jsxImportSource react */
import { useEffect, useId, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, CircleAlert, Pause, Pencil, Play, Plus, ShieldAlert, Trash2, FlaskConical } from "lucide-react";

import type { ProjectTask, ProjectTaskList } from "@/app/lib/projects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import { PairDeviceHint } from "@/react-app/shell/pair-device-hint";

import { projectQueryKeys, useProjectEngineModels, type ProjectPageClient } from "./project-page-data";
import {
  DEFAULT_MODEL_KEY, TASK_FREQUENCIES, WEEKDAYS, buildTaskInput, describeSchedule, emptyTaskForm, formatDateTime, modelKey,
  projectErrorText, taskFormFromTask, weekdayLabel,
  type TaskForm, type TaskFormErrors, type TaskFrequency,
} from "./project-page-model";

export type ProjectTasksView = "list" | "create";
type View = { kind: "list" } | { kind: "form"; task: ProjectTask | null };
type Notice = { text: string; dryRunTaskId?: string; session?: { workspaceId: string; sessionId: string } };

/** Scheduled tasks of one project: list with actions, and the "Nueva tarea programada" form. */
export function ProjectTasksDialog({ client, workspaceId, applicationId, open, initialView, writable, onOpenChange, onOpenSession }: {
  client: ProjectPageClient;
  workspaceId: string;
  /** From the project detail; the task list answers it too. */
  applicationId: string;
  open: boolean;
  initialView: ProjectTasksView;
  writable: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
}) {
  const queryClient = useQueryClient();
  const key = projectQueryKeys.tasks(client.baseUrl, workspaceId);
  const query = useQuery({ queryKey: key, queryFn: () => client.listProjectTasks(workspaceId), enabled: open, retry: false });
  const [view, setView] = useState<View>({ kind: "list" });
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setView(initialView === "create" && writable ? { kind: "form", task: null } : { kind: "list" });
    setNotice(null);
    setError(null);
  }, [open, initialView, writable]);

  const list = query.data;
  const canWrite = writable && Boolean(list?.writable ?? true);
  const appId = list?.applicationId ?? applicationId;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: projectQueryKeys.detail(client.baseUrl, workspaceId) });
  };

  const act = async (id: string, action: () => Promise<Notice | null | void>, fallbackKey: string) => {
    if (busy) return;
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      if (result) setNotice(result);
      await refresh();
    } catch (cause) {
      setError(projectErrorText(cause, fallbackKey));
    } finally {
      setBusy(null);
    }
  };

  const dryRun = (task: { id: string }) => act(`dry:${task.id}`, async () => {
    const result = await client.dryRunSpecialistTask(appId, task.id);
    if (!result.started) return { text: result.detail ?? t("projects_ui.page.tasks.dry_run_not_started") };
    return {
      text: t("projects_ui.page.tasks.dry_run_started"),
      session: result.sessionId ? { workspaceId: result.workspaceId ?? workspaceId, sessionId: result.sessionId } : undefined,
    };
  }, "projects_ui.page.tasks.dry_run_failed");

  const remove = async (task: ProjectTask) => {
    const confirmed = await confirmDialog({
      title: t("projects_ui.page.tasks.delete_title", { name: task.name }),
      description: t("projects_ui.page.tasks.delete_description"),
      confirmLabel: t("projects_ui.page.delete"),
      cancelLabel: t("projects_ui.page.cancel"),
      destructive: true,
    });
    if (confirmed) await act(task.id, async () => { await client.deleteSpecialistTask(appId, task.id); }, "projects_ui.page.tasks.delete_failed");
  };

  const title = view.kind === "form" ? view.task ? t("projects_ui.page.tasks.edit_title") : t("projects_ui.page.tasks.new_title") : t("projects_ui.page.tasks.title");

  return <Dialog open={open} onOpenChange={next => { if (!busy) onOpenChange(next); }}>
    <DialogContent data-project-tasks-dialog className="flex max-h-[min(92dvh,48rem)] flex-col lg:max-w-xl">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      {query.isPending ? <div aria-busy="true" aria-label={t("projects_ui.page.loading")} className="grid gap-2">{[0, 1].map(index => <Skeleton key={index} className="h-16 w-full rounded-xl" />)}</div>
        : query.isError || !list ? <div role="alert" className="flex flex-col items-start gap-2 text-sm">
          <span>{projectErrorText(query.error, "projects_ui.page.tasks.load_failed")}</span>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>{t("projects_ui.page.retry")}</Button>
        </div>
        : view.kind === "form" && canWrite ? <TaskFormView client={client} workspaceId={workspaceId} applicationId={appId} list={list} task={view.task}
          onCancel={() => list.tasks.length || view.task ? setView({ kind: "list" }) : onOpenChange(false)}
          onDryRun={dryRun} dryRunBusy={busy?.startsWith("dry:") ?? false}
          onSaved={async (saved, created) => {
            await refresh();
            setError(null);
            setNotice({ text: created ? t("projects_ui.page.tasks.created", { name: saved.name }) : t("projects_ui.page.tasks.saved", { name: saved.name }), dryRunTaskId: created && list.capabilities.dryRun ? saved.id : undefined });
            setView({ kind: "list" });
          }} />
        : <div className="grid min-h-0 gap-3 overflow-y-auto">
          {notice ? <div role="status" data-tasks-notice className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-0 flex-1">{notice.text}</span>
            {notice.dryRunTaskId ? <Button size="sm" variant="outline" data-tasks-notice-dry-run disabled={Boolean(busy)} onClick={() => void dryRun({ id: notice.dryRunTaskId ?? "" })}><FlaskConical className="size-4" />{t("projects_ui.page.tasks.dry_run")}</Button> : null}
            {notice.session ? <Button size="sm" variant="outline" data-tasks-open-session onClick={() => { if (notice.session) onOpenSession(notice.session.workspaceId, notice.session.sessionId); }}>{t("projects_ui.page.tasks.open_session")}</Button> : null}
          </div> : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          {list.tasks.length ? <ul className="divide-y divide-border" aria-label={t("projects_ui.page.tasks.title")}>
            {list.tasks.map(task => <TaskRow key={task.id} task={task} canWrite={canWrite} busy={busy} dryRunAvailable={list.capabilities.dryRun}
              onEdit={() => { setNotice(null); setView({ kind: "form", task }); }}
              onRunNow={() => void act(task.id, async () => {
                const result = await client.runSpecialistTaskNow(appId, task.id);
                return { text: result.started ? t("projects_ui.page.tasks.run_started", { name: task.name }) : result.detail ?? t("projects_ui.page.tasks.run_not_started") };
              }, "projects_ui.page.tasks.run_failed")}
              onToggle={() => void act(task.id, async () => { await client.updateProjectTask(appId, task.id, { enabled: !task.enabled }); }, "projects_ui.page.tasks.save_failed")}
              onDryRun={() => void dryRun(task)}
              onDelete={() => void remove(task)} />)}
          </ul> : <p data-tasks-empty className="text-sm text-muted-foreground">{t("projects_ui.page.tasks.empty")}</p>}
          {canWrite ? <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" data-tasks-new disabled={list.tasks.length >= list.limit || Boolean(busy)} onClick={() => { setNotice(null); setView({ kind: "form", task: null }); }}><Plus className="size-4" />{t("projects_ui.page.tasks.new_title")}</Button>
            {list.tasks.length >= list.limit ? <span className="text-xs text-muted-foreground">{t("projects_ui.page.error.task_limit")}</span> : null}
          </div> : <p role="note" className="text-xs text-muted-foreground">{t("projects_ui.page.read_only")} <PairDeviceHint /></p>}
        </div>}
    </DialogContent>
  </Dialog>;
}

export const permissionModeLabel = (mode: ProjectTask["permissionMode"]) => mode === "auto" ? t("projects_ui.page.tasks.mode_auto") : t("projects_ui.page.tasks.mode_manual");

function TaskRow({ task, canWrite, busy, dryRunAvailable, onEdit, onRunNow, onToggle, onDryRun, onDelete }: {
  task: ProjectTask; canWrite: boolean; busy: string | null; dryRunAvailable: boolean;
  onEdit: () => void; onRunNow: () => void; onToggle: () => void; onDryRun: () => void; onDelete: () => void;
}) {
  const disabled = Boolean(busy);
  return <li data-task-row={task.id} className="grid gap-1.5 py-2.5">
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="min-w-0 flex-1 truncate font-medium">{task.name}</span>
      <Badge variant={task.permissionMode === "auto" ? "secondary" : "outline"} data-task-mode={task.permissionMode}>{permissionModeLabel(task.permissionMode)}</Badge>
      {!task.enabled ? <Badge variant="outline" data-task-paused>{t("projects_ui.page.tasks.paused")}</Badge> : null}
      {task.lastStatus === "failed" || task.lastStatus === "blocked" ? <Badge variant="destructive"><CircleAlert aria-hidden />{task.lastStatus === "failed" ? t("projects_ui.page.tasks.last_failed") : t("projects_ui.page.tasks.last_blocked")}</Badge> : null}
    </div>
    <p className="text-xs text-muted-foreground">
      <span data-task-schedule>{describeSchedule(task.schedule)}</span>
      {" · "}
      <span data-task-next>{task.enabled && task.nextRunAt !== null ? t("projects_ui.page.tasks.next_run", { when: formatDateTime(task.nextRunAt) }) : t("projects_ui.page.tasks.no_next_run")}</span>
      {task.running ? <>{" · "}{t("projects_ui.page.tasks.running")}</> : null}
    </p>
    {canWrite ? <div className="flex flex-wrap gap-1">
      <Button size="xs" variant="ghost" data-task-edit={task.id} disabled={disabled} onClick={onEdit}><Pencil />{t("projects_ui.page.edit")}</Button>
      <Button size="xs" variant="ghost" data-task-run={task.id} disabled={disabled || task.running} onClick={onRunNow}><Play />{t("projects_ui.page.tasks.run_now")}</Button>
      <Button size="xs" variant="ghost" data-task-toggle={task.id} disabled={disabled} onClick={onToggle}>{task.enabled ? <><Pause />{t("projects_ui.page.tasks.pause")}</> : <><Play />{t("projects_ui.page.tasks.resume")}</>}</Button>
      {dryRunAvailable ? <Button size="xs" variant="ghost" data-task-dry-run={task.id} disabled={disabled} onClick={onDryRun}><FlaskConical />{t("projects_ui.page.tasks.dry_run_short")}</Button> : null}
      <Button size="xs" variant="ghost" data-task-delete={task.id} className="text-destructive" disabled={disabled} onClick={onDelete}><Trash2 />{t("projects_ui.page.delete")}</Button>
    </div> : null}
  </li>;
}

function FieldError({ id, error }: { id: string; error?: string }) {
  return error ? <p id={id} role="alert" data-field-error className="text-xs text-destructive">{t(error)}</p> : null;
}

function Field({ id, label, error, children, className }: { id: string; label: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return <div className={cn("grid gap-1.5", className)}>
    <Label htmlFor={id}>{label}</Label>
    {children}
    <FieldError id={`${id}-error`} error={error} />
  </div>;
}

const FREQUENCY_LABEL: Record<TaskFrequency, string> = {
  daily: "projects_ui.page.tasks.frequency_daily",
  weekly: "projects_ui.page.tasks.frequency_weekly",
  monthly: "projects_ui.page.tasks.frequency_monthly",
  once: "projects_ui.page.tasks.frequency_once",
  interval: "projects_ui.page.tasks.frequency_interval",
};

function TaskFormView({ client, workspaceId, applicationId, list, task, onCancel, onSaved, onDryRun, dryRunBusy }: {
  client: ProjectPageClient;
  workspaceId: string;
  applicationId: string;
  list: ProjectTaskList;
  task: ProjectTask | null;
  onCancel: () => void;
  onSaved: (task: { id: string; name: string }, created: boolean) => Promise<void>;
  onDryRun: (task: { id: string }) => Promise<void>;
  dryRunBusy: boolean;
}) {
  const id = useId();
  const [form, setForm] = useState<TaskForm>(() => task ? taskFormFromTask(task) : emptyTaskForm());
  const [errors, setErrors] = useState<TaskFormErrors>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const models = useProjectEngineModels(client, workspaceId, true);
  const update = (patch: Partial<TaskForm>) => {
    setForm(current => ({ ...current, ...patch }));
    setErrors(current => {
      const next = { ...current };
      for (const field of Object.keys(patch)) Reflect.deleteProperty(next, field === "frequency" ? "everyMinutes" : field);
      return next;
    });
  };

  const modelItems = [
    { value: DEFAULT_MODEL_KEY, label: t("projects_ui.page.tasks.model_default") },
    ...(models.data ?? []).map(model => ({ value: modelKey(model), label: `${model.name} · ${model.providerID}` })),
  ];
  // A pinned model the engine no longer lists still shows, so editing never drops it silently.
  if (task?.model && !modelItems.some(item => item.value === modelKey(task.model ?? { providerID: "", modelID: "" }))) {
    modelItems.push({ value: modelKey(task.model), label: `${task.model.modelID} · ${task.model.providerID}` });
  }

  const submit = async () => {
    const built = buildTaskInput(form, { isolationAvailable: list.capabilities.isolation });
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = task
        ? await client.updateProjectTask(applicationId, task.id, built.input)
        : await client.createProjectTask(applicationId, workspaceId, built.input);
      await onSaved(saved.task, !task);
    } catch (cause) {
      setError(projectErrorText(cause, "projects_ui.page.tasks.save_failed"));
    } finally {
      setSaving(false);
    }
  };

  const described = (field: string, error?: string) => error ? { "aria-invalid": true, "aria-describedby": `${id}-${field}-error` } : {};

  return <form data-task-form noValidate className="grid min-h-0 gap-4 overflow-y-auto" onSubmit={event => { event.preventDefault(); void submit(); }}>
    {task || list.tasks.length ? <Button type="button" size="sm" variant="ghost" className="justify-self-start" onClick={onCancel}><ArrowLeft className="size-4" />{t("projects_ui.page.tasks.back")}</Button> : null}
    <Field id={`${id}-name`} label={t("projects_ui.page.tasks.name")} error={errors.name}>
      <Input id={`${id}-name`} data-task-name autoFocus value={form.name} maxLength={120} placeholder={t("projects_ui.page.tasks.name_placeholder")}
        {...described("name", errors.name)} onChange={event => update({ name: event.target.value })} />
    </Field>
    <Field id={`${id}-prompt`} label={t("projects_ui.page.tasks.prompt")} error={errors.prompt}>
      <Textarea id={`${id}-prompt`} data-task-prompt rows={4} value={form.prompt} placeholder={t("projects_ui.page.tasks.prompt_placeholder")}
        {...described("prompt", errors.prompt)} onChange={event => update({ prompt: event.target.value })} />
    </Field>

    <div className="grid gap-3 sm:grid-cols-2">
      <div className="grid gap-1.5">
        <span id={`${id}-mode`} className="text-sm font-medium">{t("projects_ui.page.tasks.permission_mode")}</span>
        <ToggleGroup aria-labelledby={`${id}-mode`} data-task-mode-select variant="outline" value={[form.permissionMode]}
          onValueChange={value => { if (value[0] === "auto" || value[0] === "manual") update({ permissionMode: value[0] }); }}>
          <ToggleGroupItem value="auto" data-task-mode-option="auto">{t("projects_ui.page.tasks.mode_auto")}</ToggleGroupItem>
          <ToggleGroupItem value="manual" data-task-mode-option="manual">{t("projects_ui.page.tasks.mode_manual")}</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="grid min-w-0 gap-1.5">
        <Label htmlFor={`${id}-model`}>{t("projects_ui.page.tasks.model")}</Label>
        <Select value={form.model} items={modelItems} onValueChange={value => update({ model: typeof value === "string" ? value : DEFAULT_MODEL_KEY })}>
          <SelectTrigger id={`${id}-model`} data-task-model className="w-full min-w-0"><SelectValue /></SelectTrigger>
          <SelectContent>
            {modelItems.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {models.isError ? <p className="text-xs text-muted-foreground">{t("projects_ui.page.tasks.models_unavailable")}</p> : null}
      </div>
    </div>

    {form.permissionMode === "auto" ? <div role="note" data-task-auto-notice className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 p-3 text-sm">
      <ShieldAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="grid min-w-0 gap-1">
        <span>{t("projects_ui.page.tasks.auto_notice")}</span>
        <Popover>
          <PopoverTrigger render={<button type="button" data-task-safety-tips className="justify-self-start text-xs font-medium underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none" />}>
            {t("projects_ui.page.tasks.safety_tips")}
          </PopoverTrigger>
          <PopoverContent className="max-w-sm text-sm">
            <PopoverTitle>{t("projects_ui.page.tasks.safety_tips")}</PopoverTitle>
            <ul className="grid list-disc gap-1 ps-4 text-muted-foreground">
              <li>{t("projects_ui.page.tasks.safety_tip_1")}</li>
              <li>{t("projects_ui.page.tasks.safety_tip_2")}</li>
              <li>{t("projects_ui.page.tasks.safety_tip_3")}</li>
              <li>{t("projects_ui.page.tasks.safety_tip_4")}</li>
            </ul>
          </PopoverContent>
        </Popover>
      </div>
    </div> : null}

    <fieldset className="grid gap-3">
      <legend className="mb-1 text-sm font-medium">{t("projects_ui.page.tasks.trigger")} <span className="font-normal text-muted-foreground">{t("projects_ui.page.tasks.trigger_schedule")}</span></legend>
      <ToggleGroup aria-label={t("projects_ui.page.tasks.frequency")} data-task-frequency variant="outline" spacing={1} className="flex-wrap" value={[form.frequency]}
        onValueChange={value => { const next = TASK_FREQUENCIES.find(item => item === value[0]); if (next) update({ frequency: next }); }}>
        {TASK_FREQUENCIES.map(frequency => <ToggleGroupItem key={frequency} value={frequency} data-task-frequency-option={frequency}>{t(FREQUENCY_LABEL[frequency])}</ToggleGroupItem>)}
      </ToggleGroup>
      {form.frequency === "weekly" ? <div className="grid gap-1.5">
        <ToggleGroup aria-label={t("projects_ui.page.tasks.weekdays")} data-task-weekdays multiple variant="outline" spacing={1} className="flex-wrap" value={form.days.map(String)}
          onValueChange={value => update({ days: WEEKDAYS.filter(day => value.includes(String(day))) })}>
          {WEEKDAYS.map(day => <ToggleGroupItem key={day} value={String(day)} data-task-weekday={day} size="sm">{weekdayLabel(day)}</ToggleGroupItem>)}
        </ToggleGroup>
        <FieldError id={`${id}-days-error`} error={errors.days} />
      </div> : null}
      <div className="flex flex-wrap gap-3">
        {form.frequency === "monthly" ? <Field id={`${id}-day`} label={t("projects_ui.page.tasks.day_of_month")} error={errors.dayOfMonth} className="w-32">
          <Input id={`${id}-day`} data-task-day-of-month type="number" inputMode="numeric" min={1} max={31} value={form.dayOfMonth}
            {...described("day", errors.dayOfMonth)} onChange={event => update({ dayOfMonth: event.target.value })} />
        </Field> : null}
        {form.frequency === "once" ? <Field id={`${id}-date`} label={t("projects_ui.page.tasks.date")} error={errors.date} className="w-44">
          <Input id={`${id}-date`} data-task-date type="date" value={form.date} {...described("date", errors.date)} onChange={event => update({ date: event.target.value })} />
        </Field> : null}
        {form.frequency === "interval" ? <Field id={`${id}-every`} label={t("projects_ui.page.tasks.every_minutes")} error={errors.everyMinutes} className="w-40">
          <Input id={`${id}-every`} data-task-every type="number" inputMode="numeric" min={1} max={43200} value={form.everyMinutes}
            {...described("every", errors.everyMinutes)} onChange={event => update({ everyMinutes: event.target.value })} />
        </Field> : <Field id={`${id}-time`} label={t("projects_ui.page.tasks.time")} error={errors.time} className="w-32">
          <Input id={`${id}-time`} data-task-time type="time" value={form.time} {...described("time", errors.time)} onChange={event => update({ time: event.target.value })} />
        </Field>}
      </div>
      {form.frequency === "monthly" ? <p className="text-xs text-muted-foreground">{t("projects_ui.page.tasks.monthly_short_months")}</p> : null}
    </fieldset>

    <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
      <CollapsibleTrigger data-task-advanced className="flex items-center gap-1 rounded text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
        <ChevronRight className={cn("size-4 transition-transform duration-150", advancedOpen && "rotate-90")} aria-hidden />
        {t("projects_ui.page.tasks.advanced")}
      </CollapsibleTrigger>
      <CollapsibleContent className="grid gap-3 pt-3 ps-5">
        <div className="flex items-start gap-2">
          <Checkbox id={`${id}-catch-up`} data-task-catch-up checked={form.catchUp} onCheckedChange={checked => update({ catchUp: checked === true })} />
          <Label htmlFor={`${id}-catch-up`} className="font-normal">{t("projects_ui.page.tasks.catch_up")}</Label>
        </div>
        {list.capabilities.isolation ? <div className="flex items-start gap-2">
          <Switch id={`${id}-isolation`} data-task-isolation checked={form.isolation} onCheckedChange={checked => update({ isolation: checked })} size="sm" />
          <Label htmlFor={`${id}-isolation`} className="font-normal">{t("projects_ui.page.tasks.isolation")}</Label>
        </div> : null}
        {list.capabilities.dryRun ? <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" data-task-form-dry-run disabled={!task || dryRunBusy} onClick={() => { if (task) void onDryRun(task); }}>
            <FlaskConical className="size-4" />{t("projects_ui.page.tasks.dry_run")}
          </Button>
          {!task ? <span className="text-xs text-muted-foreground">{t("projects_ui.page.tasks.dry_run_after_create")}</span> : null}
        </div> : null}
      </CollapsibleContent>
    </Collapsible>

    {error ? <p role="alert" data-task-form-error className="text-sm text-destructive">{error}</p> : null}
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>{t("projects_ui.page.cancel")}</Button>
      <Button type="submit" data-task-submit disabled={saving}>{saving ? t("projects_ui.page.saving") : task ? t("projects_ui.page.save") : t("projects_ui.page.create")}</Button>
    </DialogFooter>
  </form>;
}

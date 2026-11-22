import { OpenworkServerError } from "@/app/lib/openwork-server";
import {
  PROJECT_LIMITS,
  isProjectErrorCode,
  projectTaskInputSchema,
  type ProjectContextEntry,
  type ProjectPermissionMode,
  type ProjectTask,
  type ProjectTaskInput,
  type ProjectTaskSchedule,
} from "@/app/lib/projects";
import { currentLocale, t } from "@/i18n";

/**
 * Pure helpers of the project page (`/projects/:workspaceId`, feature `projectsExperience`):
 * error texts, context paths, the scheduled-task form and schedule wording. The page and its
 * dialogs only render; everything a test needs to pin down lives here.
 */

/** `/projects/<id>` (one segment; built by `projectPageRoute`) → the id; anything else → null. */
export function projectRouteWorkspaceId(pathname: string): string | null {
  const match = /^\/projects\/([^/]+)\/?$/.exec(pathname);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/** A person-facing text for a failed project request: known codes map to `projects_ui.page.error.*`. */
export function projectErrorText(error: unknown, fallbackKey = "projects_ui.page.error.generic"): string {
  if (error instanceof OpenworkServerError) {
    if (isProjectErrorCode(error.code)) return t(`projects_ui.page.error.${error.code}`);
    if (error.status === 401 || error.status === 403) return t("projects_ui.page.error.read_only");
  }
  return t(fallbackKey);
}

export const isMemoryConflict = (error: unknown) => error instanceof OpenworkServerError && error.code === "memory_conflict";
export const isContextExists = (error: unknown) => error instanceof OpenworkServerError && error.code === "context_exists";

// ---------------------------------------------------------------------------------------------
// Context browser

export const joinContextPath = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);

/** Breadcrumb of a context folder: root first ("" path), then each folder down to `path`. */
export function contextBreadcrumb(path: string): { name: string; path: string }[] {
  const parts = path.split("/").filter(Boolean);
  return parts.map((name, index) => ({ name, path: parts.slice(0, index + 1).join("/") }));
}

/** Search filters the folder being shown (case- and accent-insensitive). */
export function filterContextEntries(entries: readonly ProjectContextEntry[], search: string): ProjectContextEntry[] {
  const needle = foldText(search.trim());
  if (!needle) return [...entries];
  return entries.filter(entry => foldText(entry.name).includes(needle));
}

const foldText = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();

/** Folders first, then files, each by name: the server's listing order. */
export function sortContextEntries(entries: readonly ProjectContextEntry[]): ProjectContextEntry[] {
  return [...entries].sort((left, right) => left.kind === right.kind
    ? left.name.localeCompare(right.name, "es", { sensitivity: "base" })
    : left.kind === "folder" ? -1 : 1);
}

/** The listing with `entry` added, or replacing the one at the same path. */
export function upsertContextEntry(entries: readonly ProjectContextEntry[], entry: ProjectContextEntry): ProjectContextEntry[] {
  return sortContextEntries([...entries.filter(item => item.path !== entry.path), entry]);
}

/** A folder name the person types (one level; the server re-checks every rule). */
export function contextFolderNameProblem(name: string, existing: readonly ProjectContextEntry[]): string | null {
  const value = name.trim();
  if (!value) return "projects_ui.page.context.folder_name_required";
  if (/[/\\:]/.test(value) || value === "." || value === ".." || value.startsWith(".")) return "projects_ui.page.context.folder_name_invalid";
  if (new TextEncoder().encode(value).length > 255) return "projects_ui.page.error.context_name_too_long";
  if (existing.some(entry => entry.name.toLocaleLowerCase() === value.toLocaleLowerCase())) return "projects_ui.page.error.context_exists";
  return null;
}

export function formatContextSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"] as const;
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  const rounded = index === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded.toLocaleString(currentLocale())} ${units[index]}`;
}

// ---------------------------------------------------------------------------------------------
// Time

export function formatRelative(timestampMs: number, now = Date.now()): string {
  const delta = now - timestampMs;
  const formatter = new Intl.RelativeTimeFormat(currentLocale(), { numeric: "auto" });
  if (delta < 60_000) return t("projects_ui.page.time.just_now");
  if (delta < 3_600_000) return formatter.format(-Math.round(delta / 60_000), "minute");
  if (delta < 86_400_000) return formatter.format(-Math.round(delta / 3_600_000), "hour");
  if (delta < 30 * 86_400_000) return formatter.format(-Math.round(delta / 86_400_000), "day");
  return new Date(timestampMs).toLocaleDateString(currentLocale(), { dateStyle: "medium" });
}

export const formatDateTime = (timestampMs: number) => new Date(timestampMs).toLocaleString(currentLocale(), { dateStyle: "medium", timeStyle: "short" });

// ---------------------------------------------------------------------------------------------
// Scheduled tasks

export type TaskFrequency = ProjectTaskSchedule["kind"];
export const TASK_FREQUENCIES: readonly TaskFrequency[] = ["daily", "weekly", "monthly", "once", "interval"];
/** Monday first, as people read a week; values are `Date#getDay()`. */
export const WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5, 6, 0];
export const DEFAULT_MODEL_KEY = "__default__";

export type TaskForm = {
  name: string;
  prompt: string;
  permissionMode: ProjectPermissionMode;
  /** `DEFAULT_MODEL_KEY` or `modelKey(model)`. */
  model: string;
  frequency: TaskFrequency;
  /** `HH:MM`, for daily, weekly, monthly and once. */
  time: string;
  days: number[];
  dayOfMonth: string;
  /** `YYYY-MM-DD`, for once. */
  date: string;
  everyMinutes: string;
  catchUp: boolean;
  isolation: boolean;
};

export type TaskFormField = "name" | "prompt" | "time" | "days" | "dayOfMonth" | "date" | "everyMinutes";
export type TaskFormErrors = Partial<Record<TaskFormField, string>>;

export const modelKey = (model: { providerID: string; modelID: string }) => JSON.stringify([model.providerID, model.modelID]);

export function parseModelKey(key: string): { providerID: string; modelID: string } | null {
  if (key === DEFAULT_MODEL_KEY) return null;
  try {
    const value: unknown = JSON.parse(key);
    if (Array.isArray(value) && typeof value[0] === "string" && typeof value[1] === "string" && value[0] && value[1]) return { providerID: value[0], modelID: value[1] };
  } catch {
    return null;
  }
  return null;
}

const pad = (value: number) => String(value).padStart(2, "0");
const localDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const localTime = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** A new task starts on Automático (the person sees the notice) and runs daily at 09:00. */
export function emptyTaskForm(now = Date.now()): TaskForm {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return {
    name: "", prompt: "", permissionMode: "auto", model: DEFAULT_MODEL_KEY,
    frequency: "daily", time: "09:00", days: [1], dayOfMonth: "1", date: localDate(tomorrow), everyMinutes: "60",
    catchUp: false, isolation: true,
  };
}

export function taskFormFromTask(task: ProjectTask, now = Date.now()): TaskForm {
  const base = emptyTaskForm(now);
  const schedule = task.schedule;
  const form: TaskForm = {
    ...base, name: task.name, prompt: task.prompt, permissionMode: task.permissionMode,
    model: task.model ? modelKey(task.model) : DEFAULT_MODEL_KEY, frequency: schedule.kind,
    catchUp: task.advanced.catchUp, isolation: task.advanced.isolation,
  };
  if (schedule.kind === "interval") return { ...form, everyMinutes: String(schedule.everyMinutes) };
  if (schedule.kind === "once") {
    const at = new Date(schedule.at);
    return { ...form, date: localDate(at), time: localTime(at) };
  }
  const time = `${pad(schedule.hour)}:${pad(schedule.minute)}`;
  if (schedule.kind === "weekly") return { ...form, time, days: [...schedule.daysOfWeek] };
  if (schedule.kind === "monthly") return { ...form, time, dayOfMonth: String(schedule.dayOfMonth) };
  return { ...form, time };
}

function parseTime(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

const wholeNumber = (value: string) => /^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;

/**
 * The request body for the form, or the field errors (same rules as the server's task schema).
 * `permissionMode` is always sent: the server's default (manual) only applies to inputs that never
 * had an owner choosing. `advanced.isolation` is sent only when the server says it has an effect.
 */
export function buildTaskInput(form: TaskForm, options: { isolationAvailable: boolean; now?: number }): { ok: true; input: ProjectTaskInput } | { ok: false; errors: TaskFormErrors } {
  const errors: TaskFormErrors = {};
  const name = form.name.trim();
  const prompt = form.prompt.trim();
  if (!name) errors.name = "projects_ui.page.tasks.error_name_required";
  else if (name.length > 120) errors.name = "projects_ui.page.tasks.error_name_long";
  if (!prompt) errors.prompt = "projects_ui.page.tasks.error_prompt_required";
  else if (prompt.length > PROJECT_LIMITS.instructionsChars) errors.prompt = "projects_ui.page.tasks.error_prompt_long";

  let schedule: ProjectTaskSchedule | null = null;
  const time = parseTime(form.time);
  if (form.frequency === "interval") {
    const every = wholeNumber(form.everyMinutes);
    if (!Number.isInteger(every) || every < 1 || every > 43_200) errors.everyMinutes = "projects_ui.page.tasks.error_every_minutes";
    else schedule = { kind: "interval", everyMinutes: every };
  } else if (!time) {
    errors.time = "projects_ui.page.tasks.error_time";
  } else if (form.frequency === "daily") {
    schedule = { kind: "daily", ...time };
  } else if (form.frequency === "weekly") {
    const days = [...new Set(form.days.filter(day => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b);
    if (!days.length) errors.days = "projects_ui.page.tasks.error_days";
    else schedule = { kind: "weekly", daysOfWeek: days, ...time };
  } else if (form.frequency === "monthly") {
    const day = wholeNumber(form.dayOfMonth);
    if (!Number.isInteger(day) || day < 1 || day > 31) errors.dayOfMonth = "projects_ui.page.tasks.error_day_of_month";
    else schedule = { kind: "monthly", dayOfMonth: day, ...time };
  } else {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(form.date);
    const at = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), time.hour, time.minute).getTime() : Number.NaN;
    if (!Number.isFinite(at)) errors.date = "projects_ui.page.tasks.error_date";
    else if (at <= (options.now ?? Date.now())) errors.date = "projects_ui.page.tasks.error_date_past";
    else schedule = { kind: "once", at };
  }

  if (Object.keys(errors).length || !schedule) return { ok: false, errors };
  const input: ProjectTaskInput = {
    name, prompt, schedule, model: parseModelKey(form.model), permissionMode: form.permissionMode,
    advanced: options.isolationAvailable ? { catchUp: form.catchUp, isolation: form.isolation } : { catchUp: form.catchUp },
  };
  const parsed = projectTaskInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: { name: "projects_ui.page.tasks.error_invalid" } };
  return { ok: true, input: parsed.data };
}

export const weekdayLabel = (day: number) => t(`projects_ui.page.weekday.${day}`);

/** The schedule in words: "Todos los días a las 09:00", "Lun, Mié a las 08:30", "Cada 30 minutos". */
export function describeSchedule(schedule: ProjectTaskSchedule): string {
  if (schedule.kind === "interval") {
    if (schedule.everyMinutes % 60 === 0) return t("projects_ui.page.schedule.every_hours", { count: schedule.everyMinutes / 60 });
    return t("projects_ui.page.schedule.every_minutes", { count: schedule.everyMinutes });
  }
  if (schedule.kind === "once") return t("projects_ui.page.schedule.once", { when: formatDateTime(schedule.at) });
  const time = `${pad(schedule.hour)}:${pad(schedule.minute)}`;
  if (schedule.kind === "daily") return t("projects_ui.page.schedule.daily", { time });
  if (schedule.kind === "monthly") return t("projects_ui.page.schedule.monthly", { day: schedule.dayOfMonth, time });
  const days = WEEKDAYS.filter(day => schedule.daysOfWeek.includes(day));
  if (days.length === 7) return t("projects_ui.page.schedule.daily", { time });
  return t("projects_ui.page.schedule.weekly", { days: days.map(weekdayLabel).join(", "), time });
}

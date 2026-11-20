/** @jsxImportSource react */
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const ownsDom = !GlobalRegistrator.isRegistered;
if (ownsDom) GlobalRegistrator.register({ url: "http://localhost/" });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { MemoryRouter } = await import("react-router");
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const { t } = await import("../src/i18n");
const { OpenworkServerError } = await import("../src/app/lib/openwork-server");
const { ConfirmDialogHost } = await import("../src/components/ui/confirm-dialog");
const { ProjectPagePanel } = await import("../src/react-app/domains/projects/project-page");
const { withMemoryRevision } = await import("../src/react-app/domains/projects/project-memory-dialog");
const model = await import("../src/react-app/domains/projects/project-page-model");
const { projectPageRoute } = await import("../src/react-app/domains/projects/projects-list-model");
type Client = import("../src/react-app/domains/projects/project-page-data").ProjectPageClient;
type Detail = import("../src/app/lib/projects").ProjectDetail;
type Listing = import("../src/app/lib/projects").ProjectContextListing;
type Memory = import("../src/app/lib/projects").ProjectMemory;
type TaskList = import("../src/app/lib/projects").ProjectTaskList;
type Task = import("../src/app/lib/projects").ProjectTask;
const { projectTaskInputSchema } = await import("../src/app/lib/projects");

const NOW = Date.now();
const NOTE_A = "11111111-1111-4111-8111-111111111111";
const NOTE_B = "22222222-2222-4222-8222-222222222222";
const usage = (files: number, bytes: number) => ({ files, bytes, capacityBytes: 50 * 1024 * 1024, capacityFiles: 500, usedPercent: Math.floor(Math.max(bytes / (50 * 1024 * 1024), files / 500) * 100) });

function detail(overrides: Partial<Detail> = {}): Detail {
  return {
    workspaceId: "ws_1", applicationId: "app_1", applicationName: "Comex", name: "Exportación Chile",
    description: "Exportar vino a Chile. ".repeat(20).trim(), pinned: false, pinnedAt: null, lastActivityAt: NOW - 60_000, createdAt: NOW - 86_400_000,
    instructions: { set: false, updatedAt: null }, context: usage(3, 2048), memory: { entries: 1, enabled: true }, scheduled: { tasks: 1 },
    recentSessions: [{ id: "ses_1", title: "Cotización flete", updatedAt: NOW - 120_000 }, { id: "ses_2", title: null, updatedAt: null }],
    recentSessionsComplete: true, writable: true, ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task_1", applicationId: "app_1", workspaceId: "ws_1", name: "Resumen diario", prompt: "Resume las novedades.",
    schedule: { kind: "daily", hour: 9, minute: 0 }, model: null, enabled: true, permissionMode: "manual",
    advanced: { catchUp: false, isolation: true }, nextRunAt: NOW + 3_600_000, lastRunAt: null, lastStatus: null, runs: 0, running: false,
    createdAt: NOW, updatedAt: NOW, ...overrides,
  };
}

type Calls = Record<string, unknown[][]>;
let calls: Calls;
let state: {
  detail: Detail;
  instructions: string;
  listings: Record<string, Listing>;
  memory: Memory;
  memoryConflicts: number;
  tasks: TaskList;
  uploadFails?: string;
};

const record = (name: string, ...args: unknown[]) => { (calls[name] ??= []).push(args); };

function fakeClient(): Client {
  return {
    baseUrl: "http://127.0.0.1:1",
    getProject: async () => state.detail,
    updateProject: async (workspaceId, patch) => { record("updateProject", workspaceId, patch); state.detail = { ...state.detail, ...patch }; return state.detail; },
    getProjectInstructions: async () => ({ text: state.instructions, updatedAt: null, maxChars: 8000 }),
    setProjectInstructions: async (workspaceId, text) => { record("setProjectInstructions", workspaceId, text); state.instructions = text; return { text, updatedAt: text ? NOW : null, maxChars: 8000 }; },
    listProjectContext: async (workspaceId, path = "") => { record("listProjectContext", workspaceId, path); const listing = state.listings[path]; if (!listing) throw new OpenworkServerError(404, "context_not_found", "gone"); return listing; },
    uploadProjectContextFile: async (workspaceId, file, options) => {
      record("uploadProjectContextFile", workspaceId, options);
      if (state.uploadFails === options.name) throw new OpenworkServerError(413, "context_capacity_bytes", "full");
      const entry = { kind: "file" as const, name: options.name, path: model.joinContextPath(options.folder ?? "", options.name), size: file.size, items: null, updatedAt: NOW };
      return { entry, usage: usage(4, 4096) };
    },
    createProjectContextFolder: async (workspaceId, path) => { record("createProjectContextFolder", workspaceId, path); return { entry: { kind: "folder", name: path.split("/").pop() ?? path, path, size: 0, items: 0, updatedAt: NOW }, usage: usage(3, 2048) }; },
    deleteProjectContextEntry: async (workspaceId, path) => { record("deleteProjectContextEntry", workspaceId, path); return { entry: null, usage: usage(2, 1024) }; },
    getProjectMemory: async () => { record("getProjectMemory"); return state.memory; },
    saveProjectMemoryNote: async (workspaceId, input) => {
      record("saveProjectMemoryNote", workspaceId, input);
      if (state.memoryConflicts > 0) {
        state.memoryConflicts -= 1;
        state.memory = { ...state.memory, revision: state.memory.revision + 1 };
        throw new OpenworkServerError(409, "memory_conflict", "changed");
      }
      if (input.expectedRevision !== state.memory.revision) throw new OpenworkServerError(409, "memory_conflict", "stale");
      const notes = input.id ? state.memory.notes.map(note => note.id === input.id ? { ...note, text: input.text } : note) : [...state.memory.notes, { id: NOTE_B, text: input.text, updatedAt: new Date(NOW).toISOString() }];
      state.memory = { ...state.memory, revision: state.memory.revision + 1, notes };
      return state.memory;
    },
    deleteProjectMemoryNote: async (workspaceId, noteId, revision) => { record("deleteProjectMemoryNote", workspaceId, noteId, revision); state.memory = { ...state.memory, revision: revision + 1, notes: state.memory.notes.filter(note => note.id !== noteId) }; return state.memory; },
    listProjectTasks: async () => state.tasks,
    createProjectTask: async (applicationId, workspaceId, input) => { record("createProjectTask", applicationId, workspaceId, input); return { task: { id: "task_new", name: input.name, prompt: input.prompt, schedule: input.schedule, enabled: true, nextRunAt: null } }; },
    updateProjectTask: async (applicationId, taskId, patch) => { record("updateProjectTask", applicationId, taskId, patch); return { task: { id: taskId, name: patch.name ?? "x", prompt: "p", schedule: { kind: "daily", hour: 9, minute: 0 }, enabled: patch.enabled ?? true, nextRunAt: null } }; },
    runSpecialistTaskNow: async (applicationId, taskId) => { record("runSpecialistTaskNow", applicationId, taskId); return { started: true, detail: null, tasks: [] }; },
    dryRunSpecialistTask: async (applicationId, taskId) => { record("dryRunSpecialistTask", applicationId, taskId); return { started: true, sessionId: "ses_dry", workspaceId: "ws_1", detail: null, note: null }; },
    deleteSpecialistTask: async (applicationId, taskId) => { record("deleteSpecialistTask", applicationId, taskId); return { deleted: taskId, tasks: [] }; },
    listEngineModels: async () => [{ providerID: "fault-lab", id: "fake-1", name: "Fault Lab" }],
  };
}

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement;
let queryClient: InstanceType<typeof QueryClient>;
let opened: [string, string][];

async function settle(rounds = 8) {
  for (let index = 0; index < rounds; index += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

async function render(composer: import("react").ReactNode = <div data-test-composer />) {
  await act(async () => {
    root?.render(<QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/projects/ws_1"]}>
        <ProjectPagePanel client={fakeClient()} workspaceId="ws_1" composer={composer} onOpenSession={(workspaceId, sessionId) => { opened.push([workspaceId, sessionId]); }} />
        <ConfirmDialogHost />
      </MemoryRouter>
    </QueryClientProvider>);
  });
  await settle();
}

function find(selector: string): HTMLElement {
  const element = document.body.querySelector(selector);
  if (!(element instanceof HTMLElement)) throw new Error(`missing ${selector}`);
  return element;
}
async function waitFor(selector: string) {
  for (let attempt = 0; attempt < 60 && !document.body.querySelector(selector); attempt += 1) await settle(1);
  return find(selector);
}
async function click(selector: string) {
  const element = await waitFor(selector);
  await act(async () => { element.click(); });
  await settle();
}
async function clickButton(label: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const element = [...document.body.querySelectorAll("button")].find(item => item.textContent?.trim() === label);
    if (element) { await act(async () => { element.click(); }); await settle(); return; }
    await settle(1);
  }
  throw new Error(`missing button ${label}`);
}
async function type(selector: string, value: string) {
  const element = await waitFor(selector);
  await act(async () => {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle(2);
}
const text = () => document.body.textContent ?? "";
/** Accept the in-app confirmation (`confirmDialog`). */
async function confirm() {
  await click("[data-slot='alert-dialog-action']");
}

beforeEach(() => {
  calls = {};
  opened = [];
  state = {
    detail: detail(),
    instructions: "",
    listings: {
      "": { path: "", agentPath: "proyecto/contexto", usage: usage(3, 2048), entries: [
        { kind: "folder", name: "Normas", path: "Normas", size: 1024, items: 2, updatedAt: NOW },
        { kind: "file", name: "tarifas.xlsx", path: "tarifas.xlsx", size: 1024, items: null, updatedAt: NOW - 60_000 },
      ] },
      Normas: { path: "Normas", agentPath: "proyecto/contexto", usage: usage(3, 2048), entries: [
        { kind: "file", name: "origen.pdf", path: "Normas/origen.pdf", size: 512, items: null, updatedAt: NOW },
        { kind: "file", name: "etiquetado.pdf", path: "Normas/etiquetado.pdf", size: 512, items: null, updatedAt: NOW },
      ] },
    },
    memory: { revision: 3, notes: [{ id: NOTE_A, text: "El cliente prefiere FOB.", updatedAt: new Date(NOW).toISOString() }], writable: true, maxNotes: 24, maxChars: 800 },
    memoryConflicts: 0,
    tasks: { applicationId: "app_1", tasks: [task()], capabilities: { dryRun: true, isolation: true }, limit: 20, writable: true },
  };
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  queryClient.clear();
  host.remove();
});

afterAll(async () => {
  if (ownsDom) await GlobalRegistrator.unregister();
});

// ---------------------------------------------------------------------------------------------
// Pure model

test("model: the page route, context paths and search", () => {
  expect(model.projectRouteWorkspaceId("/projects/ws_1")).toBe("ws_1");
  expect(model.projectRouteWorkspaceId("/projects/ws%201/")).toBe("ws 1");
  expect(model.projectRouteWorkspaceId("/projects")).toBe(null);
  expect(model.projectRouteWorkspaceId("/projects/a/b")).toBe(null);
  expect(model.projectRouteWorkspaceId(projectPageRoute("ws 1/x"))).toBe("ws 1/x");
  expect(model.contextBreadcrumb("")).toEqual([]);
  expect(model.contextBreadcrumb("a/b")).toEqual([{ name: "a", path: "a" }, { name: "b", path: "a/b" }]);
  const entries = state.listings[""]?.entries ?? [];
  expect(model.filterContextEntries(entries, "TARIF").map(entry => entry.name)).toEqual(["tarifas.xlsx"]);
  expect(model.filterContextEntries(entries, "  ").length).toBe(2);
  expect(model.filterContextEntries([{ kind: "file", name: "Árbol.pdf", path: "Árbol.pdf", size: 1, items: null, updatedAt: NOW }], "arbol").length).toBe(1);
  expect(model.contextFolderNameProblem("", entries)).toBe("projects_ui.page.context.folder_name_required");
  expect(model.contextFolderNameProblem(".oculta", entries)).toBe("projects_ui.page.context.folder_name_invalid");
  expect(model.contextFolderNameProblem("a/b", entries)).toBe("projects_ui.page.context.folder_name_invalid");
  expect(model.contextFolderNameProblem("normas", entries)).toBe("projects_ui.page.error.context_exists");
  expect(model.contextFolderNameProblem("Facturas", entries)).toBe(null);
  const upserted = model.upsertContextEntry(entries, { kind: "folder", name: "Anexos", path: "Anexos", size: 0, items: 0, updatedAt: NOW });
  expect(upserted.map(entry => entry.name)).toEqual(["Anexos", "Normas", "tarifas.xlsx"]);
});

test("model: every schedule kind builds the server's shape and always sends permissionMode", () => {
  const base = { ...model.emptyTaskForm(NOW), name: " Resumen diario ", prompt: " Resume " };
  expect(base.permissionMode).toBe("auto");
  const daily = model.buildTaskInput({ ...base, time: "08:30" }, { isolationAvailable: false, now: NOW });
  expect(daily).toEqual({ ok: true, input: { name: "Resumen diario", prompt: "Resume", schedule: { kind: "daily", hour: 8, minute: 30 }, model: null, permissionMode: "auto", advanced: { catchUp: false } } });
  const weekly = model.buildTaskInput({ ...base, frequency: "weekly", days: [5, 1, 1], permissionMode: "manual" }, { isolationAvailable: true, now: NOW });
  expect(weekly.ok && weekly.input.schedule).toEqual({ kind: "weekly", daysOfWeek: [1, 5], hour: 9, minute: 0 });
  expect(weekly.ok && weekly.input.permissionMode).toBe("manual");
  expect(weekly.ok && weekly.input.advanced).toEqual({ catchUp: false, isolation: true });
  const monthly = model.buildTaskInput({ ...base, frequency: "monthly", dayOfMonth: "31" }, { isolationAvailable: false, now: NOW });
  expect(monthly.ok && monthly.input.schedule).toEqual({ kind: "monthly", dayOfMonth: 31, hour: 9, minute: 0 });
  const interval = model.buildTaskInput({ ...base, frequency: "interval", everyMinutes: "45" }, { isolationAvailable: false, now: NOW });
  expect(interval.ok && interval.input.schedule).toEqual({ kind: "interval", everyMinutes: 45 });
  const once = model.buildTaskInput({ ...base, frequency: "once", date: "2099-01-02", time: "10:15" }, { isolationAvailable: false, now: NOW });
  expect(once.ok && once.input.schedule).toEqual({ kind: "once", at: new Date(2099, 0, 2, 10, 15).getTime() });
  const pinned = model.buildTaskInput({ ...base, model: model.modelKey({ providerID: "fault-lab", modelID: "fake-1" }) }, { isolationAvailable: false, now: NOW });
  expect(pinned.ok && pinned.input.model).toEqual({ providerID: "fault-lab", modelID: "fake-1" });
});

test("model: validation mirrors the server's task rules field by field", () => {
  const base = model.emptyTaskForm(NOW);
  const empty = model.buildTaskInput(base, { isolationAvailable: false, now: NOW });
  expect(empty).toEqual({ ok: false, errors: { name: "projects_ui.page.tasks.error_name_required", prompt: "projects_ui.page.tasks.error_prompt_required" } });
  const filled = { ...base, name: "x", prompt: "y" };
  expect(model.buildTaskInput({ ...filled, name: "n".repeat(121) }, { isolationAvailable: false }).ok).toBe(false);
  expect(model.buildTaskInput({ ...filled, frequency: "weekly", days: [] }, { isolationAvailable: false })).toEqual({ ok: false, errors: { days: "projects_ui.page.tasks.error_days" } });
  expect(model.buildTaskInput({ ...filled, frequency: "monthly", dayOfMonth: "32" }, { isolationAvailable: false })).toEqual({ ok: false, errors: { dayOfMonth: "projects_ui.page.tasks.error_day_of_month" } });
  expect(model.buildTaskInput({ ...filled, frequency: "interval", everyMinutes: "0" }, { isolationAvailable: false })).toEqual({ ok: false, errors: { everyMinutes: "projects_ui.page.tasks.error_every_minutes" } });
  expect(model.buildTaskInput({ ...filled, frequency: "interval", everyMinutes: "1.5" }, { isolationAvailable: false }).ok).toBe(false);
  expect(model.buildTaskInput({ ...filled, frequency: "interval", everyMinutes: "43201" }, { isolationAvailable: false }).ok).toBe(false);
  expect(model.buildTaskInput({ ...filled, time: "25:00" }, { isolationAvailable: false })).toEqual({ ok: false, errors: { time: "projects_ui.page.tasks.error_time" } });
  expect(model.buildTaskInput({ ...filled, frequency: "once", date: "2000-01-01" }, { isolationAvailable: false, now: NOW })).toEqual({ ok: false, errors: { date: "projects_ui.page.tasks.error_date_past" } });
  expect(model.buildTaskInput({ ...filled, frequency: "once", date: "" }, { isolationAvailable: false, now: NOW })).toEqual({ ok: false, errors: { date: "projects_ui.page.tasks.error_date" } });
});

test("model: an existing task fills the form back, and schedules read as words", () => {
  const form = model.taskFormFromTask(task({ schedule: { kind: "weekly", daysOfWeek: [1, 3], hour: 7, minute: 5 }, permissionMode: "manual", advanced: { catchUp: true, isolation: false }, model: { providerID: "p", modelID: "m" } }));
  expect(form).toMatchObject({ frequency: "weekly", days: [1, 3], time: "07:05", permissionMode: "manual", catchUp: true, isolation: false, model: model.modelKey({ providerID: "p", modelID: "m" }) });
  expect(model.describeSchedule({ kind: "daily", hour: 9, minute: 0 })).toBe(t("projects_ui.page.schedule.daily", { time: "09:00" }));
  expect(model.describeSchedule({ kind: "weekly", daysOfWeek: [3, 1], hour: 9, minute: 0 })).toBe(t("projects_ui.page.schedule.weekly", { days: `${model.weekdayLabel(1)}, ${model.weekdayLabel(3)}`, time: "09:00" }));
  expect(model.describeSchedule({ kind: "interval", everyMinutes: 30 })).toBe(t("projects_ui.page.schedule.every_minutes", { count: 30 }));
  expect(model.describeSchedule({ kind: "interval", everyMinutes: 120 })).toBe(t("projects_ui.page.schedule.every_hours", { count: 2 }));
  expect(model.describeSchedule({ kind: "monthly", dayOfMonth: 5, hour: 18, minute: 0 })).toBe(t("projects_ui.page.schedule.monthly", { day: 5, time: "18:00" }));
});

test("model: known error codes map to texts; a 401 says read only", () => {
  expect(model.projectErrorText(new OpenworkServerError(409, "memory_conflict", "x"))).toBe(t("projects_ui.page.error.memory_conflict"));
  expect(model.projectErrorText(new OpenworkServerError(401, "unauthorized", "x"))).toBe(t("projects_ui.page.error.read_only"));
  expect(model.projectErrorText(new Error("boom"), "projects_ui.page.load_failed")).toBe(t("projects_ui.page.load_failed"));
});

test("memory writes retry once with the new revision after a conflict", async () => {
  const revisions: number[] = [];
  let first = true;
  const current = { ...state.memory };
  const result = await withMemoryRevision(async () => ({ ...current, revision: 9 }), current, async revision => {
    revisions.push(revision);
    if (first) { first = false; throw new OpenworkServerError(409, "memory_conflict", "x"); }
    return { ...current, revision: revision + 1 };
  });
  expect(revisions).toEqual([3, 9]);
  expect(result.revision).toBe(10);
  await expect(withMemoryRevision(async () => current, current, async () => { throw new OpenworkServerError(422, "memory_secret", "x"); })).rejects.toThrow();
});

// ---------------------------------------------------------------------------------------------
// Page

test("page: title, folded description, composer, recents and the four rows", async () => {
  await render();
  expect(find("[data-project-title]").textContent).toBe("Exportación Chile");
  expect(find("[data-project-breadcrumb-list]").getAttribute("href")).toBe("/projects");
  expect(find("[data-project-description]").className).toContain("line-clamp-3");
  await click("[data-project-description-toggle]");
  expect(find("[data-project-description]").className).not.toContain("line-clamp-3");
  expect(find("[data-project-description-toggle]").textContent).toBe(t("projects_ui.page.show_less"));
  expect(text()).toContain(t("projects_ui.page.new_session_in", { name: "Exportación Chile" }));
  find("[data-test-composer]");
  expect([...document.body.querySelectorAll("[data-project-recent]")].map(row => row.getAttribute("data-project-recent"))).toEqual(["ses_1", "ses_2"]);
  expect(find("[data-project-recent='ses_2']").textContent).toContain(t("projects_ui.page.untitled_session"));
  await click("[data-project-recent='ses_1']");
  expect(opened).toEqual([["ws_1", "ses_1"]]);
  expect([...document.body.querySelectorAll("[data-project-row]")].map(row => row.getAttribute("data-project-row"))).toEqual(["instructions", "context", "memory", "scheduled"]);
  expect(find("[data-project-row-action='instructions']").textContent).toBe(t("projects_ui.page.add"));
  expect(find("[data-project-row='context'] [data-project-row-summary]").textContent).toBe(t("projects_ui.page.context.files", { count: 3 }));
  expect(find("[data-project-row-action='memory']").textContent).toBe(t("projects_ui.page.view"));
  expect(find("[data-project-row='scheduled'] [data-project-row-summary]").textContent).toBe(t("projects_ui.page.tasks.count", { count: 1 }));
  find("[data-project-private]");
  expect(document.body.querySelector("[data-project-read-only]")).toBe(null);
});

test("page: edits the description inline and refreshes the projects list", async () => {
  await render();
  const listKey = ["projects", "http://127.0.0.1:1"];
  queryClient.setQueryData(listKey, { projects: [], writable: true });
  await click("[data-project-description-edit]");
  await type("[data-project-description-input]", "Nueva descripción");
  await click("[data-project-description-save]");
  expect(calls.updateProject).toEqual([["ws_1", { description: "Nueva descripción" }]]);
  expect(find("[data-project-description]").textContent).toBe("Nueva descripción");
  expect(document.body.querySelector("[data-project-description-toggle]")).toBe(null);
  expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
});

test("page: recents that could not be read say so, never 'no sessions'", async () => {
  state.detail = detail({ recentSessions: [], recentSessionsComplete: false });
  await render();
  expect(find("[data-project-recents-incomplete]").textContent).toContain(t("projects_ui.page.recents_unavailable"));
  expect(document.body.querySelector("[data-project-recents-empty]")).toBe(null);
  state.detail = detail({ recentSessions: [], recentSessionsComplete: true });
  await clickButton(t("projects_ui.page.retry"));
  await waitFor("[data-project-recents-empty]");
  expect(document.body.querySelector("[data-project-recents-incomplete]")).toBe(null);
});

test("page: a missing project says so and links back to the list", async () => {
  const client = fakeClient();
  client.getProject = async () => { throw new OpenworkServerError(404, "project_not_found", "gone"); };
  await act(async () => {
    root?.render(<QueryClientProvider client={queryClient}><MemoryRouter><ProjectPagePanel client={client} workspaceId="ws_x" composer={null} onOpenSession={() => undefined} /></MemoryRouter></QueryClientProvider>);
  });
  await settle();
  expect(find("[data-project-error]").textContent).toContain(t("projects_ui.page.error.project_not_found"));
});

test("page: read only (web without pairing) offers no edits anywhere", async () => {
  state.detail = detail({ writable: false, instructions: { set: true, updatedAt: NOW } });
  state.instructions = "Responde en español.";
  state.memory = { ...state.memory, writable: false };
  state.tasks = { ...state.tasks, writable: false };
  await render(null);
  find("[data-project-read-only]");
  expect(text()).toContain(t("projects_ui.page.composer_unavailable"));
  expect(document.body.querySelector("[data-project-description-edit]")).toBe(null);
  expect(find("[data-project-row-action='instructions']").textContent).toBe(t("projects_ui.page.view"));
  await click("[data-project-row-action='instructions']");
  const field = await waitFor("[data-project-instructions-text]");
  expect(field.hasAttribute("readonly")).toBe(true);
  expect(document.body.querySelector("[data-project-instructions-save]")).toBe(null);
  await clickButton(t("projects_ui.page.close"));
  await click("[data-project-row-action='context']");
  await waitFor("[data-context-entry='tarifas.xlsx']");
  expect(document.body.querySelector("[data-context-add]")).toBe(null);
  expect(document.body.querySelector("[data-context-select]")).toBe(null);
});

// ---------------------------------------------------------------------------------------------
// Dialogs

test("instructions: saves the text, and an empty text removes them", async () => {
  await render();
  await click("[data-project-row-action='instructions']");
  await waitFor("[data-project-instructions-text]");
  expect(find("[data-project-instructions-count]").textContent).toBe(t("projects_ui.page.char_count", { count: "0", max: (8000).toLocaleString() }));
  await type("[data-project-instructions-text]", "Cita la fuente.");
  await click("[data-project-instructions-save]");
  expect(calls.setProjectInstructions).toEqual([["ws_1", "Cita la fuente."]]);
  expect(document.body.querySelector("[data-project-instructions-dialog]")).toBe(null);
  await click("[data-project-row-action='instructions']");
  await type("[data-project-instructions-text]", "   ");
  expect(text()).toContain(t("projects_ui.page.instructions.empty_removes"));
  await click("[data-project-instructions-save]");
  expect(calls.setProjectInstructions?.[1]).toEqual(["ws_1", ""]);
});

test("instructions: over 8,000 characters cannot be saved", async () => {
  await render();
  await click("[data-project-row-action='instructions']");
  await type("[data-project-instructions-text]", "x".repeat(8001));
  expect(find("[data-project-instructions-save]").hasAttribute("disabled")).toBe(true);
});

test("context: browses folders, searches, and shows the capacity bar", async () => {
  await render();
  await click("[data-project-row-action='context']");
  await waitFor("[data-context-entry='Normas']");
  expect(find("[data-context-capacity-label]").textContent).toBe(t("projects_ui.page.context.capacity", { count: 3, percent: 0 }));
  expect(find("[data-context-entry='Normas']").textContent).toContain(t("projects_ui.page.context.items", { count: 2 }));
  await type("[data-context-search]", "tarif");
  expect([...document.body.querySelectorAll("[data-context-entry]")].map(row => row.getAttribute("data-context-entry"))).toEqual(["tarifas.xlsx"]);
  await type("[data-context-search]", "");
  await click("[data-context-open='Normas']");
  await waitFor("[data-context-entry='Normas/origen.pdf']");
  expect(calls.listProjectContext?.map(args => args[1])).toEqual(["", "Normas"]);
  expect(find("[data-context-crumb='Normas']").getAttribute("aria-current")).toBe("page");
  await click("[data-context-crumb='']");
  await waitFor("[data-context-entry='tarifas.xlsx']");
});

test("context: uploads files with per-file results and asks before replacing", async () => {
  state.uploadFails = "grande.bin";
  await render();
  await click("[data-project-row-action='context']");
  await waitFor("[data-context-entry='tarifas.xlsx']");
  const input = find("[data-context-file-input]");
  const files = [new File(["abc"], "nuevo.txt"), new File(["x"], "grande.bin")];
  await act(async () => {
    Object.defineProperty(input, "files", { configurable: true, value: files });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle(12);
  expect(calls.uploadProjectContextFile?.map(args => args[1])).toEqual([{ name: "nuevo.txt", folder: "", replace: false }, { name: "grande.bin", folder: "", replace: false }]);
  expect([...document.body.querySelectorAll("[data-context-upload]")].map(row => row.getAttribute("data-context-upload"))).toEqual(["done", "error"]);
  expect(text()).toContain(t("projects_ui.page.error.context_capacity_bytes"));
  await waitFor("[data-context-entry='nuevo.txt']");
  expect(find("[data-context-capacity-label]").textContent).toBe(t("projects_ui.page.context.capacity", { count: 4, percent: 0 }));

  // Same name as a listed file: the person confirms the replacement.
  await act(async () => {
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["new"], "tarifas.xlsx")] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await confirm();
  await settle(6);
  expect(calls.uploadProjectContextFile?.[2]?.[1]).toEqual({ name: "tarifas.xlsx", folder: "", replace: true });
});

test("context: creates a folder and deletes selected entries after confirming", async () => {
  await render();
  await click("[data-project-row-action='context']");
  await waitFor("[data-context-entry='tarifas.xlsx']");
  await click("[data-context-new-folder]");
  await type("[data-context-folder-name]", "normas");
  await click("[data-context-folder-create]");
  expect(text()).toContain(t("projects_ui.page.error.context_exists"));
  await type("[data-context-folder-name]", "Anexos");
  await click("[data-context-folder-create]");
  expect(calls.createProjectContextFolder).toEqual([["ws_1", "Anexos"]]);
  await waitFor("[data-context-entry='Anexos']");

  await click("[data-context-select]");
  await click("[data-context-check='tarifas.xlsx']");
  await click("[data-context-check='Normas']");
  expect(find("[data-context-delete-selected]").textContent).toContain(t("projects_ui.page.context.delete_selected", { count: 2 }));
  await click("[data-context-delete-selected]");
  await confirm();
  await settle(6);
  expect(calls.deleteProjectContextEntry?.map(args => args[1]).sort()).toEqual(["Normas", "tarifas.xlsx"]);
  expect(document.body.querySelector("[data-context-entry='tarifas.xlsx']")).toBe(null);
  expect(find("[data-context-capacity-label]").textContent).toBe(t("projects_ui.page.context.capacity", { count: 2, percent: 0 }));
});

test("memory: edits a note and retries with the new revision after a conflict", async () => {
  state.memoryConflicts = 1;
  await render();
  await click("[data-project-row-action='memory']");
  await click(`[data-memory-edit='${NOTE_A}']`);
  await type("[data-memory-text]", "El cliente prefiere CIF.");
  await click("[data-memory-save]");
  expect(calls.saveProjectMemoryNote?.map(args => args[1])).toEqual([
    { expectedRevision: 3, text: "El cliente prefiere CIF.", id: NOTE_A },
    { expectedRevision: 4, text: "El cliente prefiere CIF.", id: NOTE_A },
  ]);
  expect(find(`[data-memory-note='${NOTE_A}']`).textContent).toContain("El cliente prefiere CIF.");
  await click("[data-memory-add]");
  await type("[data-memory-text]", "Usa Incoterms 2020.");
  await click("[data-memory-save]");
  await waitFor(`[data-memory-note='${NOTE_B}']`);
  await click(`[data-memory-delete='${NOTE_B}']`);
  await confirm();
  await settle(6);
  expect(calls.deleteProjectMemoryNote).toEqual([["ws_1", NOTE_B, 6]]);
});

test("memory: a full memory blocks adding, and a read-only one shows no actions", async () => {
  state.memory = { ...state.memory, maxNotes: 1 };
  await render();
  await click("[data-project-row-action='memory']");
  await waitFor("[data-memory-add]");
  expect(find("[data-memory-add]").hasAttribute("disabled")).toBe(true);
  expect(text()).toContain(t("projects_ui.page.memory.full", { max: 1 }));
});

test("memory: the row is off while project memory is disabled", async () => {
  state.detail = detail({ memory: { entries: 0, enabled: false } });
  await render();
  expect(find("[data-project-row-action='memory']").hasAttribute("disabled")).toBe(true);
  expect(find("[data-project-row='memory'] [data-project-row-summary]").textContent).toBe(t("projects_ui.page.memory.disabled"));
});

test("tasks: the new task form starts on Automático with its notice and always sends permissionMode", async () => {
  await render();
  await click("[data-project-row-action='scheduled']");
  await waitFor("[data-task-form]");
  expect(find("[data-task-name]").getAttribute("placeholder")).toBe(t("projects_ui.page.tasks.name_placeholder"));
  expect(find("[data-task-prompt]").getAttribute("placeholder")).toBe(t("projects_ui.page.tasks.prompt_placeholder"));
  expect(find("[data-task-mode-option='auto']").getAttribute("aria-pressed")).toBe("true");
  expect(find("[data-task-auto-notice]").textContent).toContain(t("projects_ui.page.tasks.auto_notice"));

  // Validation: empty fields answer at the field.
  await click("[data-task-submit]");
  expect([...document.body.querySelectorAll("[data-field-error]")].map(node => node.textContent)).toEqual([
    t("projects_ui.page.tasks.error_name_required"), t("projects_ui.page.tasks.error_prompt_required"),
  ]);
  expect(calls.createProjectTask).toBeUndefined();

  await type("[data-task-name]", "Resumen semanal");
  await type("[data-task-prompt]", "Resume lo nuevo.");
  await click("[data-task-frequency-option='weekly']");
  await click("[data-task-weekday='3']");
  await type("[data-task-time]", "07:45");
  await click("[data-task-mode-option='manual']");
  expect(document.body.querySelector("[data-task-auto-notice]")).toBe(null);
  await click("[data-task-mode-option='auto']");
  await click("[data-task-advanced]");
  await click("[data-task-catch-up]");
  find("[data-task-isolation]");
  expect(find("[data-task-form-dry-run]").hasAttribute("disabled")).toBe(true);
  await click("[data-task-submit]");
  const created = calls.createProjectTask?.[0];
  expect(created?.slice(0, 2)).toEqual(["app_1", "ws_1"]);
  const input = projectTaskInputSchema.parse(created?.[2]);
  expect(input).toEqual({
    name: "Resumen semanal", prompt: "Resume lo nuevo.", schedule: { kind: "weekly", daysOfWeek: [1, 3], hour: 7, minute: 45 },
    model: null, permissionMode: "auto", advanced: { catchUp: true, isolation: true },
  });
  // Back on the list with the dry run offered for the new task.
  find("[data-task-row='task_1']");
  await click("[data-tasks-notice-dry-run]");
  expect(calls.dryRunSpecialistTask).toEqual([["app_1", "task_new"]]);
  await click("[data-tasks-open-session]");
  expect(opened).toEqual([["ws_1", "ses_dry"]]);
});

test("tasks: list actions pause, run now, edit and delete with the existing methods", async () => {
  state.tasks = { ...state.tasks, capabilities: { dryRun: false, isolation: false } };
  await render();
  await click("[data-project-tasks-view]");
  await waitFor("[data-task-row='task_1']");
  expect(find("[data-task-mode]").textContent).toBe(t("projects_ui.page.tasks.mode_manual"));
  expect(find("[data-task-schedule]").textContent).toBe(model.describeSchedule({ kind: "daily", hour: 9, minute: 0 }));
  expect(document.body.querySelector("[data-task-dry-run]")).toBe(null);
  await click("[data-task-toggle='task_1']");
  expect(calls.updateProjectTask).toEqual([["app_1", "task_1", { enabled: false }]]);
  await click("[data-task-run='task_1']");
  expect(calls.runSpecialistTaskNow).toEqual([["app_1", "task_1"]]);
  await click("[data-task-edit='task_1']");
  await waitFor("[data-task-form]");
  expect(find("[data-task-mode-option='manual']").getAttribute("aria-pressed")).toBe("true");
  await click("[data-task-advanced]");
  expect(document.body.querySelector("[data-task-isolation]")).toBe(null);
  await type("[data-task-name]", "Resumen de la mañana");
  await click("[data-task-submit]");
  const patch = projectTaskInputSchema.partial().parse(calls.updateProjectTask?.[1]?.[2]);
  expect(patch).toMatchObject({ name: "Resumen de la mañana", permissionMode: "manual", advanced: { catchUp: false } });
  await click("[data-task-delete='task_1']");
  await confirm();
  await settle(6);
  expect(calls.deleteSpecialistTask).toEqual([["app_1", "task_1"]]);
});

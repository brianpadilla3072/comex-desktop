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

const { currentLocale, setLocale } = await import("../src/i18n");
const { OpenworkServerError } = await import("../src/app/lib/openwork-server");
const model = await import("../src/react-app/domains/projects/projects-list-model");
const { ProjectsPanel } = await import("../src/react-app/domains/projects/projects-list-page");
const { PinnedProjectsGroup, sidebarDestinationOrder } = await import("../src/react-app/domains/projects/projects-sidebar");
const { SidebarProvider } = await import("../src/components/ui/sidebar");
const { CompactSidebarNav } = await import("../src/react-app/domains/session/sidebar/compact-sidebar-nav");
type ProjectSummary = import("../src/app/lib/projects").ProjectSummary;
type ProjectList = import("../src/app/lib/projects").ProjectList;
type Client = import("../src/react-app/domains/projects/use-projects-list").ProjectsListClient;
type SidebarDestinationId = import("../src/react-app/domains/projects/projects-sidebar").SidebarDestinationId;
type NewProjectTarget = import("../src/react-app/domains/projects/projects-list-page").NewProjectTarget;

const NOW = new Date(2026, 10, 20, 12, 0, 0).getTime();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function project(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    workspaceId: "ws_a", applicationId: "app_1", applicationName: "Comercio Exterior", name: "Alfa", description: "",
    pinned: false, pinnedAt: null, lastActivityAt: NOW - HOUR, createdAt: NOW - 10 * DAY, ...overrides,
  };
}

const exportacion = project({ workspaceId: "ws_exp", name: "Exportación de café", description: "Cotización FOB", lastActivityAt: NOW - 18 * HOUR, createdAt: NOW - 2 * DAY });
const aduana = project({ workspaceId: "ws_adu", name: "Aduana", applicationName: "Logística", applicationId: "app_2", lastActivityAt: new Date(2026, 8, 17, 9).getTime(), createdAt: NOW - 90 * DAY });
const zeta = project({ workspaceId: "ws_zeta", name: "Zeta", pinned: true, pinnedAt: NOW - DAY, lastActivityAt: NOW - 40 * DAY, createdAt: NOW - DAY });
const beta = project({ workspaceId: "ws_beta", name: "Beta", lastActivityAt: NOW - 5 * 60_000, createdAt: NOW - 30 * DAY });

let previousLocale: ReturnType<typeof currentLocale>;
let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement;
let queryClient: InstanceType<typeof QueryClient>;
let listAnswer: () => Promise<ProjectList>;
let updateAnswer: (workspaceId: string, pinned: boolean) => Promise<ProjectSummary>;
let updates: [string, boolean | undefined][];
let opened: string[];
let created: (string | null)[];

function fakeClient(): Client {
  return {
    baseUrl: "http://127.0.0.1:1",
    listProjects: () => listAnswer(),
    updateProject: async (workspaceId, patch) => { updates.push([workspaceId, patch.pinned]); return updateAnswer(workspaceId, patch.pinned === true); },
  };
}

async function settle() {
  for (let index = 0; index < 8; index += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

const target = (applications: NewProjectTarget["applications"]): NewProjectTarget => ({ applications, onCreate: id => { created.push(id); } });

async function render(newProject: NewProjectTarget | null = target([{ id: "app_1", name: "Comercio Exterior" }])) {
  await act(async () => {
    root?.render(<MemoryRouter><QueryClientProvider client={queryClient}>
      <ProjectsPanel client={fakeClient()} newProject={newProject} now={NOW} onOpenProject={id => { opened.push(id); }} />
    </QueryClientProvider></MemoryRouter>);
  });
  await settle();
}

const cards = () => [...host.querySelectorAll("[data-project-card]")].map(card => card.getAttribute("data-project-card"));

async function click(selector: string) {
  const element = host.querySelector(selector);
  if (!(element instanceof HTMLElement)) throw new Error(`missing ${selector}`);
  await act(async () => { element.click(); });
  await settle();
}

async function type(selector: string, value: string) {
  const input = host.querySelector(selector);
  if (!(input instanceof HTMLInputElement)) throw new Error(`missing ${selector}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => { setter?.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await settle();
}

beforeEach(() => {
  previousLocale = currentLocale();
  setLocale("es");
  updates = []; opened = []; created = [];
  listAnswer = async () => ({ projects: [zeta, beta, exportacion, aduana], writable: true });
  updateAnswer = async (workspaceId, pinned) => ({ ...project({ workspaceId }), pinned, pinnedAt: pinned ? NOW : null });
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
  setLocale(previousLocale);
});

afterAll(async () => {
  if (ownsDom) await GlobalRegistrator.unregister();
});

test("model: accent-insensitive search over name, description and application", () => {
  const all = [zeta, beta, exportacion, aduana];
  expect(model.filterProjects(all, "exportacion").map(p => p.workspaceId)).toEqual(["ws_exp"]);
  expect(model.filterProjects(all, "COTIZACIÓN").map(p => p.workspaceId)).toEqual(["ws_exp"]);
  expect(model.filterProjects(all, "logistica").map(p => p.workspaceId)).toEqual(["ws_adu"]);
  expect(model.filterProjects(all, "  ").length).toBe(4);
  expect(model.filterProjects(all, "cafe fob").map(p => p.workspaceId)).toEqual(["ws_exp"]);
});

test("model: pinned first, then the chosen order", () => {
  const all = [aduana, exportacion, beta, zeta];
  expect(model.sortProjects(all, "activity").map(p => p.name)).toEqual(["Zeta", "Beta", "Exportación de café", "Aduana"]);
  expect(model.sortProjects(all, "name").map(p => p.name)).toEqual(["Zeta", "Aduana", "Beta", "Exportación de café"]);
  expect(model.sortProjects(all, "created").map(p => p.name)).toEqual(["Zeta", "Exportación de café", "Beta", "Aduana"]);
  const older = project({ workspaceId: "ws_old_pin", name: "Antiguo", pinned: true, pinnedAt: NOW - 5 * DAY });
  expect(model.sortProjects([older, ...all], "name").map(p => p.name).slice(0, 2)).toEqual(["Zeta", "Antiguo"]);
  expect(model.pinnedProjects([older, ...all]).map(p => p.workspaceId)).toEqual(["ws_zeta", "ws_old_pin"]);
});

test("model: relative dates in Spanish and project routes", () => {
  expect(model.formatProjectTime(NOW - 10_000, NOW, "es")).toBe("Ahora");
  expect(model.formatProjectTime(NOW - 60_000, NOW, "es")).toBe("hace 1 minuto");
  expect(model.formatProjectTime(NOW - 5 * 60_000, NOW, "es")).toBe("hace 5 minutos");
  expect(model.formatProjectTime(NOW - 18 * HOUR, NOW, "es")).toBe("hace 18 horas");
  expect(model.formatProjectTime(new Date(2026, 8, 17, 9).getTime(), NOW, "es")).toBe("17 sept");
  expect(model.formatProjectTime(new Date(2025, 8, 17, 9).getTime(), NOW, "es")).toBe("17 sept 2025");
  expect(model.projectPageRoute("ws a/b")).toBe("/projects/ws%20a%2Fb");
  expect(model.projectIdFromPath("/projects/ws%20a%2Fb")).toBe("ws a/b");
  expect(model.projectIdFromPath("/projects")).toBeNull();
  expect(model.isProjectsPath("/projects")).toBe(true);
  expect(model.isProjectsPath("/projects/ws_a")).toBe(true);
  expect(model.isProjectsPath("/projectsx")).toBe(false);
});

test("page: cards with pins first, relative dates, application names; a card opens its project page", async () => {
  await render();
  expect(host.querySelector("h1")?.textContent).toBe("Proyectos");
  expect(cards()).toEqual(["ws_zeta", "ws_beta", "ws_exp", "ws_adu"]);
  const times = [...host.querySelectorAll("[data-project-time]")].map(node => node.textContent);
  expect(times).toEqual(["11 oct", "hace 5 minutos", "hace 18 horas", "17 sept"]);
  expect(host.querySelector('[data-project-card="ws_adu"]')?.textContent).toContain("Logística");
  expect(host.querySelector('[data-project-card="ws_zeta"]')?.getAttribute("data-pinned")).toBe("true");
  await click('[data-project-card="ws_exp"] [data-project-open]');
  expect(opened).toEqual(["ws_exp"]);
});

test("page: search filters without accents and says when nothing matches", async () => {
  await render();
  await type("[data-projects-search]", "exportacion");
  expect(cards()).toEqual(["ws_exp"]);
  await type("[data-projects-search]", "inexistente");
  expect(cards()).toEqual([]);
  expect(host.querySelector("[data-projects-no-match]")?.textContent).toContain("«inexistente»");
  await click("[data-projects-no-match] button");
  expect(cards().length).toBe(4);
});

test("page: pinning moves the card at once and goes back when the server refuses", async () => {
  let release: (value: ProjectSummary) => void = () => undefined;
  updateAnswer = (workspaceId, pinned) => new Promise(resolve => { release = resolve; void workspaceId; void pinned; });
  await render();
  await click('[data-project-card="ws_adu"] [data-project-pin]');
  expect(updates).toEqual([["ws_adu", true]]);
  expect(cards()[0]).toBe("ws_adu");
  expect(host.querySelector('[data-project-card="ws_adu"] [data-project-pin]')?.getAttribute("aria-pressed")).toBe("true");
  listAnswer = async () => ({ projects: [{ ...aduana, pinned: true, pinnedAt: NOW }, zeta, beta, exportacion], writable: true });
  await act(async () => { release({ ...aduana, pinned: true, pinnedAt: NOW }); });
  await settle();
  expect(cards()[0]).toBe("ws_adu");

  listAnswer = async () => ({ projects: [{ ...aduana, pinned: true, pinnedAt: NOW }, zeta, beta, exportacion], writable: true });
  updateAnswer = async () => { throw new OpenworkServerError(500, "internal", "Disco lleno"); };
  await click('[data-project-card="ws_beta"] [data-project-pin]');
  expect(updates.at(-1)).toEqual(["ws_beta", true]);
  expect(cards()).toEqual(["ws_adu", "ws_zeta", "ws_beta", "ws_exp"]);
  expect(host.querySelector("[data-projects-pin-error]")?.textContent).toContain("Disco lleno");
});

test("page: a failed read is an error with retry, never the empty state", async () => {
  listAnswer = async () => { throw new OpenworkServerError(502, "bad_gateway", "Sin respuesta"); };
  await render();
  expect(host.querySelector("[data-projects-error]")?.textContent).toContain("Sin respuesta");
  expect(host.querySelector("[data-projects-empty]")).toBeNull();
  listAnswer = async () => ({ projects: [beta], writable: true });
  await click("[data-projects-error] button");
  expect(cards()).toEqual(["ws_beta"]);
  expect(host.querySelector("[data-projects-error]")).toBeNull();
});

test("page: loading shows a skeleton", async () => {
  listAnswer = () => new Promise(() => undefined);
  await render();
  expect(host.querySelector("[data-projects-loading]")).not.toBeNull();
  expect(host.querySelector("[data-projects-empty]")).toBeNull();
});

test("page: the true empty state invites to create the first project", async () => {
  listAnswer = async () => ({ projects: [], writable: true });
  await render();
  const empty = host.querySelector("[data-projects-empty]");
  expect(empty?.textContent).toContain("Todavía no hay proyectos");
  await click("[data-projects-empty] [data-projects-new]");
  expect(created).toEqual(["app_1"]);
});

test("page: with several applications, Nuevo proyecto asks which one", async () => {
  await render(target([{ id: "app_1", name: "Comercio Exterior" }, { id: "app_2", name: "Logística" }]));
  const trigger = host.querySelector("header [data-projects-new]");
  expect(trigger?.getAttribute("aria-haspopup")).toBe("menu");
  expect(created).toEqual([]);
});

test("page: read-only connections see projects without pin or create, with the pairing hint", async () => {
  listAnswer = async () => ({ projects: [zeta, beta], writable: false });
  await render();
  expect(cards()).toEqual(["ws_zeta", "ws_beta"]);
  expect(host.querySelector("[data-project-pin]")).toBeNull();
  expect(host.querySelector("[data-project-pinned-mark]")).not.toBeNull();
  expect(host.querySelector("[data-projects-read-only]")?.textContent).toContain("dispositivo vinculado");
  expect(host.querySelector("[data-pair-device-hint]")).not.toBeNull();
  const create = host.querySelector("header [data-projects-new]");
  expect(create instanceof HTMLButtonElement && create.disabled).toBe(true);
});

test("sidebar: destination order with the flag on and off", () => {
  const all = new Set<SidebarDestinationId>(["search", "projects", "artifacts", "scheduled", "extensions", "command-center", "inbox"]);
  expect(sidebarDestinationOrder(true, all)).toEqual(["search", "projects", "artifacts", "scheduled", "extensions", "command-center", "inbox"]);
  expect(sidebarDestinationOrder(false, all)).toEqual(["artifacts", "scheduled", "command-center", "inbox", "extensions"]);
  expect(sidebarDestinationOrder(true, new Set<SidebarDestinationId>(["projects", "extensions"]))).toEqual(["projects", "extensions"]);
});

test("sidebar: Fijados lists pinned projects and opens their page", async () => {
  const calls: string[] = [];
  await act(async () => root?.render(<SidebarProvider><PinnedProjectsGroup projects={[zeta, { ...beta, pinned: true, pinnedAt: NOW - 2 * DAY }]} activeProjectId="ws_beta" onOpenProject={id => calls.push(id)} /></SidebarProvider>));
  expect(host.querySelector("[data-pinned-projects]")?.textContent).toContain("Fijados");
  expect([...host.querySelectorAll("[data-pinned-project]")].map(node => node.textContent)).toEqual(["Zeta", "Beta"]);
  expect(host.querySelector('[data-pinned-project="ws_beta"]')?.getAttribute("aria-current")).toBe("page");
  await click('[data-pinned-project="ws_zeta"]');
  expect(calls).toEqual(["ws_zeta"]);
  await act(async () => root?.render(<SidebarProvider><PinnedProjectsGroup projects={[]} activeProjectId={null} onOpenProject={() => undefined} /></SidebarProvider>));
  expect(host.querySelector("[data-pinned-projects]")).toBeNull();
});

test("compact rail: Crear, Buscar, Proyectos, Artefactos, Programadas, Complementos with the flag on; today's rail with it off", async () => {
  const calls: string[] = [];
  const common = {
    onNewTask: () => calls.push("new"), onSearch: () => calls.push("search"), onDashboard: () => calls.push("artifacts"),
    onAutomations: () => calls.push("scheduled"), onExtensions: () => calls.push("extensions"), onCommandCenter: () => calls.push("command-center"),
    referenceLabels: true,
  };
  const labels = () => [...host.querySelectorAll("[data-compact-sidebar] button[aria-label]")].map(node => node.getAttribute("aria-label"));
  await act(async () => root?.render(<SidebarProvider defaultOpen={false}><CompactSidebarNav {...common} onProjectsPage={() => calls.push("projects")} projectsPageActive /></SidebarProvider>));
  expect(labels()).toEqual(["Inicio", "Buscar", "Proyectos", "Artefactos", "Programadas", "Complementos", "Centro de control", "Conversaciones"]);
  expect(host.querySelector('[aria-label="Proyectos"]')?.getAttribute("data-active")).not.toBeNull();
  expect(host.querySelector('[aria-label="Inicio"]')?.getAttribute("data-active")).toBeNull();
  await click('[aria-label="Proyectos"]');
  expect(calls).toEqual(["projects"]);
  await act(async () => root?.render(<SidebarProvider defaultOpen={false}><CompactSidebarNav {...common} /></SidebarProvider>));
  expect(labels()).toEqual(["Inicio", "Buscar conversaciones", "Resultados", "Tareas programadas", "Centro de control", "Proyectos y conversaciones", "Complementos"]);
});

/** @jsxImportSource react */
// Test de usuario de la UI nueva: "Propuestas pendientes" + "Tareas programadas" en el diálogo
// "Contexto, agentes y skills", abierto desde el menú de aplicaciones especialista.
// Los mocks de fetch emulan las respuestas reales de apps/server/src/specialists/routes.ts
// (formas JSON: { tasks }, { task, tasks }, { started, detail, tasks }, { runs }, { proposals },
// { accepted, counts, sync, catalog }, y los 404 de flags: specialist_library_disabled /
// scheduled_tasks_disabled).
import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://localhost/" });
mock.module("../src/react-app/shell/openwork-connection", () => ({ resolveOpenworkConnection: async () => ({ normalizedBaseUrl: "http://localhost:8787", resolvedToken: "fixture-owner", resolvedHostToken: "fixture-host" }) }));
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { MemoryRouter } = await import("react-router");
const { z } = await import("zod");
const { SpecialistApplicationsProvider, SpecialistApplicationSwitcher } = await import("../src/react-app/domains/specialists/provider");

// Replica exacta de taskInputSchema de apps/server/src/specialists/tasks.ts (líneas 15-22 y 65-69).
// Se replica porque importar el módulo del server arrastra bun:database y el config store; la
// regla que se verifica es la misma, copiada literal del contrato del server.
const uniqueDays = z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(days => new Set(days).size === days.length, "días repetidos");
const scheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("interval"), everyMinutes: z.number().int().min(1).max(43_200) }),
  z.object({ kind: z.literal("daily"), hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59) }),
  z.object({ kind: z.literal("weekly"), daysOfWeek: uniqueDays, hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59) }),
  z.object({ kind: z.literal("monthly"), dayOfMonth: z.number().int().min(1).max(31), hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59) }),
  z.object({ kind: z.literal("once"), at: z.number().int() }),
]);
const taskInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(8000),
  schedule: scheduleSchema,
  catchUp: z.boolean().optional(),
});

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let cache: InstanceType<typeof QueryClient>;
let restoreFetch: () => void;

// Estado del server emulado, mutable por prueba.
type FakeTask = {
  id: string; name: string; prompt: string; schedule: Record<string, unknown>; enabled: boolean;
  createdAt: number; updatedAt: number; nextRunAt: number | null; lastRunAt: number | null;
  lastStatus: "ok" | "failed" | "blocked" | "running" | null; runs: number; running: null;
};
let flags: { libraryEnabled: boolean; scheduledTasksEnabled: boolean; datasetsEnabled?: boolean };
let proposals: Array<{ id: string; kind: "skill" | "agent" | "context"; name: string; description: string; content: string; reason: string; createdAt: number }>;
let tasks: FakeTask[];
let taskRequests: Array<{ method: string; path: string; body: unknown }> = [];
let allRequests: Array<{ method: string; path: string; body: unknown }> = [];

const APP = { id: "app_test", name: "Taller", specialty: "Prueba", personality: "Clara", template: "custom" as const, agentCount: 1, skillCount: 1, createdAt: 1, workspaceIds: ["ws_test"] };
const catalog = () => ({
  enabled: true,
  libraryEnabled: flags.libraryEnabled,
  scheduledTasksEnabled: flags.scheduledTasksEnabled,
  integrationsEnabled: false,
  user: { id: "local", displayName: "Usuario de prueba" },
  activeApplicationId: APP.id,
  applications: [APP],
});
const libraryPayload = () => ({
  application: { id: APP.id, name: APP.name },
  agents: [{ path: "agents/revisor.md", name: "revisor", bytes: 120, updatedAt: 1, origin: "official", description: "Revisa los textos antes de publicar." }],
  skills: [{ path: "skills/informe/SKILL.md", name: "informe", bytes: 200, updatedAt: 1, origin: "custom", description: "Arma el informe mensual.", resources: 0 }],
  files: [],
  context: { exists: false, bytes: 0 },
  counts: { agents: 1, skills: 1 },
});
const RUNS = [
  { at: 1_700_000_100_000, mode: "manual", missed: 0, workspaceId: "ws_test", sessionId: "ses_1", status: "failed", detail: "No se pudo confirmar el envío al motor." },
  { at: 1_700_000_000_000, mode: "scheduled", missed: 2, workspaceId: "ws_test", sessionId: "ses_0", status: "ok", detail: null },
];

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  if (!("ResizeObserver" in globalThis)) Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  if (!("IntersectionObserver" in globalThis)) Reflect.set(globalThis, "IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
  flags = { libraryEnabled: true, scheduledTasksEnabled: true };
  proposals = [{ id: "prop_1", kind: "skill", name: "chequeo-de-flete", description: "Cotiza fletes y arma la tabla.", content: "---\nname: chequeo-de-flete\ndescription: Cotiza fletes.\n---\nCuerpo", reason: "Lo repetiste dos veces.", createdAt: 1_700_000_000_000 }];
  tasks = [];
  taskRequests = [];
  allRequests = [];
  const spy = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const path = new URL(request.url).pathname;
    const method = request.method;
    const body = ["POST", "PUT", "PATCH"].includes(method) && request.headers.get("content-type")?.includes("json") ? await request.json().catch(() => null) : null;
    allRequests.push({ method, path, body });
    if (path !== "/specialist-applications" && path.includes("/tasks")) taskRequests.push({ method, path, body });

    if (path === "/specialist-applications" && method === "GET") return Response.json(catalog());

    // Biblioteca: 404 con la flag apagada, igual que requireLibrary() en routes.ts.
    if (/^\/specialist-applications\/app_test\/library$/.test(path)) {
      if (!flags.libraryEnabled) return Response.json({ code: "specialist_library_disabled", message: "La biblioteca de la aplicación está desactivada." }, { status: 404 });
      return Response.json(libraryPayload());
    }
    if (/^\/specialist-applications\/app_test\/library\/proposals$/.test(path) && method === "GET") {
      // Server (requireCapture): el inbox vive mientras alguna familia esté encendida.
      if (!flags.libraryEnabled && !flags.scheduledTasksEnabled && !flags.datasetsEnabled) return Response.json({ code: "specialist_library_disabled", message: "La biblioteca de la aplicación está desactivada." }, { status: 404 });
      return Response.json({ proposals });
    }
    const accept = path.match(/^\/specialist-applications\/app_test\/library\/proposals\/([^/]+)\/accept$/);
    if (accept && method === "POST") {
      if (!flags.libraryEnabled) return Response.json({ code: "specialist_library_disabled", message: "La biblioteca de la aplicación está desactivada." }, { status: 404 });
      const removed = proposals.find(entry => entry.id === accept[1]);
      proposals = proposals.filter(entry => entry.id !== accept[1]);
      return Response.json({ accepted: removed?.id ?? accept[1], counts: { agents: 1, skills: 2 }, sync: [], catalog: catalog() });
    }

    // Tareas: 404 con la flag apagada, igual que requireTasks() en routes.ts.
    const disabled = Response.json({ code: "scheduled_tasks_disabled", message: "Las tareas programadas están desactivadas." }, { status: 404 });
    if (/^\/specialist-applications\/app_test\/tasks$/.test(path) && method === "GET") return flags.scheduledTasksEnabled ? Response.json({ tasks }) : disabled;
    if (/^\/specialist-applications\/app_test\/tasks$/.test(path) && method === "POST") {
      if (!flags.scheduledTasksEnabled) return disabled;
      const parsed = taskInputSchema.safeParse(body);
      if (!parsed.success) return Response.json({ code: "invalid_task", message: "Revisá el nombre, el prompt y el horario de la tarea." }, { status: 422 });
      const now = 1_700_000_000_000;
      const everyMinutes = parsed.data.schedule.kind === "interval" ? parsed.data.schedule.everyMinutes : 20;
      const task: FakeTask = {
        id: `task_${tasks.length + 1}`, name: parsed.data.name, prompt: parsed.data.prompt, schedule: parsed.data.schedule,
        enabled: true, createdAt: now, updatedAt: now, nextRunAt: now + everyMinutes * 60_000, lastRunAt: null, lastStatus: null, runs: 0, running: null,
      };
      tasks = [task, ...tasks];
      return Response.json({ task, tasks });
    }
    const runNow = path.match(/^\/specialist-applications\/app_test\/tasks\/([^/]+)\/run-now$/);
    if (runNow && method === "POST") {
      if (!flags.scheduledTasksEnabled) return disabled;
      // Igual que scheduler.dispatch sin proyecto atado: HTTP 200 con started:false y un detalle.
      const detail = "La aplicación no tiene ningún proyecto disponible.";
      tasks = tasks.map(task => task.id === runNow[1] ? { ...task, lastStatus: "blocked", updatedAt: task.updatedAt + 1 } : task);
      return Response.json({ started: false, detail, tasks });
    }
    const runs = path.match(/^\/specialist-applications\/app_test\/tasks\/([^/]+)\/runs$/);
    if (runs && method === "GET") return flags.scheduledTasksEnabled ? Response.json({ runs: RUNS }) : disabled;
    const taskById = path.match(/^\/specialist-applications\/app_test\/tasks\/([^/]+)$/);
    if (taskById && method === "PUT") {
      if (!flags.scheduledTasksEnabled) return disabled;
      const parsed = taskInputSchema.partial().extend({ enabled: z.boolean().optional() }).safeParse(body);
      if (!parsed.success) return Response.json({ code: "invalid_task", message: "Revisá los campos de la tarea." }, { status: 422 });
      const now = 1_700_000_000_000;
      tasks = tasks.map(task => task.id === taskById[1] ? {
        ...task, ...parsed.data, updatedAt: now + 1,
        nextRunAt: parsed.data.enabled === true ? now + 20 * 60_000 : (parsed.data.enabled === false ? task.nextRunAt : now + 20 * 60_000),
      } : task);
      const task = tasks.find(entry => entry.id === taskById[1]);
      return Response.json({ task, tasks });
    }
    if (taskById && method === "DELETE") {
      if (!flags.scheduledTasksEnabled) return disabled;
      tasks = tasks.filter(task => task.id !== taskById[1]);
      return Response.json({ deleted: taskById[1], tasks });
    }
    return Response.json({ code: "not_found", message: `Ruta no emulada: ${method} ${path}` }, { status: 404 });
  });
  restoreFetch = () => spy.mockRestore();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(async () => { await act(async () => root.unmount()); cache.clear(); host.remove(); restoreFetch(); });
afterAll(async () => { await GlobalRegistrator.unregister(); });

async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); }); }
async function renderAt(path = "/workspace/ws_test/session") {
  await act(async () => root.render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={[path]}>
        <SpecialistApplicationsProvider>
          <SpecialistApplicationSwitcher fallbackName="OpenWork" />
        </SpecialistApplicationsProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  ));
  await flush();
}
function byText(text: string, tag = "button"): HTMLElement {
  const selector = tag === "button" ? 'button, [role="menuitem"]' : tag;
  const value = [...document.querySelectorAll(selector)].find(element => (element.textContent ?? "").includes(text));
  if (!value) throw new Error(`Missing ${selector} with text "${text}". Document: ${document.body.textContent?.slice(0, 600)}`);
  return value as HTMLElement;
}
async function clickText(text: string, tag = "button") {
  await act(async () => { byText(text, tag).click(); });
  await flush();
}
function hasText(text: string): boolean { return (document.body.textContent ?? "").includes(text); }
async function edit(id: string, value: string) {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) throw new Error(`Missing field ${id}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
/** Usuario: abre el menú de la aplicación y entra al diálogo "Contexto, agentes y skills". */
async function openMenu() {
  const trigger = document.querySelector('[aria-label="Cambiar aplicación especialista"]');
  if (!trigger) throw new Error("Missing application switcher trigger");
  await act(async () => { trigger.click(); });
  await flush();
}
async function openLibraryDialog(label = "Contexto, agentes y skills") {
  await openMenu();
  await clickText(label);
}

test("el usuario guarda una propuesta y administra una tarea desde el menú de la aplicación", async () => {
  await renderAt();
  await openLibraryDialog();

  // --- Propuestas pendientes: aparece la propuesta y "Guardar" la acepta y refesca la biblioteca.
  expect(hasText("Propuestas pendientes (1)")).toBe(true);
  expect(hasText("chequeo-de-flete")).toBe(true);
  await clickText("Guardar");
  expect(allRequests.filter(entry => entry.method === "POST" && entry.path.endsWith("/library/proposals/prop_1/accept")).length).toBe(1);
  await flush();
  expect(hasText("Propuestas pendientes")).toBe(false); // refetch: ya no hay propuestas

  // --- Tareas programadas: "Gestionar" abre la vista de tareas.
  expect(hasText("Tareas programadas")).toBe(true);
  expect(hasText("Sin tareas programadas")).toBe(true); // resumen en la home
  await clickText("Gestionar");
  expect(hasText("Todavía no hay tareas.")).toBe(true);
  await clickText("Nueva tarea");
  await edit("task-name", "actualizar precios");
  await edit("task-prompt", "Consultá las fuentes de costo de flete y actualizá la planilla del proyecto.");
  // Intervalo por defecto: "Cada cuántos minutos" ya trae 20.
  const every = document.getElementById("task-every") as HTMLInputElement | null;
  expect(every?.value).toBe("20");
  await clickText("Crear tarea");

  // El cuerpo del POST coincide con taskInputSchema del server.
  const create = taskRequests.find(entry => entry.method === "POST" && entry.path === "/specialist-applications/app_test/tasks");
  expect(create).toBeDefined();
  const parsed = taskInputSchema.safeParse(create?.body);
  expect(parsed.success).toBe(true);
  expect(create?.body).toEqual({ catchUp: false, name: "actualizar precios", prompt: "Consultá las fuentes de costo de flete y actualizá la planilla del proyecto.", schedule: { kind: "interval", everyMinutes: 20 } });

  // Confirmación visible y la tarea aparece en la lista con su horario.
  expect(hasText("Tarea creada y activada.")).toBe(true);
  expect(hasText("Cada 20 min")).toBe(true);
  expect(hasText("actualizar precios")).toBe(true);

  // --- "Correr ahora": sin proyecto atado el server responde started:false con detalle; la UI
  // tiene que mostrar ese motivo, no un error genérico.
  await clickText("Correr ahora");
  const alert = document.querySelector('[role="alert"]')?.textContent ?? "";
  expect(alert).toContain("La aplicación no tiene ningún proyecto disponible.");
  expect(hasText("Corrida iniciada")).toBe(false);

  // --- "Pausar": PUT { enabled: false } y badge "Pausada".
  await clickText("Pausar");
  const pause = taskRequests.find(entry => entry.method === "PUT");
  expect(pause?.body).toEqual({ enabled: false });
  expect(hasText("Pausada")).toBe(true);
  expect(hasText("Reanudar")).toBe(true);

  // --- "Corridas": historial con estados legibles.
  await clickText("Corridas");
  expect(hasText("falló")).toBe(true);
  expect(hasText("a pedido")).toBe(true);
  expect(hasText("ok")).toBe(true);
  expect(hasText("programada")).toBe(true);
});

test("scheduledTasks=false: el menú sigue abierto la biblioteca pero sin la sección de tareas", async () => {
  flags = { libraryEnabled: true, scheduledTasksEnabled: false };
  await renderAt();
  await openLibraryDialog();
  expect(document.querySelector('[data-slot="dialog-title"]')?.textContent).toBe("Taller");
  expect(hasText("Contexto, agentes y skills")).toBe(true);
  expect(hasText("Tareas programadas")).toBe(false);
  expect(hasText("Gestionar")).toBe(false);
  // La biblioteca se lee igual.
  expect(hasText("Agentes (1)")).toBe(true);
});

test("library=false y scheduledTasks=true: el diálogo abre sobre tareas sin el error de biblioteca", async () => {
  flags = { libraryEnabled: false, scheduledTasksEnabled: true };
  await renderAt();
  // Traba 4 (HIVE-A-TEST.md) arreglada: con la biblioteca apagada el ítem ya no invita a
  // "Contexto, agentes y skills" — dice honestamente "Tareas".
  await openLibraryDialog("Tareas");
  expect(hasText("No se pudo leer la biblioteca")).toBe(false);
  expect(hasText("Tareas programadas")).toBe(true);
  expect(hasText("Gestionar")).toBe(true);
  // La sección de propuestas vive con la captura (C2): con tareas encendidas el inbox se lee
  // (el server responde 200, no 404) — la biblioteca en sí no se pide.
  expect(allRequests.filter(entry => entry.method === "GET" && entry.path.endsWith("/library/proposals")).length).toBe(1);
  expect(allRequests.filter(entry => entry.method === "GET" && /\/library$/.test(entry.path)).length).toBe(0); // la biblioteca no se pide (bien)
  // El fixture tiene una propuesta skill: con tareas encendidas también se ve (cada pieza la
  // confirma o no su propia flag al aceptar).
  expect(hasText("Propuestas pendientes (1)")).toBe(true);
  // El título nombra la aplicación y la línea de abajo dice qué hay: tareas, no
  // contexto/agentes/skills.
  expect(document.querySelector('[data-slot="dialog-title"]')?.textContent).toBe("Taller");
  const subtitle = document.querySelector('[data-slot="dialog-header"] p')?.textContent ?? "";
  expect(subtitle).toBe("Tareas");
  expect(subtitle.includes("Contexto, agentes y skills")).toBe(false);
});

test("library=false y scheduledTasks=false: el ítem del menú desaparece", async () => {
  flags = { libraryEnabled: false, scheduledTasksEnabled: false };
  await renderAt();
  await openMenu();
  expect(hasText("Contexto, agentes y skills")).toBe(false);
  expect(hasText("Personalidad y nombre")).toBe(true);
});

test("una tarea mensual se crea con día del mes y se lee en la lista", async () => {
  await renderAt();
  await openLibraryDialog();
  await clickText("Gestionar");
  await clickText("Nueva tarea");
  await edit("task-name", "cierre mensual");
  await edit("task-prompt", "Revisá los balances del mes y avisá diferencias.");
  await clickText("Mensual");
  const day = document.getElementById("task-day") as HTMLInputElement | null;
  expect(day?.value).toBe("1");
  await edit("task-day", "1");
  await edit("task-clock", "09:00");
  // La estimación de costo de una tarea mensual se lee por mes, no como "0 corridas/día".
  expect(hasText("1 corrida/mes")).toBe(true);
  await clickText("Crear tarea");
  const create = taskRequests.find(entry => entry.method === "POST" && entry.path === "/specialist-applications/app_test/tasks");
  expect(create?.body).toEqual({ catchUp: false, name: "cierre mensual", prompt: "Revisá los balances del mes y avisá diferencias.", schedule: { kind: "monthly", dayOfMonth: 1, hour: 9, minute: 0 } });
  expect(taskInputSchema.safeParse(create?.body).success).toBe(true);
  expect(hasText("Día 1 de cada mes a las 09:00")).toBe(true);
});

/** @jsxImportSource react */
// Test de usuario REAL de las salidas del mini-Studio (celda C3): lista, lector con contenido,
// auditoría de citas en voz alta (válida / sin anclas / rota) y gating por flag.
import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://localhost/" });
mock.module("../src/react-app/shell/openwork-connection", () => ({ resolveOpenworkConnection: async () => ({ normalizedBaseUrl: "http://localhost:8787", resolvedToken: "fixture-owner", resolvedHostToken: "fixture-host" }) }));
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { MemoryRouter } = await import("react-router");
const { SpecialistApplicationsProvider, SpecialistApplicationSwitcher } = await import("../src/react-app/domains/specialists/provider");

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let cache: InstanceType<typeof QueryClient>;
let restoreFetch: () => void;

type FakeOutput = { id: string; kind: string; title: string; fromDatasets: string[]; fromSources: string[]; focus: string; createdAt: number; updatedAt: number; workspaceId: string; workspaceName: string };
let flags: { libraryEnabled: boolean; scheduledTasksEnabled: boolean; datasetsEnabled: boolean; sourcesEnabled: boolean; panelsEnabled: boolean; outputsEnabled: boolean };
let outputs: FakeOutput[];
let outputRequests: Array<{ method: string; path: string }> = [];

const APP = { id: "app_test", name: "Taller", specialty: "Prueba", personality: "Clara", template: "custom" as const, agentCount: 1, skillCount: 1, createdAt: 1, workspaceIds: ["ws_test"] };
const catalog = () => ({
  enabled: true,
  libraryEnabled: flags.libraryEnabled,
  scheduledTasksEnabled: flags.scheduledTasksEnabled,
  datasetsEnabled: flags.datasetsEnabled,
  sourcesEnabled: flags.sourcesEnabled,
  panelsEnabled: flags.panelsEnabled,
  outputsEnabled: flags.outputsEnabled,
  integrationsEnabled: false,
  user: { id: "local", displayName: "Usuario de prueba" },
  activeApplicationId: APP.id,
  applications: [APP],
});
const KINDS: Record<string, string> = {
  "out_good": "# Informe soja\n\nLa soja creció [fuente:src_soja#1].",
  "out_unanchored": "sin citas acá",
  "out_rota": "# T\n\nLo inventé [fuente:src_rota#3].",
  "out_cards": JSON.stringify([{ front: "¿Objeto?", back: "Defensa del consumidor." }]),
  "out_quiz": JSON.stringify([{ question: "¿Qué regula?", options: ["Consumidores", "Aduanas"], answer: 0 }]),
};

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  if (!("ResizeObserver" in globalThis)) Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  if (!("IntersectionObserver" in globalThis)) Reflect.set(globalThis, "IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
  flags = { libraryEnabled: true, scheduledTasksEnabled: false, datasetsEnabled: true, sourcesEnabled: true, panelsEnabled: true, outputsEnabled: true };
  outputs = [
    { id: "out_good", kind: "report", title: "Informe soja", fromDatasets: [], fromSources: ["src_soja"], focus: "", createdAt: 1_700_000_100_000, updatedAt: 1_700_000_500_000, workspaceId: "ws_test", workspaceName: "proyecto-principal" },
    { id: "out_unanchored", kind: "table", title: "Tabla de aranceles", fromDatasets: [], fromSources: [], focus: "", createdAt: 1_700_000_000_000, updatedAt: 1_700_000_400_000, workspaceId: "ws_test", workspaceName: "proyecto-principal" },
    { id: "out_rota", kind: "report", title: "Informe con cita rota", fromDatasets: [], fromSources: [], focus: "", createdAt: 1_700_000_000_000, updatedAt: 1_700_000_300_000, workspaceId: "ws_test", workspaceName: "proyecto-principal" },
    { id: "out_cards", kind: "flashcards", title: "Tarjetas de estudio", fromDatasets: [], fromSources: [], focus: "", createdAt: 1_700_000_000_000, updatedAt: 1_700_000_200_000, workspaceId: "ws_test", workspaceName: "proyecto-principal" },
    { id: "out_quiz", kind: "quiz", title: "Quiz de estudio", fromDatasets: [], fromSources: [], focus: "", createdAt: 1_700_000_000_000, updatedAt: 1_700_000_100_000, workspaceId: "ws_test", workspaceName: "proyecto-principal" },
  ];
  outputRequests = [];
  const spy = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (path.includes("/outputs")) outputRequests.push({ method, path });
    if (path === "/specialist-applications" && method === "GET") return Response.json(catalog());
    if (path === "/specialist-applications/app_test/library" && method === "GET") return Response.json({ application: { id: APP.id, name: APP.name }, agents: [], skills: [], files: [], context: { exists: false, bytes: 0 }, counts: { agents: 0, skills: 0 } });
    if (path === "/specialist-applications/app_test/library/proposals" && method === "GET") return Response.json({ proposals: [] });
    for (const kind of ["datasets", "sources", "panels", "tasks"]) {
      if (path === `/specialist-applications/app_test/${kind}` && method === "GET") return Response.json({ [kind]: [] });
    }
    if (path === "/specialist-applications/app_test/outputs" && method === "GET") {
      if (!flags.outputsEnabled) return Response.json({ code: "studio_outputs_disabled", message: "desactivadas" }, { status: 404 });
      return Response.json({ outputs: [...outputs].sort((a, b) => b.updatedAt - a.updatedAt) });
    }
    const audit = path.match(/^\/specialist-applications\/app_test\/outputs\/(out_\w+)\/audit$/);
    if (audit && method === "GET") {
      if (!flags.outputsEnabled) return Response.json({ code: "studio_outputs_disabled", message: "desactivadas" }, { status: 404 });
      if (audit[1] === "out_good") return Response.json({ audit: { total: 1, valid: 1, invalid: [] } });
      if (audit[1] === "out_unanchored") return Response.json({ audit: { total: 0, valid: 0, invalid: [], note: "sin anclas: esta salida no está anclada a fuentes del proyecto" } });
      return Response.json({ audit: { total: 1, valid: 0, invalid: [{ sourceId: "src_rota", chunk: 3, reason: "La fuente src_rota tiene 0 pasajes; el ancla #3 no existe." }] } });
    }
    const byId = path.match(/^\/specialist-applications\/app_test\/outputs\/(out_\w+)$/);
    if (byId && method === "GET") {
      if (!flags.outputsEnabled) return Response.json({ code: "studio_outputs_disabled", message: "desactivadas" }, { status: 404 });
      const target = outputs.find(entry => entry.id === byId[1]);
      if (!target) return Response.json({ code: "output_not_found", message: "Esa salida no existe." }, { status: 404 });
      return Response.json({ output: target, content: KINDS[target.id] ?? "", truncated: false });
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

async function flush(ms = 30) { await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); }); }
async function renderAt() {
  await act(async () => root.render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={["/workspace/ws_test/session"]}>
        <SpecialistApplicationsProvider>
          <SpecialistApplicationSwitcher fallbackName="OpenWork" />
        </SpecialistApplicationsProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  ));
  await flush();
}
function hasText(text: string): boolean { return (document.body.textContent ?? "").includes(text); }
async function openLibraryDialog() {
  const trigger = document.querySelector('[aria-label="Cambiar aplicación especialista"]');
  if (!trigger) throw new Error("Missing switcher");
  await act(async () => { trigger.click(); });
  await flush();
  const item = [...document.querySelectorAll('button, [role="menuitem"]')].find(el => (el.textContent ?? "").includes("Contexto, agentes y skills"));
  if (!item) throw new Error("Missing menu item");
  await act(async () => { item.click(); });
  await flush();
}
async function openOutputsView() {
  await renderAt();
  await openLibraryDialog();
  expect(hasText("Salidas del mini-Studio")).toBe(true);
  const sections = [...document.querySelectorAll("section")];
  const section = sections.find(s => (s.textContent ?? "").startsWith("Salidas del mini-Studio"));
  if (!section) throw new Error("Missing Salidas section");
  await act(async () => { [...section.querySelectorAll("button")].find(b => (b.textContent ?? "").includes("Gestionar"))!.click(); });
  await flush();
  expect(hasText("Salidas del mini-Studio de Taller")).toBe(true);
}

test("recorrido: resumen → Gestionar → lector con auditoría de citas en voz alta", async () => {
  await openOutputsView();
  expect(hasText("Informe soja")).toBe(true);
  expect(hasText("Tabla de aranceles")).toBe(true);
  expect(hasText("Informe")).toBe(true);
  expect(hasText("Tabla")).toBe(true);

  // Ver la buena: contenido + ✓ 1/1.
  const goodRow = [...document.querySelectorAll("div.rounded-md")].find(el => (el.textContent ?? "").includes("Informe soja"));
  await act(async () => { [...(goodRow as HTMLElement).querySelectorAll("button")].find(b => (b.textContent ?? "").trim() === "Ver")!.click(); });
  await flush();
  expect(hasText("La soja creció [fuente:src_soja#1].")).toBe(true);
  expect(hasText("✓ 1/1 citas resuelven a pasajes reales del proyecto.")).toBe(true);

  // Sin anclas: advertencia textual, no silencio.
  const unanchoredRow = [...document.querySelectorAll("div.rounded-md")].find(el => (el.textContent ?? "").includes("Tabla de aranceles"));
  await act(async () => { [...(unanchoredRow as HTMLElement).querySelectorAll("button")].find(b => (b.textContent ?? "").trim() === "Ver")!.click(); });
  await flush();
  expect(hasText("Sin anclas: esta salida no está anclada a fuentes del proyecto.")).toBe(true);

  // Cita rota: error con el ancla exacta.
  const brokenRow = [...document.querySelectorAll("div.rounded-md")].find(el => (el.textContent ?? "").includes("Informe con cita rota"));
  await act(async () => { [...(brokenRow as HTMLElement).querySelectorAll("button")].find(b => (b.textContent ?? "").trim() === "Ver")!.click(); });
  await flush();
  expect(hasText("1 cita no resuelve")).toBe(true);
  expect(hasText("[fuente:src_rota#3]")).toBe(true);
  expect(outputRequests.some(e => e.method === "GET" && e.path.endsWith("/outputs/out_good/audit"))).toBe(true);
});

test("outputsEnabled=false: la sección no aparece y no se dispara ningún request de salidas", async () => {
  flags = { libraryEnabled: true, scheduledTasksEnabled: false, datasetsEnabled: true, sourcesEnabled: true, panelsEnabled: true, outputsEnabled: false };
  await renderAt();
  await openLibraryDialog();
  expect(hasText("Salidas del mini-Studio")).toBe(false);
  expect(outputRequests.length).toBe(0);
});


test("flashcards flip and a quiz marks the answer right or wrong", async () => {
  await openOutputsView();
  const openOutput = async (title: string) => {
    const row = [...document.querySelectorAll("div.rounded-md")].find(el => (el.textContent ?? "").includes(title));
    await act(async () => { [...(row as HTMLElement).querySelectorAll("button")].find(b => (b.textContent ?? "").trim() === "Ver")!.click(); });
    await flush();
  };
  await openOutput("Tarjetas de estudio");
  expect(hasText("¿Objeto?")).toBe(true);
  expect(hasText("Tocá para ver la respuesta")).toBe(true);
  const card = [...document.querySelectorAll("button")].find(b => (b.textContent ?? "").includes("¿Objeto?"));
  await act(async () => { (card as HTMLButtonElement).click(); });
  await flush();
  expect(hasText("Defensa del consumidor.")).toBe(true);

  await openOutput("Quiz de estudio");
  expect(hasText("¿Qué regula?")).toBe(true);
  const right = [...document.querySelectorAll("button")].find(b => (b.textContent ?? "").trim() === "Consumidores");
  await act(async () => { (right as HTMLButtonElement).click(); });
  await flush();
  expect(hasText("Correcto.")).toBe(true);
  const wrong = [...document.querySelectorAll("button")].find(b => (b.textContent ?? "").trim() === "Aduanas");
  await act(async () => { (wrong as HTMLButtonElement).click(); });
  await flush();
  expect(hasText("Incorrecto: la respuesta es \"Consumidores\".")).toBe(true);
});

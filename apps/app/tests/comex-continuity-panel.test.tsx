/** @jsxImportSource react */
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
const ownsDom = !GlobalRegistrator.isRegistered;
if (ownsDom) GlobalRegistrator.register({ url: "http://localhost/" });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { ComexContinuityPanel } = await import("../src/react-app/domains/session/comex/continuity-panel");
const { createOpenworkServerClient, OpenworkServerError } = await import("../src/app/lib/openwork-server");
import type { ComexCheckpointState, OpenworkServerClient } from "../src/app/lib/openwork-server";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let cache: InstanceType<typeof QueryClient>;
let state: ComexCheckpointState;
let offline = false;
let writes = 0;
const initial = () => ({ status: "ready", revision: 1, checkpoint: { version: 1, revision: 1, sessionId: "ses_a", updatedAt: "2026-11-05T10:00:00.000Z", objective: "Informe", decisions: ["Mercado confirmado"], progress: [], pending: ["Revisar cifras"], artifacts: [] } }) satisfies ComexCheckpointState;
const client: OpenworkServerClient = {
  ...createOpenworkServerClient({ baseUrl: "http://localhost/continuity-test" }),
  getComexCheckpoint: async () => state,
  putComexCheckpoint: async (_, __, body) => {
    if (offline) throw new OpenworkServerError(503, "offline", "offline");
    if (body.expectedRevision !== state.revision) throw new OpenworkServerError(409, "continuity_conflict", "changed");
    writes++;
    state = { status: "ready", revision: state.revision + 1, checkpoint: { ...body.checkpoint, version: 1, sessionId: "ses_a", revision: state.revision + 1, updatedAt: "2026-11-05T11:00:00.000Z" } };
    return state;
  },
};
beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  state = initial(); offline = false; writes = 0; localStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(async () => { await act(async () => root.unmount()); cache.clear(); host.remove(); });
afterAll(async () => { if (ownsDom) await GlobalRegistrator.unregister(); });
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function render(sessionId = "ses_a") {
  await act(async () => root.render(<QueryClientProvider client={cache}><ComexContinuityPanel client={client} workspaceId="ws_a" sessionId={sessionId} /></QueryClientProvider>));
  await flush();
}
function button(label: string) {
  const element = Array.from(host.querySelectorAll("button")).find(item => item.textContent === label);
  if (!element) throw new Error(`Missing button ${label}`);
  return element;
}
async function click(label: string) { await act(async () => button(label).click()); await flush(); }
function field(label = "Objetivo") {
  const element = host.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`);
  if (!element) throw new Error(`Missing field ${label}`);
  return element;
}
async function edit(value: string, label = "Objetivo") {
  await act(async () => {
    const element = field(label); element.focus();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function open() { await render(); await click("Continuidad de esta conversación"); }

test("explicit save persists structured fields and reopens the saved checkpoint", async () => {
  await open();
  expect(field().value).toBe("Informe");
  expect(host.textContent).toContain("Los mensajes no se resumen automáticamente");
  await edit("Informe final"); await edit("Revisar cifras\nVerificar fuentes", "Próximos pasos");
  await click("Guardar resumen");
  expect(state.checkpoint?.pending).toEqual(["Revisar cifras", "Verificar fuentes"]);
  expect(writes).toBe(1);
  await click("Continuidad de esta conversación"); await click("Continuidad de esta conversación");
  expect(field().value).toBe("Informe final");
});
test("offline save and collapse preserve the unsaved draft", async () => {
  await open(); await edit("Mi borrador"); offline = true;
  await click("Guardar resumen");
  expect(field().value).toBe("Mi borrador"); expect(writes).toBe(0);
  await click("Continuidad de esta conversación"); await click("Continuidad de esta conversación");
  expect(field().value).toBe("Mi borrador");
  expect(host.textContent).toContain("Conservás el borrador");
});
test("conflicts expose the saved notes and require another explicit save", async () => {
  await open(); await edit("Mi decisión");
  const changed = initial(); changed.revision = 2; changed.checkpoint.revision = 2; changed.checkpoint.objective = "Decisión de otra ventana"; state = changed;
  await click("Guardar resumen");
  expect(host.textContent).toContain("Decisión de otra ventana");
  expect(button("Guardar resumen").disabled).toBe(true);
  expect(field().value).toBe("Mi decisión"); expect(writes).toBe(0);
  await click("Conservar mi borrador");
  expect(writes).toBe(0);
  await click("Guardar resumen");
  expect(state.checkpoint?.objective).toBe("Mi decisión"); expect(state.revision).toBe(3);
});
test("using the saved version keeps the previous draft recoverable", async () => {
  await open(); await edit("Borrador recuperable");
  const changed = initial(); changed.revision = 2; changed.checkpoint.objective = "Actual"; state = changed;
  await click("Guardar resumen"); await click("Usar versión guardada");
  expect(field().value).toBe("Actual");
  await click("Recuperar mi borrador");
  expect(field().value).toBe("Borrador recuperable"); expect(writes).toBe(0);
});
test("invalid checkpoint stays untouched and a changed session never inherits a draft", async () => {
  await open(); await edit("Solo en sesión A");
  state = { status: "invalid", revision: 0, checkpoint: null };
  await render("ses_b"); await click("Continuidad de esta conversación");
  expect(host.textContent).toContain("Se conservó el archivo original");
  expect(host.querySelector('textarea[aria-label="Objetivo"]')).toBeNull(); expect(writes).toBe(0);
});

test("a remounted draft restores its original revision and never overwrites a newer checkpoint", async () => {
  await open(); await edit("Borrador previo al cierre"); offline = true;
  await click("Guardar resumen");
  await render("ses_b"); await click("Continuidad de esta conversación");
  expect(field().value).not.toBe("Borrador previo al cierre");
  const changed = initial(); changed.revision = 2; changed.checkpoint.revision = 2; changed.checkpoint.objective = "Actualizado durante el cierre"; state = changed;
  offline = false;
  await render("ses_a"); await click("Continuidad de esta conversación");
  expect(field().value).toBe("Borrador previo al cierre");
  await click("Guardar resumen");
  expect(host.textContent).toContain("Actualizado durante el cierre"); expect(writes).toBe(0);
});

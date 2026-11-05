/** @jsxImportSource react */
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const ownsDom = !GlobalRegistrator.isRegistered;
if (ownsDom) GlobalRegistrator.register({ url: "http://localhost/" });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { ComexProjectPanel } = await import("../src/react-app/domains/session/comex/project-panel");
const { createOpenworkServerClient, OpenworkServerError } = await import("../src/app/lib/openwork-server");
import type { OpenworkServerClient } from "../src/app/lib/openwork-server";
import type { OpenTarget } from "../src/react-app/domains/session/artifacts/open-target";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let cache: InstanceType<typeof QueryClient>;
const notes = new Map<string, { content: string; updatedAt: number }>();
let failWrite = false;
let target: OpenTarget | null = null;
const client: OpenworkServerClient = {
  ...createOpenworkServerClient({ baseUrl: "http://localhost/comex-test" }),
  listWorkspaceFiles: async () => ({ items: [{ path: "informe.docx", kind: "file", size: 10, mtimeMs: 1, revision: "1" }], total: 1, truncated: false }),
  readWorkspaceFile: async (_, path, options) => {
    expect(options?.fileScope).toBe("workspace");
    const value = notes.get(path);
    if (!value) throw new OpenworkServerError(404, "not_found", "missing");
    return { path, bytes: value.content.length, ...value };
  },
  writeWorkspaceFile: async (_, payload) => {
    expect(payload.fileScope).toBe("workspace");
    if (failWrite) throw new OpenworkServerError(503, "offline", "offline");
    const current = notes.get(payload.path);
    if (current && payload.baseUpdatedAt !== current.updatedAt) throw new OpenworkServerError(409, "conflict", "changed");
    const updatedAt = (current?.updatedAt ?? 0) + 1;
    notes.set(payload.path, { content: payload.content, updatedAt });
    return { ok: true, path: payload.path, bytes: payload.content.length, updatedAt };
  },
};

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  notes.clear(); localStorage.clear(); failWrite = false; target = null;
  notes.set("comex/estado.md", { content: "Decisión inicial", updatedAt: 1 });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(async () => { await act(async () => root.unmount()); cache.clear(); host.remove(); });
afterAll(async () => { if (ownsDom) await GlobalRegistrator.unregister(); });
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function render(sessionId = "ses_first") {
  await act(async () => root.render(<QueryClientProvider client={cache}><ComexProjectPanel key={sessionId} client={client} workspaceId="ws_fixture" sessionId={sessionId} onOpenTarget={value => { target = value; }} /></QueryClientProvider>));
  await flush();
}
function button(label: string) {
  const element = Array.from(host.querySelectorAll("button")).find(item => item.textContent === label);
  if (!element) throw new Error(`Missing button ${label}`);
  return element;
}
function editor() {
  const element = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Notas de memoria"]');
  if (!element) throw new Error("Missing editor");
  return element;
}
async function edit(text: string) {
  await act(async () => {
    const field = editor(); field.focus();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(label: string) { await act(async () => button(label).click()); await flush(); }

test("project results pin the workspace even when a conversation has another directory", async () => {
  await render(); await click("informe.docx");
  expect(target).toMatchObject({ value: "informe.docx", fileScope: "workspace", preview: "document" });
});
test("a failed save preserves the draft across unmount, while sessions have independent notes", async () => {
  await render(); await edit("Mis decisiones pendientes");
  failWrite = true; await click("Guardar memoria");
  expect(editor().value).toBe("Mis decisiones pendientes");
  await render("ses_second");
  expect(editor().value).toBe("Mis decisiones pendientes");
  await click("Esta sesión"); await edit("Notas del segundo chat");
  failWrite = false; await click("Guardar memoria");
  await render("ses_first"); await click("Esta sesión");
  expect(editor().value).not.toContain("Notas del segundo chat");
  expect(notes.get("comex/estado.md")?.content).toBe("Decisión inicial");
});
test("concurrent edits require comparing the current version before overwriting", async () => {
  await render(); await edit("Mis notas");
  notes.set("comex/estado.md", { content: "Cambios del otro chat", updatedAt: 2 });
  await click("Guardar memoria");
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="Memoria guardada por otra sesión"]')?.value).toBe("Cambios del otro chat");
  expect(button("Guardar memoria").disabled).toBe(true);
  await click("Conservar mis notas");
  expect(notes.get("comex/estado.md")?.content).toBe("Cambios del otro chat");
  await click("Guardar memoria");
  expect(notes.get("comex/estado.md")?.content).toBe("Mis notas");
});
test("choosing the saved version offers recovery without writing the old draft", async () => {
  await render(); await edit("Borrador recuperable");
  notes.set("comex/estado.md", { content: "Versión guardada", updatedAt: 2 });
  await click("Guardar memoria"); await click("Usar versión guardada");
  expect(editor().value).toBe("Versión guardada");
  await click("Recuperar mis notas anteriores");
  expect(editor().value).toBe("Borrador recuperable");
  expect(notes.get("comex/estado.md")?.content).toBe("Versión guardada");
});
test("a session note created after the empty editor loaded is compared instead of overwritten", async () => {
  await render(); await click("Esta sesión"); await edit("Mis primeras notas");
  notes.set("comex/sesiones/ses_first.md", { content: "Creada por otro proceso", updatedAt: 1 });
  await click("Guardar memoria");
  expect(editor().value).toBe("Mis primeras notas");
  expect(notes.get("comex/sesiones/ses_first.md")?.content).toBe("Creada por otro proceso");
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="Memoria guardada por otra sesión"]')?.value).toBe("Creada por otro proceso");
});

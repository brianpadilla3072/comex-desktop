/** @jsxImportSource react */
import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const ownsDom = !GlobalRegistrator.isRegistered;
if (ownsDom) GlobalRegistrator.register({ url: "http://localhost/" });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

type Page = import("@openwork/types/designs").DesignPage;
type Manifest = import("@openwork/types/designs").DesignManifest;

// The sandboxed viewer belongs to the base (A); the editor only decides which page, width and scale it shows.
mock.module("../src/react-app/domains/design/design-frame", () => ({
  DesignFrame: (props: { page: Page; scale?: number; reloadKey?: string | number; interactive?: boolean }) => (
    <div data-fake-frame={props.page.id} data-width={props.page.width} data-height={props.page.height} data-scale={props.scale} data-reload={String(props.reloadKey)} />
  ),
}));

const { t } = await import("../src/i18n");
const { ConfirmDialogHost } = await import("../src/components/ui/confirm-dialog");
const { MockupEditor } = await import("../src/react-app/domains/design/editors/mockup-editor");
const mockupModel = await import("../src/react-app/domains/design/editors/mockup-model");
const { mockupTemplateHtml, MOCKUP_TEMPLATE_IDS } = await import("../src/react-app/domains/design/editors/mockup-templates");
const { designManifestSchema } = await import("@openwork/types/designs");
type Props = import("../src/react-app/domains/design/editors/mockup-editor").MockupEditorProps;
type Client = Props["client"];

const page = (id: string, title: string, width = 1440, height = 900): Page => ({ id, title, file: `pages/${id}.html`, width, height });
const manifest = (pages: Page[], updatedAt = 1): Manifest => ({
  format: "openwork.design", version: 1, id: "pantallas-1", kind: "mockup", title: "App de pedidos", createdAt: 1, updatedAt, pages, systemId: null, thumbnail: null,
});

let design: Manifest;
let calls: { name: string; args: unknown[] }[];
let asks: { text: string; context?: string }[];
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let counter = 0;

function fakeClient(withUpdate = false): Client {
  const client: Client = {
    readDesignFile: async (_ws, _id, path) => new Blob([`<html><body>${path}</body></html>`], { type: "text/html" }),
    writeDesignFile: async (_ws, _id, path, body) => {
      calls.push({ name: "writeDesignFile", args: [path, body] });
      if (path === "design.json" && typeof body === "string") design = designManifestSchema.parse(JSON.parse(body));
      return { ok: true, design };
    },
    addDesignPage: async (_ws, _id, input) => {
      calls.push({ name: "addDesignPage", args: [input] });
      counter += 1;
      const added = page(`p-new-${counter}`, input.title ?? "");
      const at = input.afterPageId ? design.pages.findIndex(p => p.id === input.afterPageId) + 1 : design.pages.length;
      design = { ...design, updatedAt: design.updatedAt + 1, pages: [...design.pages.slice(0, at), added, ...design.pages.slice(at)] };
      return { design };
    },
    reorderDesignPages: async (_ws, _id, pageIds) => {
      calls.push({ name: "reorderDesignPages", args: [pageIds] });
      design = { ...design, pages: pageIds.flatMap(id => design.pages.filter(p => p.id === id)) };
      return { design };
    },
    deleteDesignPage: async (_ws, _id, pageId) => {
      calls.push({ name: "deleteDesignPage", args: [pageId] });
      design = { ...design, pages: design.pages.filter(p => p.id !== pageId) };
      return { design };
    },
  };
  if (withUpdate) {
    client.updateDesignPage = async (_ws, _id, pageId, patch) => {
      calls.push({ name: "updateDesignPage", args: [pageId, patch] });
      design = { ...design, pages: design.pages.map(p => (p.id === pageId ? { ...p, title: patch.title } : p)) };
      return { design };
    };
  }
  return client;
}

beforeEach(() => {
  design = manifest([page("inicio", "Inicio"), page("pedido", "Pedido"), page("perfil", "Perfil", 390, 844)]);
  calls = [];
  asks = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

afterAll(async () => {
  if (ownsDom) await GlobalRegistrator.unregister();
});

const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0)); });

async function render(overrides: Partial<Props> = {}) {
  const props: Props = {
    workspaceId: "ws_1", design, writable: true, client: fakeClient(), chatOpen: true, onChanged: () => undefined,
    onAskAgent: (text, context) => { asks.push({ text, context }); },
    ...overrides,
  };
  await act(async () => root.render(<><MockupEditor {...props} /><ConfirmDialogHost /></>));
  await settle();
  return props;
}

const frame = () => container.querySelector("[data-fake-frame]");
const screens = () => [...container.querySelectorAll("[data-mockup-screen]")].map(row => row.getAttribute("data-mockup-screen"));
async function click(element: Element | null) {
  if (!(element instanceof HTMLElement)) throw new Error("missing element");
  await act(async () => element.click());
  await settle();
}
async function openMenu(trigger: Element | null) {
  if (!(trigger instanceof HTMLElement)) throw new Error("missing trigger");
  await act(async () => {
    trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }));
    trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    trigger.click();
  });
  await settle();
}
const menuItem = (text: string) => [...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent?.includes(text)) ?? null;

test("the width toggle re-renders the screen at desktop, tablet and phone widths", async () => {
  await render();
  expect(frame()?.getAttribute("data-fake-frame")).toBe("inicio");
  expect([frame()?.getAttribute("data-width"), frame()?.getAttribute("data-height")]).toEqual(["1440", "900"]);
  await click(container.querySelector('[data-mockup-width="tablet"]'));
  expect([frame()?.getAttribute("data-width"), frame()?.getAttribute("data-height")]).toEqual(["834", "1194"]);
  expect(container.querySelector("[data-mockup-canvas]")?.getAttribute("data-mockup-canvas")).toBe("tablet");
  await click(container.querySelector('[data-mockup-width="phone"]'));
  expect([frame()?.getAttribute("data-width"), frame()?.getAttribute("data-height")]).toEqual(["390", "844"]);
  expect(container.querySelector("[data-mockup-zoom]")?.textContent).toBe("100%");
  await click(container.querySelector('[data-mockup-width="desktop"]'));
  expect(frame()?.getAttribute("data-width")).toBe("1440");
});

test("zoom steps and fit", async () => {
  await render();
  const zoomText = () => container.querySelector("[data-mockup-zoom]")?.textContent;
  const fitted = zoomText();
  await click(container.querySelector(`[aria-label="${t("design_ui.mockup.zoom_in")}"]`));
  expect(zoomText()).not.toBe(fitted);
  await click([...container.querySelectorAll("button")].find(b => b.textContent === t("design_ui.mockup.zoom_fit")) ?? null);
  expect(zoomText()).toBe(fitted);
});

test("selecting a screen shows it; reorder with Alt+arrows calls the server", async () => {
  await render();
  await click(container.querySelector('[data-mockup-screen="pedido"] button'));
  expect(frame()?.getAttribute("data-fake-frame")).toBe("pedido");
  const row = container.querySelector('[data-mockup-screen="pedido"] button');
  await act(async () => { row?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true })); });
  await settle();
  expect(calls.find(c => c.name === "reorderDesignPages")?.args).toEqual([["pedido", "inicio", "perfil"]]);
  expect(screens()).toEqual(["pedido", "inicio", "perfil"]);
});

test("rename by double-click: uses updateDesignPage when the server has it", async () => {
  await render({ client: fakeClient(true) });
  await act(async () => { container.querySelector('[data-mockup-screen="pedido"] button')?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
  await settle();
  const input = container.querySelector("[data-mockup-rename]");
  if (!(input instanceof HTMLInputElement)) throw new Error("no rename field");
  input.value = "Detalle del pedido";
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  await settle();
  expect(calls.find(c => c.name === "updateDesignPage")?.args).toEqual(["pedido", { title: "Detalle del pedido" }]);
  expect(container.querySelector('[data-mockup-screen="pedido"]')?.textContent).toContain("Detalle del pedido");
});

test("rename falls back to a validated design.json write", async () => {
  await render();
  await act(async () => { container.querySelector('[data-mockup-screen="perfil"] button')?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
  await settle();
  const input = container.querySelector("[data-mockup-rename]");
  if (!(input instanceof HTMLInputElement)) throw new Error("no rename field");
  input.value = "Mi perfil";
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  await settle();
  const write = calls.find(c => c.name === "writeDesignFile");
  expect(write?.args[0]).toBe("design.json");
  expect(design.pages.find(p => p.id === "perfil")?.title).toBe("Mi perfil");
});

test("add a screen from a template and delete one after confirming", async () => {
  await render();
  await openMenu(container.querySelector("[data-mockup-add]"));
  await click(menuItem(t("design_ui.mockup.template.form")));
  const add = calls.find(c => c.name === "addDesignPage");
  expect(add?.args[0]).toMatchObject({ title: t("design_ui.mockup.template.form"), afterPageId: "inicio" });
  expect(JSON.stringify(add?.args[0])).toContain("<form>");
  expect(screens()).toEqual(["inicio", "p-new-1", "pedido", "perfil"]);
  expect(frame()?.getAttribute("data-fake-frame")).toBe("p-new-1");

  await openMenu(container.querySelector(`[aria-label="${t("design_ui.mockup.screen_actions", { title: "Pedido" })}"]`));
  await click(menuItem(t("design_ui.mockup.delete")));
  await click(document.querySelector("[data-slot='alert-dialog-action']"));
  expect(calls.find(c => c.name === "deleteDesignPage")?.args).toEqual(["pedido"]);
  expect(screens()).toEqual(["inicio", "p-new-1", "perfil"]);
});

test("ask the agent for a screen with the design as context", async () => {
  await render();
  await openMenu(container.querySelector("[data-mockup-add]"));
  await click(menuItem(t("design_ui.mockup.ask_screen")));
  const textarea = document.querySelector("textarea");
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("no textarea");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, "Una pantalla de seguimiento de envíos");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => textarea.form?.requestSubmit());
  expect(asks[0]?.text).toBe("Una pantalla de seguimiento de envíos");
  expect(asks[0]?.context).toContain("proyecto/diseno/pantallas-1/");
  expect(asks[0]?.context).toContain('"Inicio"');
});

test("present: full screen at the chosen width, arrows move, Escape leaves", async () => {
  await render();
  await click(container.querySelector('[data-mockup-width="phone"]'));
  await click([...container.querySelectorAll("button")].find(b => b.textContent?.includes(t("design_ui.mockup.present"))) ?? null);
  const overlay = () => document.querySelector("[data-mockup-present]");
  expect(overlay()?.querySelector("[data-fake-frame]")?.getAttribute("data-width")).toBe("390");
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" })); });
  expect(overlay()?.querySelector("[data-fake-frame]")?.getAttribute("data-fake-frame")).toBe("pedido");
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
  expect(overlay()).toBeNull();
});

test("read-only designs show the screens without editing controls", async () => {
  await render({ writable: false });
  expect(container.querySelector("[data-mockup-add]")).toBeNull();
  expect(container.querySelector(`[aria-label="${t("design_ui.mockup.screen_actions", { title: "Inicio" })}"]`)).toBeNull();
  expect(frame()).not.toBeNull();
});

test("model: presets, page widths, reorder and rename validation", () => {
  expect(mockupModel.presetForPage(page("x", "x", 390, 844))).toBe("phone");
  expect(mockupModel.presetForPage(page("x", "x", 800, 1000))).toBe("tablet");
  expect(mockupModel.pageAtWidth(page("x", "x", 1440, 2400), "desktop")).toMatchObject({ width: 1440, height: 2400 });
  expect(mockupModel.pageAtWidth(page("x", "x", 390, 844), "desktop")).toMatchObject({ width: 1440, height: 900 });
  expect(mockupModel.movePageId(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
  expect(mockupModel.movePageId(["a", "b", "c"], "a", 2)).toEqual(["b", "c", "a"]);
  expect(mockupModel.renamePage(design, "inicio", "   ")).toBeNull();
  expect(mockupModel.renamePage(design, "nope", "X")).toBeNull();
  expect(mockupModel.renamePage(design, "inicio", "Portada", 5)?.pages[0]).toMatchObject({ title: "Portada" });
  expect(mockupModel.designFromReply({ design })).toEqual(design);
  expect(mockupModel.designFromReply({ ok: true })).toBeNull();
  expect(mockupModel.fitWidthScale(784, 1440)).toBeCloseTo(0.5);
  expect(mockupModel.fitScale({ width: 2000, height: 500 }, { width: 1440, height: 900 }, 25)).toBeCloseTo(0.5);
  expect(mockupModel.nextZoom(0.5, 1)).toBe(0.67);
  expect(mockupModel.nextZoom(0.5, -1)).toBe(0.33);
});

test("templates are self-contained documents with the escaped title", () => {
  for (const id of MOCKUP_TEMPLATE_IDS) {
    const html = mockupTemplateHtml(id, "Pedidos <nuevos>");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("Pedidos &lt;nuevos&gt;");
    expect(html).not.toMatch(/(?:src|href)="(?:https?:)?\/\//);
    expect(html).not.toContain("<script");
  }
});

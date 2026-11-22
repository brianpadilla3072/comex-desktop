/** @jsxImportSource react */
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const ownsDom = !GlobalRegistrator.isRegistered;
if (ownsDom) GlobalRegistrator.register({ url: "http://localhost/" });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const { t } = await import("../src/i18n");
const { OpenworkServerError } = await import("../src/app/lib/openwork-server");
const { BoardEditor } = await import("../src/react-app/domains/design/editors/board-editor");
const model = await import("../src/react-app/domains/design/editors/board-model");
const { boardSchema } = await import("@openwork/types/designs");
type Board = import("@openwork/types/designs").Board;
type Manifest = import("@openwork/types/designs").DesignManifest;
type Props = import("../src/react-app/domains/design/editors/board-editor").BoardEditorProps;

const design: Manifest = {
  format: "openwork.design", version: 1, id: "pizarra-1", kind: "board", title: "Pizarra de ideas", createdAt: 1, updatedAt: 1,
  pages: [{ id: "canvas", title: "Pizarra", file: "pages/canvas.html", width: 4000, height: 3000 }], systemId: null, thumbnail: null,
};

let files: Map<string, string | Blob>;
let writes: { path: string; body: string | Blob }[];
let asks: { text: string; context?: string }[];
let changed: number;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

const client: Props["client"] = {
  readDesignFile: async (_ws, _id, path) => {
    const value = files.get(path);
    if (value === undefined) throw new OpenworkServerError(404, "design_file_not_found", "missing");
    return typeof value === "string" ? new Blob([value], { type: "application/json" }) : value;
  },
  writeDesignFile: async (_ws, _id, path, body) => {
    writes.push({ path, body });
    files.set(path, body);
    return { ok: true };
  },
};

function boardText(board: Board) {
  const result = model.serializeBoard(board);
  if (!result.ok) throw new Error(result.reason);
  return result.text;
}

const startBoard = (): Board => model.addElements(model.emptyBoard(), [
  model.makeElement({ type: "rect" }, { x: 100, y: 100, width: 100, height: 50 }, "r1"),
  model.makeElement({ type: "rect" }, { x: 300, y: 100, width: 100, height: 50 }, "r2"),
]);

beforeEach(() => {
  files = new Map([["board.json", boardText(startBoard())]]);
  writes = [];
  asks = [];
  changed = 0;
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

const flush = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0)); });
const waitSave = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 700)); });

async function render(overrides: Partial<Props> = {}) {
  const props: Props = {
    workspaceId: "ws_1", design, writable: true, client, chatOpen: true,
    onChanged: () => { changed += 1; },
    onAskAgent: (text, context) => { asks.push({ text, context }); },
    ...overrides,
  };
  await act(async () => root.render(<BoardEditor {...props} />));
  await flush();
  return props;
}

const canvas = () => {
  const element = container.querySelector("[data-board-canvas]");
  if (!element) throw new Error("no canvas");
  return element;
};
const surface = () => {
  const element = container.querySelector('[role="application"]');
  if (!element) throw new Error("no surface");
  return element;
};

async function pointer(type: "pointerdown" | "pointermove" | "pointerup", x: number, y: number, init: PointerEventInit = {}, target: Element = canvas()) {
  await act(async () => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1, ...init }));
  });
}
async function drag(from: [number, number], to: [number, number], init: PointerEventInit = {}) {
  await pointer("pointerdown", from[0], from[1], init);
  await pointer("pointermove", (from[0] + to[0]) / 2, (from[1] + to[1]) / 2, init);
  await pointer("pointermove", to[0], to[1], init);
  await pointer("pointerup", to[0], to[1], init);
}
async function key(keyName: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    surface().dispatchEvent(new KeyboardEvent("keydown", { key: keyName, bubbles: true, cancelable: true, ...init }));
  });
}

function savedBoard(): Board {
  const last = writes.filter(w => w.path === "board.json").at(-1);
  if (!last || typeof last.body !== "string") throw new Error("no save");
  return boardSchema.parse(JSON.parse(last.body));
}

const selectedCount = () => container.querySelector('section[aria-label] p[aria-live]')?.textContent ?? "";

test("loads board.json, shows the tools with shortcuts and an accessible toolbar", async () => {
  await render();
  const toolbar = container.querySelector('[role="toolbar"]');
  expect(toolbar?.getAttribute("aria-label")).toBe(t("design_ui.board.toolbar_label"));
  const tools = [...container.querySelectorAll("[data-tool]")].map(b => b.getAttribute("data-tool"));
  expect(tools).toEqual(["select", "hand", "frame", "text", "sticky", "pen", "rect", "ellipse", "image"]);
  const rectButton = container.querySelector('[data-tool="rect"]');
  expect(rectButton?.getAttribute("aria-keyshortcuts")).toBe("R");
  expect(rectButton?.getAttribute("title")).toBe(t("design_ui.board.with_shortcut", { label: t("design_ui.board.tool.rect"), shortcut: "R" }));
  expect(canvas().querySelectorAll('[data-element-id="r1"], [data-element-id="r2"]')).toHaveLength(2);
});

test("a missing board.json opens an empty board", async () => {
  files.clear();
  await render();
  expect(container.querySelector("[data-board-editor]")).not.toBeNull();
  expect(canvas().querySelectorAll("[data-element-id]")).toHaveLength(0);
});

test("an invalid board.json shows a recovery that asks the agent", async () => {
  files.set("board.json", "{ no es json");
  await render();
  expect(container.querySelector('[data-board-state="invalid"]')).not.toBeNull();
  const repair = [...container.querySelectorAll("button")].find(b => b.textContent === t("design_ui.board.repair"));
  await act(async () => repair?.click());
  expect(asks[0]?.text).toBe(t("design_ui.board.repair_request"));
});

test("drawing a rectangle with the R shortcut saves a valid board.json", async () => {
  await render();
  await key("r");
  expect(container.querySelector('[data-tool="rect"]')?.getAttribute("aria-pressed")).toBe("true");
  await drag([500, 300], [700, 420]);
  expect(container.querySelector('[data-tool="select"]')?.getAttribute("aria-pressed")).toBe("true");
  await waitSave();
  const saved = savedBoard();
  expect(saved.elements).toHaveLength(3);
  expect(saved.elements[2]).toMatchObject({ type: "rect", x: 500, y: 300, width: 200, height: 120, frameId: null });
  expect(changed).toBeGreaterThan(0);
  expect(selectedCount()).toBe(t("design_ui.board.selected_count", { count: 1 }));
});

test("select and move, then undo and redo", async () => {
  await render();
  await drag([120, 120], [170, 140]);
  await waitSave();
  expect(savedBoard().elements.find(e => e.id === "r1")).toMatchObject({ x: 150, y: 120 });
  await key("z", { ctrlKey: true });
  await waitSave();
  expect(savedBoard().elements.find(e => e.id === "r1")).toMatchObject({ x: 100, y: 100 });
  await key("z", { ctrlKey: true, shiftKey: true });
  await waitSave();
  expect(savedBoard().elements.find(e => e.id === "r1")).toMatchObject({ x: 150, y: 120 });
});

test("shift-click adds to the selection; marquee selects what it encloses", async () => {
  await render();
  await pointer("pointerdown", 120, 120);
  await pointer("pointerup", 120, 120);
  await pointer("pointerdown", 320, 120, { shiftKey: true });
  await pointer("pointerup", 320, 120, { shiftKey: true });
  expect(selectedCount()).toBe(t("design_ui.board.selected_count", { count: 2 }));
  await key("Escape");
  expect(container.querySelector("section[aria-label]")).toBeNull();
  await drag([50, 50], [250, 250]);
  expect(selectedCount()).toBe(t("design_ui.board.selected_count", { count: 1 }));
  expect(canvas().querySelector('[data-selection="r1"]')).not.toBeNull();
});

test("delete, duplicate (ctrl+d) and nudge with arrows", async () => {
  await render();
  await pointer("pointerdown", 120, 120);
  await pointer("pointerup", 120, 120);
  await key("d", { ctrlKey: true });
  await key("ArrowRight", { shiftKey: true });
  await waitSave();
  let saved = savedBoard();
  expect(saved.elements).toHaveLength(3);
  expect(saved.elements[2]).toMatchObject({ type: "rect", x: 134, y: 124 });
  await key("Delete");
  await waitSave();
  saved = savedBoard();
  expect(saved.elements.map(e => e.id)).toEqual(["r1", "r2"]);
});

test("resize with a handle and draw with the pen", async () => {
  await render();
  await pointer("pointerdown", 120, 120);
  await pointer("pointerup", 120, 120);
  const handle = canvas().querySelector('[data-handle="se"]');
  if (!handle) throw new Error("no handle");
  await pointer("pointerdown", 200, 150, {}, handle);
  await pointer("pointermove", 240, 170);
  await pointer("pointerup", 240, 170);
  await key("p");
  await pointer("pointerdown", 600, 600);
  for (let i = 1; i <= 10; i++) await pointer("pointermove", 600 + i * 10, 600 + (i % 2) * 15);
  await pointer("pointerup", 700, 600);
  await waitSave();
  const saved = savedBoard();
  expect(saved.elements.find(e => e.id === "r1")).toMatchObject({ width: 140, height: 70 });
  const path = saved.elements.find(e => e.type === "path");
  expect(path?.type === "path" && path.points.length >= 2).toBe(true);
  expect(path).toMatchObject({ x: 600, y: 600 });
});

test("frames: drawing one adopts what is inside; moving it moves its children; the list focuses and offers PNG", async () => {
  await render();
  await key("f");
  await drag([50, 50], [450, 300]);
  await waitSave();
  let saved = savedBoard();
  const frame = saved.elements.find(e => e.type === "frame");
  expect(frame).toMatchObject({ type: "frame", title: `1 · ${t("design_ui.board.frame_default")}` });
  expect(saved.elements.filter(e => e.frameId === frame?.id).map(e => e.id).sort()).toEqual(["r1", "r2"]);
  // Drag the frame by its title label (above the frame): children follow.
  await drag([60, 45], [160, 145]);
  await waitSave();
  saved = savedBoard();
  expect(saved.elements.find(e => e.id === "r1")).toMatchObject({ x: 200, y: 200 });
  const list = container.querySelector(`aside ul[aria-label="${t("design_ui.board.frames_label")}"]`);
  expect(list?.textContent).toContain(`1 · ${t("design_ui.board.frame_default")}`);
  expect(list?.querySelector(`[aria-label="${t("design_ui.board.frame_download_named", { title: `1 · ${t("design_ui.board.frame_default")}` })}"]`)).not.toBeNull();
});

test("an outside change to board.json reloads and keeps the local selection", async () => {
  const props = await render({ reloadKey: 1 });
  await pointer("pointerdown", 120, 120);
  await pointer("pointerup", 120, 120);
  const external = model.addElements(startBoard(), [model.makeElement({ type: "image", src: "assets/ilustracion.svg" }, { x: 600, y: 100, width: 200, height: 200 }, "agent-img")]);
  files.set("board.json", boardText(external));
  files.set("assets/ilustracion.svg", new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'], { type: "image/svg+xml" }));
  await act(async () => root.render(<BoardEditor {...props} reloadKey={2} />));
  await flush();
  expect(canvas().querySelector('[data-selection="r1"]')).not.toBeNull();
  // The agent's SVG is loaded from the design folder as a blob URL, never by path.
  const image = canvas().querySelector('[data-element-id="agent-img"] image');
  expect(image?.getAttribute("href")?.startsWith("blob:")).toBe(true);
  // Our own save coming back is not treated as an outside change.
  const writesBefore = writes.length;
  await act(async () => root.render(<BoardEditor {...props} reloadKey={3} />));
  await flush();
  expect(writes.length).toBe(writesBefore);
});

test("style panel changes the fill of the selection", async () => {
  await render();
  await pointer("pointerdown", 120, 120);
  await pointer("pointerup", 120, 120);
  const swatch = container.querySelector(`[aria-label="${t("design_ui.board.style.color", { color: "#d64545" })}"]`);
  if (!(swatch instanceof HTMLElement)) throw new Error("no swatch");
  await act(async () => swatch.click());
  await waitSave();
  expect(savedBoard().elements.find(e => e.id === "r1")?.style.fill).toBe("#d64545");
});

test("text: clicking with T opens the editor and the typed text is saved", async () => {
  await render();
  await key("t");
  await pointer("pointerdown", 600, 500);
  await pointer("pointerup", 600, 500);
  const editor = container.querySelector("textarea");
  if (!(editor instanceof HTMLTextAreaElement)) throw new Error("no text editor");
  editor.value = "Hallazgos del relevamiento";
  await act(async () => editor.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  await act(async () => editor.dispatchEvent(new FocusEvent("blur")));
  await waitSave();
  expect(savedBoard().elements.find(e => e.type === "text")).toMatchObject({ text: "Hallazgos del relevamiento", x: 600, y: 500 });
});

test("ask the agent with the selection as context", async () => {
  await render();
  await pointer("pointerdown", 120, 120);
  await pointer("pointerup", 120, 120);
  const input = container.querySelector(`input[aria-label="${t("design_ui.board.ask_label")}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error("no input");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, "agrega una ilustración SVG en el marco 2");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => input.form?.requestSubmit());
  expect(asks[0]?.text).toBe("agrega una ilustración SVG en el marco 2");
  expect(asks[0]?.context).toContain("proyecto/diseno/pizarra-1/board.json");
  expect(asks[0]?.context).toContain("rect r1");
});

test("read-only boards offer only select and hand, and never save", async () => {
  await render({ writable: false });
  expect([...container.querySelectorAll("[data-tool]")].map(b => b.getAttribute("data-tool"))).toEqual(["select", "hand"]);
  await key("r");
  await drag([120, 120], [300, 300]);
  await key("Delete");
  await waitSave();
  expect(writes).toHaveLength(0);
});

test("ctrl+wheel zooms and the zoom buttons update the percentage", async () => {
  await render();
  const percent = () => container.querySelector(`[aria-label="${t("design_ui.board.zoom_reset")}"]`)?.textContent;
  const before = percent();
  await act(async () => {
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100 });
    // happy-dom's WheelEvent ignores modifier and position fields in its init.
    Object.defineProperties(wheel, { ctrlKey: { value: true }, clientX: { value: 100 }, clientY: { value: 100 } });
    canvas().dispatchEvent(wheel);
  });
  expect(percent()).not.toBe(before);
  const zoomOut = container.querySelector(`[aria-label="${t("design_ui.board.zoom_out")}"]`);
  if (!(zoomOut instanceof HTMLElement)) throw new Error("no zoom out");
  const current = percent();
  await act(async () => zoomOut.click());
  expect(percent()).not.toBe(current);
});

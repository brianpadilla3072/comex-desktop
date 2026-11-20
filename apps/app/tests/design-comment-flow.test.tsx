/** @jsxImportSource react */
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const ownsDom = !GlobalRegistrator.isRegistered;
if (ownsDom) GlobalRegistrator.register({ url: "http://localhost/" });
const { act, useEffect, useRef } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useDesignPicker } = await import("../src/react-app/domains/design/design-picker");
const { DesignCommentBar } = await import("../src/react-app/domains/design/design-comment-bar");
import type { DesignPickerClient, DesignPickerController, DesignPickerDesign } from "../src/react-app/domains/design/design-picker";

const PAGE_FILE = "pages/p-1.html";
const PAGE = { id: "p-1", title: "Portada", file: PAGE_FILE };
const DESIGN: DesignPickerDesign = { id: "d-1", title: "Informe trimestral", kind: "slides" };
const SOURCE = `<!DOCTYPE html>
<html lang="es">
<body>
  <main>
    <h1 id="titulo">Resultados del trimestre</h1>
    <p>Ventas en alza</p>
    <ul><li>Uno</li><li>Dos</li></ul>
  </main>
</body>
</html>
`;

const files = new Map<string, string>();
const writes: Array<{ path: string; body: string }> = [];
const asks: Array<{ text: string; context?: string }> = [];
const client: DesignPickerClient = {
  readDesignFile: async (_ws, _id, path) => new Blob([files.get(path) ?? ""], { type: "text/html" }),
  writeDesignFile: async (_ws, _id, path, body) => {
    const text = typeof body === "string" ? body : await body.text();
    files.set(path, text);
    writes.push({ path, body: text });
    return { ok: true };
  },
};

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let picker: DesignPickerController | null = null;
let changes = 0;

function Harness({ writable }: { writable: boolean }) {
  const controller = useDesignPicker({
    workspaceId: "ws_fixture",
    design: DESIGN,
    client,
    writable,
    onAskAgent: (text, context) => { asks.push({ text, context }); },
    onChanged: () => { changes += 1; },
  });
  picker = controller;
  const frameRef = useRef<HTMLIFrameElement>(null);
  const bind = controller.bindFrame(PAGE);
  // Stands in for DesignFrame: a sandboxed, script-less, same-origin srcdoc frame.
  useEffect(() => { if (frameRef.current) bind(frameRef.current); }, [bind]);
  return (
    <div>
      <DesignCommentBar picker={controller} />
      <iframe ref={frameRef} title="page" sandbox="allow-same-origin" srcDoc={SOURCE} />
    </div>
  );
}

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  files.clear(); writes.length = 0; asks.length = 0; changes = 0; picker = null;
  files.set(PAGE_FILE, SOURCE);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
afterAll(async () => { if (ownsDom) await GlobalRegistrator.unregister(); });

async function flush(ms = 30) { await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); }); }
async function render(writable = true) {
  await act(async () => root.render(<Harness writable={writable} />));
  await flush(80);
}
function controller(): DesignPickerController {
  if (!picker) throw new Error("picker not mounted");
  return picker;
}
function frameDocument(): Document {
  const frame = host.querySelector("iframe");
  const doc = frame?.contentDocument;
  if (!doc) throw new Error("frame not loaded");
  return doc;
}
function inFrame(selector: string): HTMLElement {
  const found = frameDocument().querySelector(selector);
  if (!(found instanceof HTMLElement)) throw new Error(`Missing ${selector}`);
  return found;
}
function inPage<T extends Element>(selector: string, type: new () => T): T {
  const found = document.querySelector(selector);
  if (!(found instanceof type)) throw new Error(`Missing ${selector}`);
  return found;
}
async function fire(target: EventTarget, event: Event) { await act(async () => { target.dispatchEvent(event); }); }
async function setMode(mode: "view" | "comment" | "edit") { await act(async () => controller().setMode(mode)); }
async function type(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  await act(async () => { setter?.call(textarea, value); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function point(selector: string) {
  await fire(inFrame(selector), new MouseEvent("mouseover", { bubbles: true }));
  await fire(inFrame(selector), new MouseEvent("click", { bubbles: true, cancelable: true }));
}

test("Comentar outlines on hover, selects on click and sends the comment with what was pointed at", async () => {
  await render();
  await setMode("comment");
  const heading = inFrame("h1");
  await fire(heading, new MouseEvent("mouseover", { bubbles: true }));
  expect(heading.style.getPropertyValue("outline-style")).toBe("dashed");
  await fire(heading, new MouseEvent("click", { bubbles: true, cancelable: true }));
  expect(heading.style.getPropertyValue("outline-style")).toBe("solid");
  expect(controller().draft?.target).toMatchObject({ selector: "#titulo", tag: "h1", text: "Resultados del trimestre" });

  const input = inPage("[data-design-comment-input]", HTMLTextAreaElement);
  await type(input, "Hazlo más corto");
  await fire(inPage("[data-design-comment-send]", HTMLButtonElement), new MouseEvent("click", { bubbles: true }));
  await flush();

  expect(asks).toHaveLength(1);
  expect(asks[0]?.text).toBe("Hazlo más corto");
  const context = asks[0]?.context ?? "";
  expect(context).toContain("\"Informe trimestral\" (slides, folder proyecto/diseno/d-1/)");
  expect(context).toContain("Page \"Portada\" (id p-1, file pages/p-1.html)");
  expect(context).toContain("selector: #titulo");
  expect(context).toContain("element: <h1>, visible text: \"Resultados del trimestre\"");
  expect(context).toMatch(/box: x=[\d.]+ y=[\d.]+ width=[\d.]+ height=[\d.]+/);
  expect(controller().draft).toBeNull();
  // The outline is the picker's own inline style and is gone once the comment is sent.
  expect(heading.getAttribute("style")).toBeNull();
});

test("several comments are queued and sent together; Esc cancels the open one", async () => {
  await render();
  await setMode("comment");
  await point("p");
  await type(inPage("[data-design-comment-input]", HTMLTextAreaElement), "Cambia el verbo");
  await fire(inPage("[data-design-comment-queue]", HTMLButtonElement), new MouseEvent("click", { bubbles: true }));
  expect(controller().pending).toHaveLength(1);
  expect(asks).toHaveLength(0);

  await point("ul > li:nth-of-type(2)");
  expect(controller().draft?.target.selector).toBe("body > main > ul > li:nth-of-type(2)");
  await fire(frameDocument(), new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(controller().draft).toBeNull();
  expect(controller().mode).toBe("comment");

  await point("ul > li:nth-of-type(1)");
  await type(inPage("[data-design-comment-input]", HTMLTextAreaElement), "Usa un número");
  await fire(inPage("[data-design-comment-send]", HTMLButtonElement), new MouseEvent("click", { bubbles: true }));
  await flush();

  expect(asks).toHaveLength(1);
  expect(asks[0]?.text).toBe("1. Cambia el verbo\n2. Usa un número");
  expect(asks[0]?.context).toContain("[1] Page \"Portada\"");
  expect(asks[0]?.context).toContain("selector: body > main > p");
  expect(asks[0]?.context).toContain("[2] Page \"Portada\"");
  expect(asks[0]?.context).toContain("selector: body > main > ul > li:nth-of-type(1)");
  expect(controller().pending).toHaveLength(0);

  // A second Esc with nothing open leaves Comentar.
  await fire(frameDocument(), new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(controller().mode).toBe("view");
});

test("Editar saves the new text into the page file, escaped, and undo restores it", async () => {
  await render();
  await setMode("edit");
  const heading = inFrame("h1");
  await fire(heading, new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
  expect(heading.getAttribute("contenteditable")).not.toBeNull();
  heading.textContent = "Resultados <script>alert(1)</script> & cierre";
  await fire(heading, new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await flush();

  expect(writes).toHaveLength(1);
  expect(writes[0]?.path).toBe(PAGE_FILE);
  expect(writes[0]?.body).toBe(SOURCE.replace("Resultados del trimestre", "Resultados &lt;script&gt;alert(1)&lt;/script&gt; &amp; cierre"));
  expect(writes[0]?.body).not.toContain("contenteditable");
  expect(writes[0]?.body).not.toContain("outline");
  expect(heading.getAttribute("contenteditable")).toBeNull();
  expect(changes).toBe(1);
  expect(controller().notice).toBe("saved");
  expect(controller().canUndo).toBe(true);

  await fire(inPage("[data-design-undo]", HTMLButtonElement), new MouseEvent("click", { bubbles: true }));
  await flush();
  expect(writes).toHaveLength(2);
  expect(writes[1]?.body).toBe(SOURCE);
  expect(controller().canUndo).toBe(false);
  expect(controller().notice).toBe("undone");
});

test("Esc while editing restores the text without saving; elements with markup inside are not editable", async () => {
  await render();
  await setMode("edit");
  const paragraph = inFrame("p");
  await fire(paragraph, new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
  paragraph.textContent = "Otra cosa";
  await fire(paragraph, new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  await flush();
  expect(paragraph.textContent).toBe("Ventas en alza");
  expect(writes).toHaveLength(0);

  await fire(inFrame("ul"), new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
  expect(inFrame("ul").getAttribute("contenteditable")).toBeNull();
  expect(controller().notice).toBe("error_not_text");
});

test("undo refuses to overwrite a page that changed after the edit", async () => {
  await render();
  await setMode("edit");
  const heading = inFrame("h1");
  await fire(heading, new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
  heading.textContent = "Nuevo título";
  await fire(heading, new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await flush();
  files.set(PAGE_FILE, "<!DOCTYPE html><html><body><h1>El agente lo cambió</h1></body></html>");
  await act(async () => { await controller().undo(); });
  expect(writes).toHaveLength(1);
  expect(controller().notice).toBe("error_undo_changed");
});

test("read-only designs keep Editar visible but locked", async () => {
  await render(false);
  const edit = inPage("[data-design-mode=edit]", HTMLButtonElement);
  expect(edit.disabled || edit.getAttribute("aria-disabled") === "true" || edit.hasAttribute("data-disabled")).toBe(true);
  await setMode("edit");
  expect(controller().mode).toBe("view");
});

/** @jsxImportSource react */
import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const ownsDom = !GlobalRegistrator.isRegistered;
if (ownsDom) GlobalRegistrator.register({ url: "http://localhost/" });

// The viewer belongs to the base (A); a light fake keeps these tests about the editor.
const frames: Array<{ pageId: string; scale: number | undefined; interactive: boolean | undefined; reloadKey: string | number | undefined }> = [];
mock.module("../src/react-app/domains/design/design-frame", () => ({
  DesignFrame: (props: { page: { id: string }; scale?: number; interactive?: boolean; reloadKey?: string | number }) => {
    frames.push({ pageId: props.page.id, scale: props.scale, interactive: props.interactive, reloadKey: props.reloadKey });
    return <div data-fake-frame={props.page.id} />;
  },
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { setLocale, currentLocale } = await import("../src/i18n");
const { ConfirmDialogHost } = await import("../src/components/ui/confirm-dialog");
const { SlidesEditor } = await import("../src/react-app/domains/design/editors/slides-editor");
const { designManifestSchema } = await import("@openwork/types/designs");
type DesignManifest = import("@openwork/types/designs").DesignManifest;
type SlidesClient = import("../src/react-app/domains/design/editors/slides-model").SlidesClient;

const page = (id: string, title: string, notes?: string) => ({ id, title, file: `pages/${id}.html`, width: 1920, height: 1080, ...(notes ? { notes } : {}) });
let design: DesignManifest;
let files: Record<string, string>;
let calls: Array<[string, ...unknown[]]>;
let asked: Array<[string, string | undefined]>;
let changedCount: number;
let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement;
let previousLocale: ReturnType<typeof currentLocale>;

function fakeClient(): SlidesClient {
  return {
    readDesignFile: async (_ws, _id, path) => { calls.push(["read", path]); return new Blob([path === "design.json" ? JSON.stringify(design) : files[path] ?? ""]); },
    writeDesignFile: async (_ws, _id, path, body) => {
      const text = typeof body === "string" ? body : await body.text();
      calls.push(["write", path, text]);
      files[path] = text;
      if (path === "design.json") design = designManifestSchema.parse(JSON.parse(text));
      return { ok: true, design };
    },
    addDesignPage: async (_ws, _id, input) => {
      calls.push(["add", input]);
      const added = page(`p-${design.pages.length + 1}`, input.title ?? "");
      const index = input.afterPageId ? design.pages.findIndex(item => item.id === input.afterPageId) + 1 : design.pages.length;
      const pages = [...design.pages];
      pages.splice(index, 0, added);
      design = { ...design, pages };
      files[added.file] = input.html ?? "";
      // Like the real client: the updated manifest itself, not `{ design }`.
      return design;
    },
    reorderDesignPages: async (_ws, _id, pageIds) => { calls.push(["reorder", pageIds]); return { ok: true }; },
    deleteDesignPage: async (_ws, _id, pageId) => { calls.push(["delete", pageId]); design = { ...design, pages: design.pages.filter(item => item.id !== pageId) }; return { ok: true }; },
  };
}

async function settle(rounds = 8) {
  for (let index = 0; index < rounds; index += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

const client = { current: fakeClient() };
async function render(writable = true) {
  await act(async () => {
    root?.render(<>
      <SlidesEditor workspaceId="ws_1" design={design} writable={writable} client={client.current} chatOpen={false}
        onChanged={() => { changedCount += 1; }} onAskAgent={(text, context) => { asked.push([text, context]); }} />
      <ConfirmDialogHost />
    </>);
  });
  await settle();
}
/** The page shell re-reads the design after onChanged; tests do the same by re-rendering. */
const rerender = () => render();

function find(selector: string): HTMLElement {
  const element = document.body.querySelector(selector);
  if (!(element instanceof HTMLElement)) throw new Error(`missing ${selector}`);
  return element;
}
async function waitFor(selector: string) {
  for (let attempt = 0; attempt < 40 && !document.body.querySelector(selector); attempt += 1) await settle(1);
  return find(selector);
}
async function click(selector: string) {
  const element = await waitFor(selector);
  await act(async () => { element.click(); });
  await settle();
}
async function key(element: HTMLElement, keyName: string, init: KeyboardEventInit = {}) {
  await act(async () => { element.dispatchEvent(new KeyboardEvent("keydown", { key: keyName, bubbles: true, cancelable: true, ...init })); });
  await settle();
}
const thumbs = () => [...document.body.querySelectorAll("[data-slides-thumb]")].map(item => item.getAttribute("data-slides-thumb"));
const thumbButton = (id: string) => find(`[data-slides-thumb="${id}"] button[aria-label]`);

beforeEach(async () => {
  previousLocale = currentLocale();
  setLocale("es");
  design = designManifestSchema.parse({ format: "openwork.design", version: 1, id: "deck", kind: "slides", title: "Deck", createdAt: 1, updatedAt: 2,
    pages: [page("a", "Portada", "Saludo"), page("b", "Cifras"), page("c", "Cierre")] });
  files = { "pages/a.html": "<html><body><h1>A</h1></body></html>", "pages/b.html": "<html><body><h1>B</h1></body></html>", "pages/c.html": "<html><body></body></html>" };
  calls = []; asked = []; changedCount = 0; frames.length = 0;
  client.current = fakeClient();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host.remove();
  setLocale(previousLocale);
});

afterAll(async () => { if (ownsDom) await GlobalRegistrator.unregister(); });

test("lists every slide as a scaled, non-interactive thumbnail and shows the first one", async () => {
  await render();
  expect(thumbs()).toEqual(["a", "b", "c"]);
  expect(find("nav").textContent).toContain("3 diapositivas");
  const thumbFrames = frames.filter(frame => frame.interactive === false);
  expect(thumbFrames.length).toBeGreaterThanOrEqual(3);
  expect(thumbFrames[0]?.scale).toBeCloseTo(168 / 1920);
  expect(frames.some(frame => frame.interactive === true && frame.pageId === "a")).toBe(true);
  expect(thumbButton("a").getAttribute("aria-current")).toBe("true");
  expect((find("[data-slides-notes]") as HTMLTextAreaElement).value).toBe("Saludo");
});

test("keyboard: arrows move the selection, Alt+arrows reorder through the server", async () => {
  await render();
  await key(thumbButton("a"), "ArrowDown");
  expect(thumbButton("b").getAttribute("aria-current")).toBe("true");
  await key(thumbButton("b"), "ArrowDown", { altKey: true });
  expect(calls.find(call => call[0] === "reorder")).toEqual(["reorder", ["a", "c", "b"]]);
  expect(thumbs()).toEqual(["a", "c", "b"]);
  expect(changedCount).toBe(1);
});

test("a failed reorder puts the slides back", async () => {
  client.current = { ...fakeClient(), reorderDesignPages: async () => { throw new Error("offline"); } };
  await render();
  await key(thumbButton("a"), "ArrowDown", { altKey: true });
  expect(thumbs()).toEqual(["a", "b", "c"]);
});

test("drag and drop reorders", async () => {
  await render();
  const source = find('[data-slides-thumb="c"]');
  const target = find('[data-slides-thumb="a"]');
  const transfer = { effectAllowed: "", dropEffect: "", setData: () => {}, getData: () => "c" };
  const drag = (element: HTMLElement, type: string, clientY = 0) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { dataTransfer: transfer, clientY });
    element.dispatchEvent(event);
  };
  await act(async () => { drag(source, "dragstart"); });
  await act(async () => { drag(target, "dragover", -10); });
  await act(async () => { drag(target, "drop", -10); });
  await settle();
  expect(calls.find(call => call[0] === "reorder")).toEqual(["reorder", ["c", "a", "b"]]);
});

test("Delete asks first, then removes the slide and selects the next one", async () => {
  await render();
  await key(thumbButton("b"), "Delete");
  await waitFor("[data-slot='alert-dialog-action']");
  expect(document.body.textContent).toContain("¿Eliminar la diapositiva «Cifras»?");
  await click("[data-slot='alert-dialog-action']");
  expect(calls.find(call => call[0] === "delete")).toEqual(["delete", "b"]);
  await rerender();
  expect(thumbs()).toEqual(["a", "c"]);
  expect(thumbButton("c").getAttribute("aria-current")).toBe("true");
});

test("cancelling the confirmation keeps the slide", async () => {
  await render();
  await key(thumbButton("b"), "Delete");
  await click("[data-slot='alert-dialog-cancel']");
  expect(calls.some(call => call[0] === "delete")).toBe(false);
});

test("add from a template, ask the agent, and insert a table into the selected slide", async () => {
  await render();
  await click("[data-slides-add]");
  await click('[data-slides-template="title"]');
  const add = calls.find(call => call[0] === "add");
  expect(add?.[1]).toMatchObject({ title: "Título", afterPageId: "a" });
  expect(String((add?.[1] as { html: string }).html)).toContain("Título de la diapositiva");
  await rerender();
  expect(thumbs()).toEqual(["a", "p-4", "b", "c"]);
  expect(thumbButton("p-4").getAttribute("aria-current")).toBe("true");

  await click("[data-slides-add]");
  await click("[data-slides-ask-agent]");
  expect(asked[0]?.[0]).toBe("Añade una diapositiva nueva después de la diapositiva 2 (Título).");
  expect(JSON.parse(asked[0]?.[1] ?? "{}")).toMatchObject({ designId: "deck", insertAfter: { id: "p-4", position: 2 } });

  await click('[data-slides-insert="table"]');
  const write = calls.find(call => call[0] === "write" && call[1] === "pages/p-4.html");
  expect(String(write?.[2])).toContain('data-ow-element="table"');
  expect(String(write?.[2]).indexOf('data-ow-element="table"')).toBeLessThan(String(write?.[2]).lastIndexOf("</body>"));
});

test("speaker notes are written into design.json after a pause", async () => {
  await render();
  const notes = find("[data-slides-notes]");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(notes, "Mencionar el plazo");
    notes.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { notes.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
  await settle();
  const write = calls.find(call => call[0] === "write" && call[1] === "design.json");
  const saved = designManifestSchema.parse(JSON.parse(String(write?.[2])));
  expect(saved.pages[0]?.notes).toBe("Mencionar el plazo");
  expect(saved.pages[1]?.notes).toBeUndefined();
  expect(find("[data-slides-notes-state]").textContent).toBe("Guardado");
});

test("read-only designs keep the tools visible but disabled", async () => {
  await render(false);
  expect((find('[data-slides-insert="text"]') as HTMLButtonElement).disabled).toBe(true);
  expect((find("[data-slides-add]") as HTMLButtonElement).disabled).toBe(true);
  expect(document.body.querySelector("[data-slides-actions]")).toBeNull();
  expect((find("[data-slides-notes]") as HTMLTextAreaElement).readOnly).toBe(true);
});

test("presentation: starts at the selected slide, arrows and space move, Esc exits", async () => {
  await render();
  await click('[data-slides-thumb="b"] button[aria-label]');
  await click("[data-slides-present]");
  const presenter = await waitFor("[data-slides-presenter]");
  expect(find("[data-slides-counter]").textContent).toBe("2 / 3");
  await key(presenter, "ArrowRight");
  expect(find("[data-slides-counter]").textContent).toBe("3 / 3");
  await key(presenter, "ArrowRight");
  expect(find("[data-slides-counter]").textContent).toBe("3 / 3");
  await key(presenter, "Home");
  await key(presenter, " ");
  expect(find("[data-slides-counter]").textContent).toBe("2 / 3");
  await key(presenter, "ArrowLeft");
  expect(find("[data-slides-counter]").textContent).toBe("1 / 3");
  await key(presenter, "Escape");
  expect(document.body.querySelector("[data-slides-presenter]")).toBeNull();
  expect(thumbButton("a").getAttribute("aria-current")).toBe("true");
});

/** @jsxImportSource react */
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const ownsDom = !GlobalRegistrator.isRegistered;
// Parsed pages never load their own stylesheets (the frame model inlines them); keep that quiet.
if (ownsDom) GlobalRegistrator.register({ url: "http://localhost/", settings: { handleDisabledFileLoadingAsSuccess: true } });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { MemoryRouter } = await import("react-router");
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const { t } = await import("../src/i18n");
const { OpenworkServerError } = await import("../src/app/lib/openwork-server");
const { DESIGN_KINDS } = await import("../src/app/lib/designs");
const { DesignGalleryPanel } = await import("../src/react-app/domains/design/design-gallery");
const { DesignPagePanel } = await import("../src/react-app/domains/design/design-page");
const { PlaceholderEditor } = await import("../src/react-app/domains/design/editors/placeholder-editor");
// The registry now holds the real editors; this test covers the page shell with the simple one.
const placeholderEditors = { slides: PlaceholderEditor, mockup: PlaceholderEditor, system: PlaceholderEditor, board: PlaceholderEditor };
const { DesignFrame } = await import("../src/react-app/domains/design/design-frame");
const { buildFrameDocument, DESIGN_FRAME_CSP, fitScale } = await import("../src/react-app/domains/design/design-frame-model");
const { visibleDesigns, designProjectOptions } = await import("../src/react-app/domains/design/design-gallery-model");
const { designAskMessage } = await import("../src/react-app/domains/design/design-chat-panel");
const { DESIGN_EDITORS } = await import("../src/react-app/domains/design/editors");
type DesignClient = import("../src/react-app/domains/design/design-client").DesignClient;
type DesignManifest = import("../src/app/lib/designs").DesignManifest;
type DesignSummary = import("../src/app/lib/designs").DesignSummary;
type DesignChatHost = import("../src/react-app/domains/design/design-chat-panel").DesignChatHost;
type DesignEditorProps = import("../src/react-app/domains/design/editors").DesignEditorProps;

const NOW = Date.UTC(2026, 10, 20, 12);

const summary = (id: string, overrides: Partial<DesignSummary> = {}): DesignSummary => ({
  workspaceId: "ws_1", projectName: "Lanzamiento", id, kind: "slides", title: id, pages: 1, updatedAt: NOW - 60_000, createdAt: NOW - 86_400_000, hasThumbnail: false, ...overrides,
});
const manifest = (overrides: Partial<DesignManifest> = {}): DesignManifest => ({
  format: "openwork.design", version: 1, id: "plan", kind: "slides", title: "Plan de lanzamiento", createdAt: 1, updatedAt: 2,
  pages: [{ id: "p-1", title: "Portada", file: "pages/p-1.html", width: 1920, height: 1080 }, { id: "p-2", title: "Agenda", file: "pages/p-2.html", width: 1920, height: 1080 }],
  systemId: null, thumbnail: null, ...overrides,
});

type Calls = Record<string, unknown[][]>;
let calls: Calls;
let state: { list: { designs: DesignSummary[]; writable: boolean } | Error; design: DesignManifest; writable: boolean; chats: string[]; files: Record<string, string> };
const record = (name: string, ...args: unknown[]) => { (calls[name] ??= []).push(args); };

function fakeClient(): DesignClient {
  return {
    baseUrl: "http://127.0.0.1:1",
    listDesigns: async () => { if (state.list instanceof Error) throw state.list; return state.list; },
    createDesign: async input => { record("createDesign", input); return manifest({ id: "nuevo", kind: input.kind, title: input.title }); },
    getDesign: async () => ({ design: state.design, writable: state.writable, revision: 5 }),
    updateDesign: async (workspaceId, designId, patch) => { record("updateDesign", workspaceId, designId, patch); state.design = { ...state.design, ...(patch.title ? { title: patch.title } : {}) }; return state.design; },
    deleteDesign: async () => undefined,
    readDesignFile: async (_workspaceId, _designId, path) => {
      record("readDesignFile", path);
      const text = state.files[path];
      if (text === undefined) throw new OpenworkServerError(404, "design_file_not_found", "missing");
      return new Blob([text], { type: path.endsWith(".svg") ? "image/svg+xml" : path.endsWith(".css") ? "text/css" : "text/html" });
    },
    writeDesignFile: async () => state.design,
    addDesignPage: async (workspaceId, designId, input) => { record("addDesignPage", workspaceId, designId, input); return state.design; },
    updateDesignPage: async () => state.design,
    reorderDesignPages: async () => state.design,
    deleteDesignPage: async () => state.design,
    putDesignThumbnail: async () => state.design,
    exportDesignHtml: async (workspaceId, designId) => { record("exportDesignHtml", workspaceId, designId); return new Blob(["PK"], { type: "application/zip" }); },
    listDesignChats: async () => state.chats,
    bindDesignChat: async (workspaceId, designId, sessionId) => { record("bindDesignChat", workspaceId, designId, sessionId); state.chats = [sessionId, ...state.chats]; return state.chats; },
  };
}

function fakeChat(): DesignChatHost {
  return {
    renderSession: sessionId => <div data-test-session={sessionId} />,
    startChat: async prompt => { record("startChat", prompt); return "ses_new"; },
    sendMessage: async (sessionId, text) => { record("sendMessage", sessionId, text); },
    onSessionChange: sessionId => record("onSessionChange", sessionId),
  };
}

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement;
let queryClient: InstanceType<typeof QueryClient>;

async function settle(rounds = 8) {
  for (let index = 0; index < rounds; index += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
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
async function type(selector: string, value: string) {
  const element = await waitFor(selector);
  await act(async () => {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle(2);
}
async function render(node: import("react").ReactNode) {
  await act(async () => {
    root?.render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={["/design"]}>{node}</MemoryRouter></QueryClientProvider>);
  });
  await settle();
}

beforeEach(() => {
  calls = {};
  state = {
    list: { designs: [summary("plan", { title: "Plan de lanzamiento" }), summary("marca", { kind: "system", title: "Marca", workspaceId: "ws_2", projectName: "Identidad", updatedAt: NOW - 3 * 86_400_000 })], writable: true },
    design: manifest(), writable: true, chats: [],
    files: {
      "pages/p-1.html": "<!doctype html><html><head><link rel=\"stylesheet\" href=\"../styles.css\"></head><body><h1>Portada</h1><img src=\"../assets/logo.svg\"></body></html>",
      "pages/p-2.html": "<!doctype html><html><body><p>Agenda</p></body></html>",
      "styles.css": "h1 { color: red; }",
      "assets/logo.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\"/>",
    },
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

// ---- Frame: asset rewriting ----

test("frame document: relative assets become blob/data URLs, the rest is dropped, the body keeps its structure", async () => {
  const files: Record<string, Blob> = {
    "styles.css": new Blob(["@import url(https://cdn.example/x.css);\nbody { background: url('assets/fondo.png'); }\n@font-face { src: url(\"assets/marca.woff2\"); }"], { type: "text/css" }),
    "assets/fondo.png": new Blob([new Uint8Array([1, 2])], { type: "image/png" }),
    "assets/marca.woff2": new Blob([new Uint8Array([7, 7, 7])], { type: "font/woff2" }),
    "assets/logo.svg": new Blob(["<svg/>"], { type: "image/svg+xml" }),
  };
  const read = async (path: string) => { const blob = files[path]; if (!blob) throw new Error(`missing ${path}`); return blob; };
  let counter = 0;
  const html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src *"><base href="https://example.com/"><link rel="stylesheet" href="../styles.css"><link rel="preconnect" href="https://cdn.example"></head>
<body><h1 onclick="steal()">Hola</h1><img src="../assets/logo.svg" srcset="../assets/logo.svg 1x, https://cdn.example/big.png 2x"><img src="https://cdn.example/remote.png"><div style="background-image: url(../assets/fondo.png)"></div><a href="https://example.com">Enlace</a><script>alert(1)</script><img src="../../fuera.png"></body></html>`;
  const built = await buildFrameDocument(html, "pages/p-1.html", read, () => `blob:test/${++counter}`);
  const doc = new DOMParser().parseFromString(built.html, "text/html");
  const metas = [...doc.head.querySelectorAll("meta[http-equiv]")];
  expect(metas.length).toBe(1);
  expect(doc.head.firstElementChild?.getAttribute("content")).toBe(DESIGN_FRAME_CSP);
  expect(doc.querySelector("base")).toBe(null);
  expect(doc.querySelector("link")).toBe(null);
  const css = doc.querySelector("style")?.textContent ?? "";
  expect(css).not.toContain("@import");
  expect(css).toContain("url(\"blob:test/");
  expect(css).toContain("url(\"data:font/woff2;base64,BwcH\")");
  const images = [...doc.querySelectorAll("img")];
  expect(images[0]?.getAttribute("src")).toMatch(/^blob:test\//);
  expect(images[0]?.getAttribute("srcset")).toMatch(/^blob:test\/\d+ 1x$/);
  expect(images[1]?.hasAttribute("src")).toBe(false);
  expect(images[2]?.hasAttribute("src")).toBe(false);
  expect(doc.querySelector("div")?.getAttribute("style")).toMatch(/url\("blob:test\//);
  expect(doc.querySelector("h1")?.hasAttribute("onclick")).toBe(false);
  expect(doc.querySelector("a")?.hasAttribute("href")).toBe(false);
  // Same children in the same order as the source body (the comment picker matches selectors).
  expect([...doc.body.children].map(element => element.tagName.toLowerCase())).toEqual(["h1", "img", "img", "div", "a", "script", "img"]);
  // One blob per file, reused.
  expect(new Set(built.urls).size).toBe(built.urls.length);
  expect(fitScale({ width: 960, height: 1000 }, { width: 1920, height: 1080 })).toBe(0.5);
  expect(fitScale({ width: 0, height: 10 }, { width: 1, height: 1 })).toBe(0);
});

test("DesignFrame renders the page in a scriptless sandbox and reloads on reloadKey", async () => {
  const client = fakeClient();
  const page = manifest().pages[0];
  if (!page) throw new Error("no page");
  const ready: HTMLIFrameElement[] = [];
  const view = (reloadKey: number) => <div style={{ width: 960, height: 540 }}><DesignFrame client={client} workspaceId="ws_1" designId="plan" page={page} scale={0.5} reloadKey={reloadKey} onFrameReady={frame => ready.push(frame)} /></div>;
  await render(view(1));
  const frame = await waitFor("[data-design-frame-iframe]");
  expect(frame.getAttribute("sandbox")).toBe("allow-same-origin");
  const doc = frame.getAttribute("srcdoc") ?? "";
  expect(doc).toContain(DESIGN_FRAME_CSP);
  expect(doc).toContain("h1 { color: red; }");
  expect(doc).toContain("<h1>Portada</h1>");
  expect(frame.style.transform).toBe("scale(0.5)");
  const reads = calls.readDesignFile?.length ?? 0;
  await render(view(2));
  await settle();
  expect((calls.readDesignFile?.length ?? 0)).toBeGreaterThan(reads);
});

// ---- Gallery ----

test("gallery: tiles, cards with kind and relative date, search, project filter and list view", async () => {
  await render(<DesignGalleryPanel client={fakeClient()} currentWorkspaceId="ws_1" projects={[{ workspaceId: "ws_1", name: "Lanzamiento" }]} onOpenDesign={(ws, id) => record("open", ws, id)} now={NOW} />);
  await waitFor("[data-design-grid]");
  expect(DESIGN_KINDS.map(kind => find(`[data-design-create='${kind}']`).textContent)).toEqual([t("design_ui.studio.kind_slides"), t("design_ui.studio.kind_mockup"), t("design_ui.studio.kind_system"), t("design_ui.studio.kind_board")]);
  expect(find("[data-design-card='plan']").textContent).toContain(t("design_ui.studio.time_minutes", { count: 1 }));
  expect(find("[data-design-card='marca']").textContent).toContain(t("design_ui.studio.kind_system"));
  expect(find("[data-design-card='plan'] [data-design-thumbnail]").getAttribute("data-design-thumbnail")).toBe("placeholder");

  await type("[data-design-search]", "marca");
  expect(document.body.querySelector("[data-design-card='plan']")).toBe(null);
  expect(find("[data-design-card='marca']")).toBeTruthy();
  await type("[data-design-search]", "");
  await click("[data-design-scope='project']");
  expect(document.body.querySelector("[data-design-card='marca']")).toBe(null);
  await click("[data-design-view='list']");
  expect(find("[data-design-row='plan']").textContent).toContain("Lanzamiento");
  await click("[data-design-row='plan'] [data-design-open]");
  expect(calls.open).toEqual([["ws_1", "plan"]]);
});

test("gallery: creating asks for project and title, then opens the new design", async () => {
  await render(<DesignGalleryPanel client={fakeClient()} currentWorkspaceId="ws_1" projects={[{ workspaceId: "ws_1", name: "Lanzamiento" }]} onOpenDesign={(ws, id) => record("open", ws, id)} now={NOW} />);
  await click("[data-design-create='board']");
  const name = await waitFor("[data-design-create-name]");
  expect(name instanceof HTMLInputElement ? name.value : "").toBe(t("design_ui.studio.untitled", { kind: t("design_ui.studio.kind_board") }));
  await type("[data-design-create-name]", "Ideas del lanzamiento");
  await click("[data-design-create-submit]");
  expect(calls.createDesign).toEqual([[{ workspaceId: "ws_1", kind: "board", title: "Ideas del lanzamiento" }]]);
  expect(calls.open).toEqual([["ws_1", "nuevo"]]);
});

test("gallery: with no project, the dialog creates the project and the design in one step (no detour to an application)", async () => {
  state.list = { designs: [], writable: true };
  let failOnce = true;
  const client = { ...fakeClient(), createDesign: async (input: Parameters<DesignClient["createDesign"]>[0]) => {
    record("createDesign", input);
    if (failOnce) { failOnce = false; throw new OpenworkServerError(500, "boom", "no"); }
    return manifest({ id: "nuevo", kind: input.kind, title: input.title });
  } };
  const newProject = {
    applications: [{ id: "app_1", name: "Comex" }],
    createProject: async (applicationId: string, name: string) => { record("createProject", applicationId, name); return "ws_new"; },
    createApplication: (kind: string) => record("createApplication", kind),
  };
  await render(<DesignGalleryPanel client={client} currentWorkspaceId={null} projects={[]} newProject={newProject} onOpenDesign={(ws, id) => record("open", ws, id)} now={NOW} />);
  await click("[data-design-create='slides']");
  const projectName = await waitFor("[data-design-create-new-project]");
  expect(projectName instanceof HTMLInputElement ? projectName.value : "").toBe(t("design_ui.studio.new_project_default"));
  expect(document.body.querySelector("[data-design-create-application]")).toBe(null);
  await click("[data-design-create-submit]");
  expect(calls.createProject).toEqual([["app_1", t("design_ui.studio.new_project_default")]]);
  expect(calls.open).toBeUndefined();
  // The design failed after the project was made: a retry reuses that project.
  await click("[data-design-create-submit]");
  expect(calls.createProject?.length).toBe(1);
  expect(calls.createDesign?.map(([input]) => (input as { workspaceId: string }).workspaceId)).toEqual(["ws_new", "ws_new"]);
  expect(calls.open).toEqual([["ws_new", "nuevo"]]);
});

test("gallery: with no application yet, the dialog offers to create one and comes back to the chosen kind", async () => {
  state.list = { designs: [], writable: true };
  const newProject = { applications: [], createProject: async () => "never", createApplication: (kind: string) => record("createApplication", kind) };
  await render(<DesignGalleryPanel client={fakeClient()} currentWorkspaceId={null} projects={[]} newProject={newProject} onOpenDesign={() => undefined} now={NOW} />);
  await click("[data-design-create='mockup']");
  expect(document.body.textContent).toContain(t("design_ui.studio.create_needs_application"));
  await click("[data-design-create-application]");
  expect(calls.createApplication).toEqual([["mockup"]]);
  expect(document.body.querySelector("[data-design-create-dialog]")).toBe(null);
  await act(async () => root?.unmount());
  root = createRoot(host);
  // Back from the application form (`?new=mockup`): the dialog reopens once for that kind.
  await render(<DesignGalleryPanel client={fakeClient()} currentWorkspaceId={null} projects={[{ workspaceId: "ws_1", name: "Principal" }]} initialKind="mockup" onInitialKindUsed={() => record("initialUsed")} onOpenDesign={() => undefined} now={NOW} />);
  await waitFor("[data-design-create-dialog]");
  expect(calls.initialUsed).toEqual([[]]);
  expect(find("[data-design-create-project]").textContent).toContain("Principal");
});

test("gallery: honest empty, read-only and error states", async () => {
  state.list = { designs: [], writable: false };
  await render(<DesignGalleryPanel client={fakeClient()} currentWorkspaceId={null} projects={[]} onOpenDesign={() => undefined} now={NOW} />);
  await waitFor("[data-design-empty]");
  expect(find("[data-design-empty]").textContent).toContain(t("design_ui.studio.empty_read_only"));
  expect(find("[data-design-read-only]").textContent).toContain(t("design_ui.studio.read_only"));
  expect(find("[data-design-create='slides']").hasAttribute("disabled")).toBe(true);
  expect(find("[data-design-read-only] [data-pair-device-hint]")).toBeTruthy();
  await act(async () => root?.unmount());
  root = createRoot(host);
  queryClient.clear();
  state.list = new OpenworkServerError(404, "design_studio_disabled", "off");
  await render(<DesignGalleryPanel client={fakeClient()} currentWorkspaceId={null} projects={[]} onOpenDesign={() => undefined} now={NOW} />);
  await waitFor("[data-design-error]");
  expect(find("[data-design-error]").textContent).toContain(t("design_ui.studio.error_disabled"));
  expect(document.body.querySelector("[data-design-empty]")).toBe(null);
});

test("gallery model: search folds accents, project options merge both sources", () => {
  const designs = [summary("a", { title: "Presentación anual" }), summary("b", { title: "Otro", workspaceId: "ws_9", projectName: "Zeta" })];
  const label = () => "";
  expect(visibleDesigns(designs, { scope: "all", workspaceId: null, query: "presentacion", kindLabel: label }).map(entry => entry.id)).toEqual(["a"]);
  expect(visibleDesigns(designs, { scope: "project", workspaceId: "ws_9", query: "", kindLabel: label }).map(entry => entry.id)).toEqual(["b"]);
  expect(designProjectOptions([{ workspaceId: "ws_1", name: "Alfa" }], designs)).toEqual([{ workspaceId: "ws_1", name: "Alfa" }, { workspaceId: "ws_9", name: "Zeta" }]);
  expect(designAskMessage("  Cambia el título ", "Elemento: h1")).toBe("Cambia el título\n\nElemento: h1");
});

// ---- Design page ----

function AskingEditor(props: DesignEditorProps) {
  return <div data-test-editor={props.design.kind} data-revision={props.revision} data-present={props.presentSignal ?? 0}>
    <button type="button" data-test-ask onClick={() => props.onAskAgent("Haz el título más grande", "Elemento: h1 en pages/p-1.html")}>ask</button>
  </div>;
}
const testEditors = { ...DESIGN_EDITORS, slides: AskingEditor };

test("design page: header, rename, HTML export, chat toggle and the placeholder editor", async () => {
  const created: Blob[] = [];
  const originalCreate = URL.createObjectURL;
  URL.createObjectURL = (blob: Blob) => { created.push(blob); return `blob:test/${created.length}`; };
  try {
    await render(<DesignPagePanel client={fakeClient()} workspaceId="ws_1" designId="plan" chat={fakeChat()} onBack={() => record("back")} editors={placeholderEditors} />);
    await waitFor("[data-design-page='plan']");
    expect(find("[data-design-title]").textContent).toBe("Plan de lanzamiento");
    await waitFor("[data-design-placeholder-editor]");
    expect(document.body.querySelectorAll("[data-design-page-item]").length).toBe(2);
    await click("[data-design-add-page]");
    expect(calls.addDesignPage).toEqual([["ws_1", "plan", { afterPageId: "p-1" }]]);

    await click("[data-design-title]");
    await type("[data-design-title-input]", "Plan Q3");
    const input = find("[data-design-title-input]");
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await settle();
    expect(calls.updateDesign).toEqual([["ws_1", "plan", { title: "Plan Q3" }]]);

    await click("[data-design-export]");
    await click("[data-design-export-format='html']");
    expect(calls.exportDesignHtml).toEqual([["ws_1", "plan"]]);
    expect(created.some(blob => blob.type === "application/zip")).toBe(true);

    expect(find("[data-design-chat-toggle]").getAttribute("aria-pressed")).toBe("true");
    expect(find("[data-design-chat-start]")).toBeTruthy();
    await click("[data-design-chat-close]");
    expect(document.body.querySelector("[data-design-chat]")).toBe(null);
    expect(find("[data-design-chat-toggle]").getAttribute("aria-pressed")).toBe("false");
  } finally { URL.createObjectURL = originalCreate; }
});

test("design page: asking the agent starts and binds a chat, then sends to it; present goes to the editor", async () => {
  await render(<DesignPagePanel client={fakeClient()} workspaceId="ws_1" designId="plan" chat={fakeChat()} onBack={() => undefined} editors={testEditors} initialChatOpen={false} />);
  await waitFor("[data-test-editor='slides']");
  expect(find("[data-test-editor]").getAttribute("data-revision")).toBe("5");
  await click("[data-design-present]");
  expect(find("[data-test-editor]").getAttribute("data-present")).toBe("1");
  await click("[data-test-ask]");
  await settle();
  expect(calls.startChat).toEqual([["Haz el título más grande\n\nElemento: h1 en pages/p-1.html"]]);
  expect(calls.bindDesignChat).toEqual([["ws_1", "plan", "ses_new"]]);
  await waitFor("[data-test-session='ses_new']");
  expect(calls.onSessionChange?.at(-1)).toEqual(["ses_new"]);
  await click("[data-test-ask]");
  expect(calls.sendMessage).toEqual([["ses_new", "Haz el título más grande\n\nElemento: h1 en pages/p-1.html"]]);
  expect(calls.startChat?.length).toBe(1);
});

test("design page: read-only shows the lock with the pairing hint and no chat input; a missing design is an error", async () => {
  state.writable = false;
  state.chats = ["ses_old"];
  await render(<DesignPagePanel client={fakeClient()} workspaceId="ws_1" designId="plan" chat={fakeChat()} onBack={() => undefined} />);
  await waitFor("[data-design-page-read-only]");
  expect(document.body.querySelector("[data-design-chat-start]")).toBe(null);
  expect(document.body.querySelector("[data-design-add-page]")).toBe(null);
  expect(document.body.querySelector("[data-design-title-input]")).toBe(null);
  await act(async () => root?.unmount());
  root = createRoot(host);
  queryClient.clear();
  const missing = { ...fakeClient(), getDesign: async () => { throw new OpenworkServerError(404, "design_not_found", "gone"); } };
  await render(<DesignPagePanel client={missing} workspaceId="ws_1" designId="plan" chat={null} onBack={() => record("back")} />);
  await waitFor("[data-design-page-error]");
  expect(find("[data-design-page-error]").textContent).toContain(t("design_ui.studio.error_not_found"));
});

test("design page: the chat panel stretches to the column's height so the session surface keeps its own", async () => {
  state.chats = ["ses_old"];
  await render(<DesignPagePanel client={fakeClient()} workspaceId="ws_1" designId="plan" chat={fakeChat()} onBack={() => undefined} editors={placeholderEditors} />);
  const aside = await waitFor("[data-design-chat]");
  // The embedded session's scroller is absolute: with an auto-height panel it collapses to zero,
  // leaving the composer at the top and the scroll overlays floating over the design header.
  expect(aside.className).toContain("flex-1");
  expect(aside.className).toContain("min-h-0");
  await waitFor("[data-test-session='ses_old']");
  expect(aside.querySelector("[data-test-session='ses_old']")).toBeTruthy();
});

test("design page without a chat host says the chat is unavailable", async () => {
  await render(<DesignPagePanel client={fakeClient()} workspaceId="ws_1" designId="plan" chat={null} onBack={() => undefined} />);
  await waitFor("[data-design-chat-unavailable]");
});

/** @jsxImportSource react */
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const ownsDom = !GlobalRegistrator.isRegistered;
if (ownsDom) GlobalRegistrator.register({ url: "http://localhost/" });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const { t } = await import("../src/i18n");
const { OpenworkServerError } = await import("../src/app/lib/openwork-server");
const { ConfirmDialogHost } = await import("../src/components/ui/confirm-dialog");
const { SystemEditor } = await import("../src/react-app/domains/design/editors/system-editor");
const model = await import("../src/react-app/domains/design/editors/system-model");
const { designTokensSchema } = await import("@openwork/types/designs");
type Manifest = import("@openwork/types/designs").DesignManifest;
type Tokens = import("@openwork/types/designs").DesignTokens;
type Summary = import("@openwork/types/designs").DesignSummary;
type Client = import("../src/react-app/domains/design/editors/system-editor").SystemEditorClient;
type Frame = import("../src/react-app/domains/design/editors/system-editor").SystemDesignFrame;

const NOW = 1_700_000_000_000;

function fixtureTokens(): Tokens {
  return designTokensSchema.parse({
    format: "openwork.design-tokens",
    version: 1,
    overview: "Marca de ejemplo para una tienda de café de especialidad.",
    content: "Tutea al lector. Frases cortas.",
    colors: [
      { name: "Primario", value: "#0A5FFF", role: "Acciones principales", group: "Marca" },
      { name: "Tinta", value: "rgb(20 20 30)", role: "Texto", group: "Neutros" },
      { name: "Raro", value: "url(https://example.invalid/x.png)" },
    ],
    typography: [{ name: "Título", family: "Brand Sans", size: "32px", weight: 600, lineHeight: "1.2", sample: "Café de origen" }],
    spacing: [{ name: "s", value: "8px" }, { name: "m", value: "16px" }],
    radii: [{ name: "Tarjeta", value: "12px" }],
    shadows: [{ name: "Elevada", value: "0 4px 12px rgb(0 0 0 / 0.12)" }],
    gradients: [{ name: "Amanecer", value: "linear-gradient(90deg, #0A5FFF, #00B3A4)" }],
    layout: [{ name: "Grilla", value: "12 columnas", note: "Separación de 24px" }],
    components: [{ name: "Botón", file: "pages/boton.html", description: "Botón primario y secundario" }],
    assets: [{ name: "Logo", file: "assets/logo.svg" }, { name: "Guía", file: "assets/guia.pdf" }],
  });
}

function manifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    format: "openwork.design", version: 1, id: "marca", kind: "system", title: "Marca Café", createdAt: NOW, updatedAt: NOW,
    pages: [{ id: "p-1", title: "Portada", file: "pages/p-1.html", width: 1440, height: 900 }],
    systemId: null, thumbnail: "thumbnail.png", ...overrides,
  };
}

let files: Map<string, string>;
let writes: [string, string][];
let asked: [string, string | undefined][];
let changed: number;
let failNextWrite: boolean;

function fakeClient(): Client {
  return {
    readDesignFile: async (workspaceId, designId, path) => {
      expect([workspaceId, designId]).toEqual(["ws_1", "marca"]);
      const body = files.get(path);
      if (body === undefined) throw new OpenworkServerError(404, "design_file_not_found", "missing");
      return new Blob([body]);
    },
    writeDesignFile: async (_workspaceId, _designId, path, body) => {
      if (failNextWrite) { failNextWrite = false; throw new OpenworkServerError(500, "boom", "boom"); }
      const text = typeof body === "string" ? body : await body.text();
      writes.push([path, text]);
      files.set(path, text);
      return { ok: true };
    },
  };
}

const FakeFrame: Frame = ({ page, designId }) => <div data-fake-frame={`${designId}:${page.file}`} />;

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement;
let queryClient: InstanceType<typeof QueryClient>;

async function settle(rounds = 8) {
  for (let index = 0; index < rounds; index += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
async function render(options: { writable?: boolean; design?: Manifest; frame?: Frame | undefined } = {}) {
  await act(async () => {
    root?.render(<QueryClientProvider client={queryClient}>
      <SystemEditor workspaceId="ws_1" design={options.design ?? manifest()} writable={options.writable ?? true} client={fakeClient()}
        onChanged={() => { changed += 1; }} chatOpen={false} onAskAgent={(text, context) => { asked.push([text, context]); }}
        frame={"frame" in options ? options.frame : FakeFrame} />
      <ConfirmDialogHost />
    </QueryClientProvider>);
  });
  await settle();
}
function find(selector: string): HTMLElement {
  const element = document.body.querySelector(selector);
  if (!(element instanceof HTMLElement)) throw new Error(`missing ${selector}`);
  return element;
}
const all = (selector: string) => [...document.body.querySelectorAll(selector)];
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
const open = (section: string) => click(`[data-system-nav-item='${section}']`);
const savedTokens = () => {
  const last = writes.at(-1);
  if (!last) throw new Error("nothing written");
  expect(last[0]).toBe("tokens.json");
  return designTokensSchema.parse(JSON.parse(last[1]));
};

beforeEach(() => {
  files = new Map([["tokens.json", model.serializeTokens(fixtureTokens())], ["assets/logo.svg", "<svg xmlns='http://www.w3.org/2000/svg'/>"]]);
  writes = [];
  asked = [];
  changed = 0;
  failNextWrite = false;
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

// ---------------------------------------------------------------------------------------------
// Pure model

test("model: parses tokens.json, empty files are an empty system and bad files say why", () => {
  expect(model.parseTokensText("")).toEqual({ ok: true, tokens: model.emptyTokens() });
  expect(model.parseTokensText("{nope")).toEqual({ ok: false, code: "invalid_json" });
  expect(model.parseTokensText(JSON.stringify({ format: "other" }))).toEqual({ ok: false, code: "invalid_tokens" });
  const parsed = model.parseTokensText(model.serializeTokens(fixtureTokens()));
  expect(parsed.ok && parsed.tokens.colors.length).toBe(3);
  expect(model.tokensAreEmpty(model.emptyTokens())).toBe(true);
  expect(model.tokensAreEmpty(fixtureTokens())).toBe(false);
});

test("model: CSS values for samples never load anything", () => {
  expect(model.isSafeCssValue("0 4px 12px rgb(0 0 0 / 0.12)")).toBe(true);
  expect(model.isSafeCssValue("linear-gradient(90deg, #000, #fff)")).toBe(true);
  expect(model.isSafeCssValue("url(https://example.invalid/x.png)")).toBe(false);
  expect(model.isSafeCssValue("image-set('a.png' 1x)")).toBe(false);
  expect(model.isSafeCssValue("red; background: blue")).toBe(false);
  expect(model.isSafeCssValue("\\75rl(x)")).toBe(false);
  expect(model.isCssColor("#0A5FFF")).toBe(true);
  expect(model.isCssColor("oklch(0.7 0.1 200)")).toBe(true);
  expect(model.isCssColor("transparent")).toBe(true);
  expect(model.isCssColor("azulito")).toBe(false);
  expect(model.isCssLength("1.5rem")).toBe(true);
  expect(model.isCssLength("16")).toBe(false);
  expect(model.fontStack("Brand Sans")).toBe("Brand Sans, system-ui, sans-serif");
  expect(model.fontStack("x;}url(")).toBe("xurl, system-ui, sans-serif");
});

test("model: token validation is per field, names are unique per section and weights become numbers", () => {
  const tokens = fixtureTokens();
  expect(model.buildToken("colors", { name: "", value: "" }, tokens.colors, null)).toEqual({ ok: false, errors: { name: "design_ui.system.error.required", value: "design_ui.system.error.required" } });
  expect(model.buildToken("colors", { name: "primario", value: "#fff" }, tokens.colors, null)).toEqual({ ok: false, errors: { name: "design_ui.system.error.name_taken" } });
  expect(model.buildToken("colors", { name: "Primario", value: "#fff" }, tokens.colors, 0).ok).toBe(true);
  expect(model.buildToken("colors", { name: "Fondo", value: "azulito" }, tokens.colors, null)).toEqual({ ok: false, errors: { value: "design_ui.system.error.color" } });
  expect(model.buildToken("spacing", { name: "l", value: "24" }, tokens.spacing, null)).toEqual({ ok: false, errors: { value: "design_ui.system.error.length" } });
  expect(model.buildToken("gradients", { name: "g", value: "url(x)" }, tokens.gradients, null)).toEqual({ ok: false, errors: { value: "design_ui.system.error.gradient" } });
  expect(model.buildToken("assets", { name: "x", file: "../fuera.png" }, tokens.assets, null)).toEqual({ ok: false, errors: { file: "design_ui.system.error.path" } });
  expect(model.buildToken("colors", { name: "n".repeat(81), value: "#fff" }, tokens.colors, null)).toEqual({ ok: false, errors: { name: "design_ui.system.error.too_long" } });
  const type = model.buildToken("typography", { name: "Cuerpo", family: "Brand Sans", size: "16px", weight: "400", lineHeight: "1.5", sample: "" }, tokens.typography, null);
  expect(type).toEqual({ ok: true, token: { name: "Cuerpo", family: "Brand Sans", size: "16px", weight: 400, lineHeight: "1.5" } });
  expect(model.buildToken("typography", { name: "x", family: "f", size: "16px", weight: "pesado", lineHeight: "alto" }, [], null))
    .toEqual({ ok: false, errors: { weight: "design_ui.system.error.weight", lineHeight: "design_ui.system.error.line_height" } });
  const form = model.tokenFormFrom("typography", tokens.typography[0] ?? null);
  expect(form).toEqual({ name: "Título", family: "Brand Sans", size: "32px", weight: "600", lineHeight: "1.2", sample: "Café de origen" });
});

test("model: adding, replacing and removing tokens keeps the rest", () => {
  const tokens = fixtureTokens();
  const added = model.updateTokens(tokens, "spacing", null, { name: "l", value: "24px" });
  expect(added.spacing.map(item => item.name)).toEqual(["s", "m", "l"]);
  const replaced = model.updateTokens(added, "spacing", 0, { name: "xs", value: "4px" });
  expect(replaced.spacing[0]).toEqual({ name: "xs", value: "4px" });
  const removed = model.updateTokens(replaced, "spacing", 1, null);
  expect(removed.spacing.map(item => item.name)).toEqual(["xs", "l"]);
  expect(removed.colors).toEqual(tokens.colors);
});

test("model: search, counts, files list and component pages", () => {
  const tokens = fixtureTokens();
  const design = manifest();
  const files = model.designFiles(design, tokens);
  expect(files.map(file => file.path)).toEqual(["assets/guia.pdf", "assets/logo.svg", "design.json", "pages/boton.html", "pages/p-1.html", "thumbnail.png", "tokens.json"]);
  expect(files.find(file => file.path === "pages/boton.html")?.kind).toBe("component");
  const counts = model.sectionCounts(tokens, files, "");
  expect(counts).toMatchObject({ overview: null, colors: 3, typography: 1, spacing: 2, assets: 2, files: 7 });
  const searched = model.sectionCounts(tokens, files, "ACCION");
  expect(searched).toMatchObject({ colors: 1, typography: 0, files: 0 });
  expect(model.filterTokens(tokens, "typography", "titulo").length).toBe(1);
  expect(model.componentPage(design, { name: "Portada", file: "pages/p-1.html" }, 0).id).toBe("p-1");
  expect(model.componentPage(design, { name: "Botón primario", file: "pages/boton.html" }, 2)).toEqual({ id: "c2-boton-primario", title: "Botón primario", file: "pages/boton.html", width: 1440, height: 900 });
  expect(model.imageType("assets/logo.SVG")).toBe("image/svg+xml");
  expect(model.imageType("assets/guia.pdf")).toBe(null);
});

test("model: which system a design follows, and the patch to change it", () => {
  const summary = (id: string, kind: Summary["kind"], workspaceId = "ws_1"): Summary => ({ workspaceId, projectName: "P", id, kind, title: id.toUpperCase(), pages: 1, updatedAt: NOW, createdAt: NOW, hasThumbnail: false });
  const designs = [summary("marca", "system"), summary("deck", "slides"), summary("otra", "system", "ws_2")];
  const choices = model.designSystemChoices(designs, "ws_1", "deck");
  expect(choices).toEqual([{ id: "marca", title: "MARCA" }]);
  expect(model.followedSystem({ id: "deck", kind: "slides", systemId: null }, choices)).toEqual({ system: { id: "marca", title: "MARCA" }, explicit: false });
  expect(model.followedSystem({ id: "deck", kind: "slides", systemId: "marca" }, choices)).toEqual({ system: { id: "marca", title: "MARCA" }, explicit: true });
  expect(model.followedSystem({ id: "deck", kind: "slides", systemId: "borrado" }, choices)).toBe(null);
  expect(model.followedSystem({ id: "deck", kind: "slides", systemId: null }, [...choices, { id: "b", title: "B" }])).toBe(null);
  expect(model.followedSystem({ id: "marca", kind: "system", systemId: null }, choices)).toBe(null);
  expect(model.designSystemChoices(designs, "ws_1", "marca")).toEqual([]);
  expect(model.systemIdPatch("marca", choices)).toEqual({ systemId: "marca" });
  expect(model.systemIdPatch("borrado", choices)).toEqual({ systemId: null });
  expect(model.systemIdPatch(null, choices)).toEqual({ systemId: null });
});

// ---------------------------------------------------------------------------------------------
// Editor

test("editor: navigation lists every section with counts; overview shows brand and content", async () => {
  await render();
  expect(all("[data-system-nav-item]").map(item => item.getAttribute("data-system-nav-item"))).toEqual([...model.SYSTEM_SECTIONS]);
  expect(find("[data-system-nav-item='overview']").getAttribute("aria-current")).toBe("page");
  expect(find("[data-system-nav-item='colors'] [data-system-nav-count]").textContent).toBe("3");
  expect(find("[data-system-nav-item='files'] [data-system-nav-count]").textContent).toBe("7");
  expect(document.body.querySelector("[data-system-nav-item='overview'] [data-system-nav-count]")).toBe(null);
  expect(find("[data-system-prose-value='overview']").textContent).toBe("Marca de ejemplo para una tienda de café de especialidad.");
  expect(find("[data-system-prose-value='content']").textContent).toBe("Tutea al lector. Frases cortas.");
  expect(document.body.querySelector("[data-system-build]")).toBe(null);
});

test("editor: colors render swatches with value and role, unsafe values get no fill, and values copy", async () => {
  await render();
  await open("colors");
  expect(all("[data-system-color]").map(item => item.getAttribute("data-system-color"))).toEqual(["Primario", "Tinta", "Raro"]);
  const primary = find("[data-system-color='Primario']");
  expect(primary.textContent).toContain("#0A5FFF");
  expect(primary.textContent).toContain("Acciones principales");
  expect(find("[data-system-color='Primario'] [data-system-swatch]").style.backgroundColor).not.toBe("");
  expect(find("[data-system-color='Raro'] [data-system-swatch]").getAttribute("style")).toBe(null);
  expect(document.body.textContent).toContain("Neutros");
  await click("[data-system-color='Primario'] [data-system-copy]");
  expect(await navigator.clipboard.readText()).toBe("#0A5FFF");
  expect(find("[data-system-color='Primario'] [data-system-copy]").getAttribute("aria-label")).toBe(t("design_ui.system.copied"));
});

test("editor: type specimens, measures, layout, components, assets and files", async () => {
  await render();
  await open("typography");
  const specimen = find("[data-system-type='Título'] [data-system-specimen]");
  expect(specimen.textContent).toBe("Café de origen");
  expect(specimen.style.fontFamily).toContain("Brand Sans");
  expect(specimen.style.fontWeight).toBe("600");
  await open("spacing");
  expect(find("[data-system-measure='m'] [data-system-sample]").style.width).toBe("16px");
  await open("radii");
  expect(find("[data-system-measure='Tarjeta'] [data-system-sample]").style.borderRadius).toBe("12px");
  await open("shadows");
  expect(find("[data-system-measure='Elevada'] [data-system-sample]").style.boxShadow).toContain("12px");
  await open("gradients");
  expect(find("[data-system-measure='Amanecer'] [data-system-sample]").style.backgroundImage).toContain("linear-gradient");
  await open("layout");
  expect(find("[data-system-layout='Grilla']").textContent).toContain("Separación de 24px");
  await open("components");
  expect(find("[data-system-component='Botón'] [data-fake-frame]").getAttribute("data-fake-frame")).toBe("marca:pages/boton.html");
  await open("assets");
  expect(all("[data-system-asset]").length).toBe(2);
  await waitFor("[data-system-asset='Logo'] [data-system-asset-image]");
  expect(find("[data-system-asset='Guía']").textContent).toContain("guia.pdf");
  await open("files");
  expect(all("[data-system-file]").map(item => item.getAttribute("data-system-file"))).toContain("tokens.json");
});

test("editor: without a frame, component previews show their file", async () => {
  await render({ frame: undefined });
  await open("components");
  expect(find("[data-system-component='Botón']").textContent).toContain("pages/boton.html");
});

test("editor: search filters the sections and counts", async () => {
  await render();
  await type("[data-system-search]", "acciones");
  expect(find("[data-system-nav-item='colors'] [data-system-nav-count]").textContent).toBe("1");
  expect(find("[data-system-nav-item='typography'] [data-system-nav-count]").textContent).toBe("0");
  await open("colors");
  expect(all("[data-system-color]").length).toBe(1);
  await open("typography");
  find("[data-system-no-results]");
});

test("editor: adds a color after validation and writes tokens.json", async () => {
  await render();
  await open("colors");
  await click("[data-system-add='colors']");
  await type("[data-system-field='name']", "Fondo");
  await type("[data-system-field='value']", "azulito");
  await click("[data-system-token-save]");
  expect(find("[data-system-field-error='value']").textContent).toBe(t("design_ui.system.error.color"));
  expect(writes.length).toBe(0);
  await type("[data-system-field='value']", "#F5F1EA");
  await type("[data-system-field='role']", "Fondo de página");
  await click("[data-system-token-save]");
  expect(savedTokens().colors.at(-1)).toEqual({ name: "Fondo", value: "#F5F1EA", role: "Fondo de página" });
  expect(changed).toBe(1);
  expect(document.body.querySelector("[data-system-token-dialog]")).toBe(null);
  await waitFor("[data-system-color='Fondo']");
});

test("editor: edits and deletes tokens (delete asks first)", async () => {
  await render();
  await open("spacing");
  await click("[data-system-measure='s'] [data-system-edit]");
  expect(find("[data-system-field='value']").getAttribute("value") ?? "").toBe("8px");
  await type("[data-system-field='value']", "4px");
  await click("[data-system-token-save]");
  expect(savedTokens().spacing[0]).toEqual({ name: "s", value: "4px" });
  await click("[data-system-measure='m'] [data-system-delete]");
  await click("[data-slot='alert-dialog-action']");
  expect(savedTokens().spacing).toEqual([{ name: "s", value: "4px" }]);
});

test("editor: refuses to overwrite tokens.json the agent changed meanwhile", async () => {
  await render();
  await open("radii");
  files.set("tokens.json", model.serializeTokens({ ...fixtureTokens(), radii: [] }));
  await click("[data-system-measure='Tarjeta'] [data-system-delete]");
  await click("[data-slot='alert-dialog-action']");
  expect(writes.length).toBe(0);
  expect(find("[data-system-save-error]").textContent).toContain(t("design_ui.system.error.conflict"));
});

test("editor: a failed write says so and keeps the dialog open", async () => {
  await render();
  await open("layout");
  await click("[data-system-add='layout']");
  await type("[data-system-field='name']", "Ancho");
  await type("[data-system-field='value']", "1200px máximo");
  failNextWrite = true;
  await click("[data-system-token-save]");
  find("[data-system-token-dialog]");
  expect(document.body.textContent).toContain(t("design_ui.system.error.save_failed"));
});

test("editor: overview and content are edited as text", async () => {
  await render();
  await click("[data-system-prose-edit='content']");
  await type("[data-system-prose-text='content']", "Usa frases cortas y verbos claros.");
  await click("[data-system-prose-save='content']");
  const saved = savedTokens();
  expect(saved.content).toBe("Usa frases cortas y verbos claros.");
  expect(saved.overview).toBe(fixtureTokens().overview);
  await waitFor("[data-system-prose-value='content']");
});

test("editor: an empty system invites asking the agent, from a source or per section", async () => {
  files.delete("tokens.json");
  await render();
  find("[data-system-build]");
  find("[data-system-prose-empty='overview']");
  await click("[data-system-build-suggestion='logo']");
  await click("[data-system-build-send]");
  expect(asked).toEqual([[t("design_ui.system.ask.build_from", { title: "Marca Café", source: t("design_ui.system.build.suggestion.logo") }), "tokens.json"]]);
  await open("colors");
  find("[data-system-empty='colors']");
  await click("[data-system-ask='colors']");
  expect(asked.at(-1)).toEqual([t("design_ui.system.ask.colors", { title: "Marca Café" }), "tokens.json#colors"]);
});

test("editor: a broken tokens.json offers to ask the agent to fix it", async () => {
  files.set("tokens.json", "{ roto");
  await render();
  expect(find("[data-system-invalid]").textContent).toContain(t("design_ui.system.error.invalid_json"));
  await click("[data-system-ask-fix]");
  expect(asked[0]?.[0]).toBe(t("design_ui.system.ask.fix", { title: "Marca Café" }));
});

test("editor: read only shows tokens without any edit control", async () => {
  await render({ writable: false });
  find("[data-system-read-only]");
  expect(document.body.querySelector("[data-system-prose-edit]")).toBe(null);
  await open("colors");
  expect(document.body.querySelector("[data-system-add]")).toBe(null);
  expect(document.body.querySelector("[data-system-edit]")).toBe(null);
  expect(document.body.querySelector("[data-system-delete]")).toBe(null);
  find("[data-system-copy]");
});

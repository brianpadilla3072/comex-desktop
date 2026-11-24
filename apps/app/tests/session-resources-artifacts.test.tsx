/** @jsxImportSource react */
// Un resultado existente del proyecto se abre con su visor: la tarjeta «Resultados y fuentes»
// debe entregar el target completo al manejador de apertura, sin pedirle al agente que lo abra.
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://localhost/" });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { artifactPreview, openTargetFromArtifact, openTargetFromUrl } = await import("../src/react-app/domains/session/artifacts/open-target");
type OpenTarget = import("../src/react-app/domains/session/artifacts/open-target").OpenTarget;
const { orderResourceCardTargets, SessionResourcesCard } = await import("../src/react-app/domains/session/surface/session-resources-card");
const noop = () => {};

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
afterAll(async () => { await GlobalRegistrator.unregister(); });

async function renderCard(targets: OpenTarget[], onOpen: (target: OpenTarget) => void) {
  await act(async () => root.render(
    <SessionResourcesCard
      messages={[]}
      targets={targets}
      onOpen={onOpen}
      onAddResult={noop}
      onViewSources={noop}
      sourceMenuHostRef={noop as unknown as React.Ref<HTMLDivElement>}
    />,
  ));
}
async function clickResult(title: string) {
  const button = [...document.querySelectorAll("button")].find(element => (element.textContent ?? "").includes(title));
  if (!button) throw new Error(`No result row for ${title}`);
  await act(async () => button.click());
}

test("cada tipo de artefacto se mapea al visor que lo lee", () => {
  expect(artifactPreview("doc")).toBe("markdown");
  expect(artifactPreview("sheet")).toBe("sheet");
  expect(artifactPreview("slides")).toBe("slides");
  expect(artifactPreview("data")).toBe("html");

  const target = openTargetFromArtifact(
    { id: "art_hoja", type: "sheet", title: "Exportaciones" },
    { appId: "app_comex", workspaceId: "ws_test" },
  );
  expect(target.kind).toBe("artifact");
  expect(target.preview).toBe("sheet");
  expect(target.artifact).toEqual({ artifactId: "art_hoja", appId: "app_comex", workspaceId: "ws_test" });
});

test("tocar un resultado existente entrega su referencia de artefacto al abrir", async () => {
  const doc = openTargetFromArtifact(
    { id: "art_doc", type: "doc", title: "Informe de soja" },
    { appId: "app_comex", workspaceId: "ws_test" },
  );
  const sheet = openTargetFromArtifact(
    { id: "art_hoja", type: "sheet", title: "Planilla de costos" },
    { appId: "app_comex", workspaceId: "ws_test" },
  );
  const opened: OpenTarget[] = [];
  await renderCard([doc, sheet], target => opened.push(target));

  expect((document.body.textContent ?? "").includes("Informe de soja")).toBe(true);
  expect((document.body.textContent ?? "").includes("Planilla de costos")).toBe(true);

  await clickResult("Planilla de costos");
  expect(opened).toHaveLength(1);
  expect(opened[0]?.preview).toBe("sheet");
  expect(opened[0]?.artifact?.artifactId).toBe("art_hoja");

  await clickResult("Informe de soja");
  expect(opened).toHaveLength(2);
  expect(opened[1]?.preview).toBe("markdown");
  expect(opened[1]?.artifact?.artifactId).toBe("art_doc");
});

test("los artefactos entran en las tres filas visibles aunque el chat tenga archivos", () => {
  const sheet = openTargetFromArtifact(
    { id: "art_hoja", type: "sheet", title: "Planilla de costos" },
    { appId: "app_comex", workspaceId: "ws_test" },
  );
  const file = (name: string): OpenTarget => ({ id: `file:${name}`, kind: "file", value: name, name, preview: "code", confidence: 100, reason: "test", exists: true });
  const web = openTargetFromUrl("http://127.0.0.1:44129/");
  if (!web) throw new Error("Missing URL target");
  const ordered = orderResourceCardTargets([file("a.ts"), file("b.ts"), file("c.ts")], [web, sheet]);

  expect(ordered.slice(0, 3).map(target => target.id)).toEqual([sheet.id, "file:a.ts", "file:b.ts"]);
  // The browser tab keeps its old place behind chat files.
  expect(ordered[ordered.length - 1]?.id).toBe(web.id);
});

test("un resultado web sigue abriendo como navegador", async () => {
  const url = openTargetFromUrl("http://127.0.0.1:44129/");
  if (!url) throw new Error("Missing URL target");
  const opened: OpenTarget[] = [];
  await renderCard([url], target => opened.push(target));

  await clickResult("127.0.0.1:44129");
  expect(opened).toHaveLength(1);
  expect(opened[0]?.kind).toBe("url");
  expect(opened[0]?.preview).toBe("browser");
});

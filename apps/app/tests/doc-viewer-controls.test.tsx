/** @jsxImportSource react */
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const ownsDom = !GlobalRegistrator.isRegistered;
if (ownsDom) GlobalRegistrator.register({ url: "http://localhost/" });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { DocView } = await import("../src/react-app/domains/artifacts/views/doc-view");
import type { ArtifactMetadata, DocComment } from "../src/react-app/domains/artifacts/types";

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

afterAll(async () => {
  if (ownsDom) await GlobalRegistrator.unregister();
});

const button = (label: string) => Array.from(host.querySelectorAll("button")).find(item => item.getAttribute("aria-label") === label || item.textContent?.includes(label));

test("el agente puede controlar modo, búsqueda, pantalla completa, comentarios y fuentes", async () => {
  const viewerPatches: Array<Partial<NonNullable<ArtifactMetadata["viewer"]>>> = [];
  const commentPatches: DocComment[][] = [];
  const comments: DocComment[] = [{
    id: "com_1", quote: "Soja 2024", text: "Verificar cifra", author: "agent", resolved: false, createdAt: 1, updatedAt: 1,
  }];
  await act(async () => root.render(
    <DocView
      content="# Informe\n\nSoja 2024."
      title="Informe"
      viewer={{ format: "md", mode: "preview" }}
      comments={comments}
      sources={[{ kind: "source", id: "src_1", label: "Informe oficial" }]}
      audit={{ total: 1, valid: 1, invalid: [] }}
      onViewerChange={patch => viewerPatches.push(patch)}
      onCommentsChange={next => commentPatches.push(next)}
    />,
  ));

  await act(async () => button("Editar documento")!.click());
  expect(host.querySelector("textarea")).not.toBeNull();
  expect(viewerPatches.at(-1)?.mode).toBe("edit");

  const search = host.querySelector<HTMLInputElement>('input[aria-label="Buscar en el documento"]')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(search, "Soja");
    search.dispatchEvent(new Event("input", { bubbles: true }));
    search.dispatchEvent(new Event("change", { bubbles: true }));
    search.dispatchEvent(new Event("focusout", { bubbles: true }));
  });
  expect(viewerPatches.at(-1)?.search).toBe("Soja");

  await act(async () => button("Pantalla completa")!.click());
  expect(host.querySelector("[data-testid=doc-viewer]")?.getAttribute("data-doc-fullscreen")).toBe("true");
  expect(viewerPatches.at(-1)?.fullscreen).toBe(true);

  await act(async () => button("Comentarios (1)")!.click());
  expect(host.textContent).toContain("Verificar cifra");
  await act(async () => button("Resolver comentario")!.click());
  expect(commentPatches.at(-1)?.[0]?.resolved).toBe(true);

  await act(async () => button("Cerrar panel")!.click());
  await act(async () => button("1/1 citas")!.click());
  expect(host.textContent).toContain("Informe oficial");
  expect(host.textContent).toContain("1/1 válidas");
});

test("el estado del visor enviado por el agente se refleja al recibir nuevos metadatos", async () => {
  const render = (viewer: ArtifactMetadata["viewer"]) => act(async () => root.render(<DocView content="# Informe" viewer={viewer} />));
  await render({ mode: "preview", fullscreen: false, search: "" });
  await render({ mode: "edit", fullscreen: true, search: "Informe", theme: "dark", zoom: 125 });
  expect(host.querySelector("textarea")).not.toBeNull();
  expect(host.querySelector("[data-testid=doc-viewer]")?.getAttribute("data-doc-fullscreen")).toBe("true");
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Buscar en el documento"]')?.value).toBe("Informe");
  expect(host.querySelector("[data-testid=doc-content]")?.getAttribute("data-doc-theme")).toBe("dark");
});

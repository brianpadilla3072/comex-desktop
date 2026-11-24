/** @jsxImportSource react */
import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const ownsDom = !GlobalRegistrator.isRegistered;
if (ownsDom) GlobalRegistrator.register({ url: "http://localhost/" });

const actualConfig = await import("../src/react-app/domains/cloud/desktop-config-provider.tsx?actual");
mock.module("../src/react-app/domains/cloud/desktop-config-provider", () => ({
  ...actualConfig,
  useComexWorkspaceEnabled: () => false,
}));
mock.module("../src/react-app/domains/session/artifacts/artifact-text-editor", () => ({
  ArtifactTextEditor: ({ value }: { value: string }) => <output data-editor>{value}</output>,
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { WorkspacePage } = await import("../src/react-app/domains/session/chat/workspace-resource-view");
const { useWorkspaceResources, resourceScope } = await import("../src/react-app/domains/session/chat/workspace-resource-store");

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let scope: string;
let tabId: string;

beforeEach(async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  useWorkspaceResources.setState({ workspaces: {} });
  scope = resourceScope("http://localhost:1", "workspace", "account");
  tabId = useWorkspaceResources.getState().open(scope, "page");
  useWorkspaceResources.getState().update(scope, tabId, { draft: "# Hola **mundo**" });
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

async function render() {
  const tab = useWorkspaceResources.getState().workspaces[scope]?.tabs.find(item => item.id === tabId);
  await act(async () => root.render(<WorkspacePage tab={tab!} scope={scope} client={null} workspaceId="ws" sessionId="chat" />));
}

const button = (label: string) => Array.from(host.querySelectorAll("button")).find(item => item.textContent?.includes(label));
const content = () => host.querySelector<HTMLElement>("[data-testid=doc-content]");

test("la página muestra siempre el toggle y arranca en el editor", async () => {
  await render();
  expect(button("Vista previa")).toBeDefined();
  expect(host.querySelector("[data-editor]")?.textContent).toBe("# Hola **mundo**");
  expect(host.querySelector("[data-testid=doc-viewer]")).toBeNull();
});

test("la vista previa usa el visor nativo para Markdown y MDX y permite volver a editar", async () => {
  await render();
  const preview = button("Vista previa")!;
  await act(async () => preview.click());
  expect(host.querySelector("[data-testid=doc-viewer]")?.getAttribute("data-doc-format")).toBe("md");
  expect(content()?.textContent).toContain("Hola");
  expect(content()?.getAttribute("data-doc-theme")).toBe("light");

  useWorkspaceResources.getState().update(scope, tabId, {
    path: "paginas/Demo.mdx",
    draft: 'export const x = 1\n\n# Demo\n\n<Nota>Texto del componente</Nota>\n\n{1 + 1}',
  });
  await render();
  await act(async () => button("Vista previa")!.click());
  expect(host.querySelector("[data-testid=doc-viewer]")?.getAttribute("data-doc-format")).toBe("mdx");
  expect(content()?.textContent).toContain("Texto del componente");
  expect(content()?.textContent).not.toContain("export const x = 1");
  expect(content()?.textContent).toContain("{1 + 1}");

  await act(async () => button("Editar")!.click());
  expect(host.querySelector("[data-editor]")?.textContent).toContain("Texto del componente");
});

test("el tema del documento cambia sin depender del tema de la app", async () => {
  await render();
  await act(async () => button("Vista previa")!.click());
  const toggle = Array.from(host.querySelectorAll("button")).find(item => item.getAttribute("aria-label") === "Tema oscuro");
  expect(toggle).toBeDefined();
  await act(async () => toggle!.click());
  expect(content()?.getAttribute("data-doc-theme")).toBe("dark");
  expect(content()?.style.backgroundColor).toBe("#0f172a");
});

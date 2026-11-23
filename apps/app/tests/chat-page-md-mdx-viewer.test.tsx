/** @jsxImportSource react */
import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const ownsDom = !GlobalRegistrator.isRegistered;
if (ownsDom) GlobalRegistrator.register({ url: "http://localhost/" });

let viewerEnabled = false;
const actualConfig = await import("../src/react-app/domains/cloud/desktop-config-provider.tsx?actual");
const actualPreview = await import("../src/react-app/domains/session/artifacts/preview.tsx?actual");
mock.module("../src/react-app/domains/cloud/desktop-config-provider", () => ({
  ...actualConfig,
  useChatPageMdMdxViewerEnabled: () => viewerEnabled,
  useComexWorkspaceEnabled: () => false,
}));
mock.module("../src/react-app/domains/session/artifacts/preview", () => ({
  ...actualPreview,
  MarkdownPreview: ({ content }: { content: string }) => <output data-preview="markdown">{content}</output>,
  MdxPreview: ({ content }: { content: string }) => <output data-preview="mdx">{content}</output>,
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
  viewerEnabled = false;
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

test("sin el flag la página sigue siendo solo el editor", async () => {
  await render();
  expect(button("Vista previa")).toBeUndefined();
  expect(host.querySelector("[data-editor]")?.textContent).toBe("# Hola **mundo**");
  expect(host.querySelector("[data-preview]")).toBeNull();
});

test("con el flag, la vista previa renderiza Markdown y MDX y permite volver a editar", async () => {
  viewerEnabled = true;
  await render();
  const preview = button("Vista previa")!;
  expect(preview).toBeDefined();
  await act(async () => preview.click());
  expect(host.querySelector("[data-preview='markdown']")?.textContent).toBe("# Hola **mundo**");

  useWorkspaceResources.getState().update(scope, tabId, { path: "paginas/Demo.mdx", draft: "export const x = 1" });
  await render();
  await act(async () => button("Vista previa")!.click());
  expect(host.querySelector("[data-preview='mdx']")?.textContent).toBe("export const x = 1");

  await act(async () => button("Editar")!.click());
  expect(host.querySelector("[data-editor]")?.textContent).toBe("export const x = 1");
});

/** @jsxImportSource react */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import type { ReactNode } from "react";
import type { DynamicToolUIPart } from "ai";
import { mcpAppResourceUri } from "@openwork/types/mcp-app";

const ownedDom = typeof window === "undefined";
if (ownedDom) GlobalRegistrator.register({ url: "http://localhost/" });
const previousAct = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MessageListProvider } = await import("../src/components/chat/message-list-provider");
const { createOpenworkServerClient } = await import("../src/app/lib/openwork-server");
const { AppChatArtifact } = await import("../src/react-app/domains/apps/app-chat-artifact");
const { BuiltAppChatPreview } = await import("../src/react-app/domains/apps/built-app-chat-preview");
const { PanelSessionProvider } = await import("../src/react-app/kernel/panel-session-context");
const { sessionPagePanelSessionFor } = await import("../src/react-app/domains/session/chat/workbench-panel-session");
const { usePanelTabStore } = await import("../src/react-app/domains/session/panel/panel-tab-store");
const { useUiStateStore } = await import("../src/react-app/shell/ui-state-store");
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  usePanelTabStore.setState({ sessions: {} });
  useUiStateStore.setState({ sidePanelState: {} });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
afterAll(async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousAct);
  if (ownedDom) await GlobalRegistrator.unregister();
});

// The split chat ("side") rendered as the session page renders it: inside its
// own message list, under the page's answer for which panel shows its items.
function SplitChat({ children }: { children: ReactNode }) {
  const panelSessionFor = sessionPagePanelSessionFor({
    selectedSessionId: "main",
    selectedWorkspaceId: "ws",
    split: { workspaceId: "ws", sessionId: "side" },
  });
  return <PanelSessionProvider value={(chatSessionId) => panelSessionFor(chatSessionId) ?? chatSessionId}>
    <ChatList sessionId="side">{children}</ChatList>
  </PanelSessionProvider>;
}

function ChatList({ sessionId, children }: { sessionId: string; children: ReactNode }) {
  return <MessageListProvider client={createOpenworkServerClient({ baseUrl: "http://localhost/test" })}
    workspaceId="ws" sessionId={sessionId}
    showThinking={false} developerMode={false} displaySuggestions={false} providerConnectedCount={1}
    onRevertToUserMessage={() => {}} onForkAtMessage={() => {}} onEditUserMessage={() => {}}
    onMcpReconnect={async () => "connected"} onMcpReopenAuthorization={async () => {}}
    dispatchAction={() => {}} setPrompt={() => {}} connectorIdentities={[]}>
    {children}
  </MessageListProvider>;
}

function builtApp(): DynamicToolUIPart {
  const appId = `cob_0${"0".repeat(25)}`;
  const revisionId = `cov_0${"0".repeat(25)}`;
  const resourceUri = mcpAppResourceUri(appId, revisionId);
  return {
    type: "dynamic-tool", toolName: "create_app", toolCallId: "build", state: "output-available",
    input: { title: "Revenue pulse" }, output: "Ready",
    callProviderMetadata: { openwork: { mcpResult: {
      content: [{ type: "text", text: "Ready" }],
      structuredContent: { app: { appId, revisionId, pluginId: `plg_0${"0".repeat(25)}`, title: "Revenue pulse", description: null, textFallback: "Revenue pulse", toolName: "open_app", resourceUri, serverPath: "/mcp/app", tools: [] } },
      _meta: { "openwork/mcpApp": { connectionId: appId, toolName: "open_app", resourceUri, arguments: {} } },
    } } },
  };
}

async function openPreview() {
  const button = host.querySelector("button");
  if (!button) throw new Error("Open preview button missing");
  await act(async () => button.click());
}

function panelTabTypes(sessionId: string) {
  return usePanelTabStore.getState().sessions[sessionId]?.tabs.map((tab) => tab.type);
}

test("an app opened from the split chat lands in the panel that shows", async () => {
  await act(async () => root.render(<SplitChat><AppChatArtifact appId="app" revisionId="r1" title="Revenue" /></SplitChat>));
  await openPreview();

  expect(panelTabTypes("main")).toEqual(["app"]);
  expect(usePanelTabStore.getState().sessions.side).toBeUndefined();
  expect(useUiStateStore.getState().sidePanelState.main).toBe("panel");
  expect(useUiStateStore.getState().sidePanelState.side).toBeUndefined();
});

test("a built app opened from the split chat lands in the panel that shows", async () => {
  await act(async () => root.render(<SplitChat><BuiltAppChatPreview part={builtApp()} /></SplitChat>));
  await openPreview();

  expect(panelTabTypes("main")).toEqual(["mcp-app"]);
  expect(usePanelTabStore.getState().sessions.side).toBeUndefined();
  expect(useUiStateStore.getState().sidePanelState.main).toBe("panel");
});

test("without a split view an app opens in its own chat's panel", async () => {
  await act(async () => root.render(<ChatList sessionId="side"><AppChatArtifact appId="app" revisionId="r1" title="Revenue" /></ChatList>));
  await openPreview();

  expect(panelTabTypes("side")).toEqual(["app"]);
  expect(useUiStateStore.getState().sidePanelState.side).toBe("panel");
});

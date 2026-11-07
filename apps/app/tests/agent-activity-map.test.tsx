/** @jsxImportSource react */
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://localhost/" });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClientProvider } = await import("@tanstack/react-query");
const { getReactQueryClient } = await import("../src/react-app/infra/query-client");
const { useSessionActivityStore } = await import("../src/react-app/domains/session/status/session-activity-store");
const { AgentActivityMap, conversationAgentTasks } = await import("../src/react-app/domains/session/surface/composer/agent-activity-map");
import type { UIMessage } from "ai";
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const queryClient = getReactQueryClient();
function tasks(): UIMessage[] {
  return [{ id: "main", role: "assistant", parts: ["working", "finished", "waiting"].map(name => ({
    type: "dynamic-tool", toolName: "task", toolCallId: name, input: { description: `Revisar ${name}`, prompt: `Consigna del agente ${name}`, subagent_type: "investigador" },
    state: "output-available", output: "Delegado", callProviderMetadata: { openwork: { childSessionId: `child-${name}` } },
  })) }];
}
beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  queryClient.clear();
  const store = useSessionActivityStore.getState();
  store.setRunStatus("ws-map-test", "child-working", { type: "busy" });
  store.setRunStatus("ws-map-test", "child-finished", { type: "idle" });
  store.setRunStatus("ws-map-test", "child-waiting", { type: "busy" });
  store.setWaitingRequest("ws-map-test", "child-waiting", "permission", "permission-test", true);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); queryClient.clear(); });
afterAll(async () => { await GlobalRegistrator.unregister(); });
test("map follows native activity, opens prompts and only reads commands for the selected agent", async () => {
  const reads: string[] = [];
  const readChild = async (id: string): Promise<UIMessage[]> => {
    reads.push(id);
    return [{ id: "tool-reply", role: "assistant", parts: [{ type: "dynamic-tool", toolName: "bash", toolCallId: "cmd1", state: "output-available",
      input: { description: "Validar planilla", command: "python validar.py" }, output: "Validación correcta" }] }];
  };
  const render = (offline = false) => <QueryClientProvider client={queryClient}><AgentActivityMap messages={tasks()} workspaceId="ws-map-test" owner="test-map-owner"
    parentTitle="Estudio de mercados" parentActive syncDegraded={offline} readChild={readChild} /></QueryClientProvider>;
  await act(async () => root.render(render()));
  expect(reads.length).toBe(0);
  await act(async () => host.querySelector<HTMLElement>("[data-agent-map-button]")!.click());
  const dialog = document.querySelector("[data-agent-map-dialog]")!;
  expect(dialog.querySelector('[data-agent-node="working"] [data-agent-state="running"]')).not.toBeNull();
  expect(dialog.querySelector('[data-agent-node="finished"] [data-agent-state="done"]')).not.toBeNull();
  expect(dialog.querySelector('[data-agent-node="waiting"] [data-agent-state="waiting"]')).not.toBeNull();
  await act(async () => { dialog.querySelector<HTMLElement>('[data-agent-node="working"]')!.click(); await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(document.querySelector("[data-agent-details]")!.textContent).toContain("Consigna del agente working");
  expect(reads).toEqual(["child-working"]);
  const commandTrigger = [...document.querySelectorAll<HTMLElement>('[data-agent-details] button')].find(node => node.textContent?.includes("Validar planilla"))!;
  await act(async () => commandTrigger.click());
  expect(document.querySelector("[data-agent-details]")!.textContent).toContain("python validar.py");
  await act(async () => {
    useSessionActivityStore.getState().setRunStatus("ws-map-test", "child-working", { type: "idle" });
    await new Promise(resolve => setTimeout(resolve, 30));
  });
  expect(reads.length).toBe(2);
  expect(document.querySelector('[data-agent-details] [data-agent-state="done"]')).not.toBeNull();
  await act(async () => root.render(render(true)));
  expect(document.querySelector('[data-agent-details] [data-agent-state="running"]')).toBeNull();
  expect(document.querySelector("[data-agent-details]")!.textContent).toContain("Sin conexión");
});
test("no delegated tasks means no button; tasks from earlier turns remain inspectable", async () => {
  await act(async () => root.render(<QueryClientProvider client={queryClient}><AgentActivityMap messages={[]} workspaceId="empty" owner="empty" parentTitle="Vacío" parentActive={false} syncDegraded={false} readChild={async () => []} /></QueryClientProvider>));
  expect(host.querySelector("button")).toBeNull();
  expect(conversationAgentTasks([...tasks(), { id: "next", role: "user", parts: [{ type: "text", text: "Seguí" }] }]).length).toBe(3);
});

test("collapsed tool details do not serialize large outputs until opened", async () => {
  let serialized = 0;
  const output = { toJSON() { serialized++; return { rows: Array.from({ length: 4000 }, (_, index) => ({ index, evidence: "Datos sintéticos de rendimiento" })) }; } };
  const readChild = async (): Promise<UIMessage[]> => [{ id: "reply-perf", role: "assistant", parts: [{ type: "dynamic-tool", toolName: "bash", toolCallId: "perf-tool", state: "output-available", input: { description: "Resultado extenso", command: "revisar" }, output }] }];
  await act(async () => root.render(<QueryClientProvider client={queryClient}><AgentActivityMap messages={tasks()} workspaceId="ws-map-test" owner="perf-map-owner" parentTitle="Prueba" parentActive={false} syncDegraded={false} readChild={readChild} /></QueryClientProvider>));
  await act(async () => host.querySelector<HTMLElement>("[data-agent-map-button]")!.click());
  await act(async () => { document.querySelector<HTMLElement>('[data-agent-node="finished"]')!.click(); await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(serialized).toBe(0);
  const trigger = [...document.querySelectorAll<HTMLElement>('[data-agent-details] button')].find(node => node.textContent?.includes("Resultado extenso"))!;
  await act(async () => trigger.click());
  expect(serialized).toBe(1);
  expect(document.querySelector('[data-agent-details]')!.textContent).toContain("Datos sintéticos de rendimiento");
  await act(async () => {
    queryClient.setQueryData<UIMessage[]>(["agent-activity-map", "perf-map-owner", "child-finished"], [{ id: "reply-perf", role: "assistant", parts: [{ type: "dynamic-tool", toolName: "bash", toolCallId: "perf-tool", state: "output-error", input: { description: "Resultado extenso", command: "revisar" }, errorText: "Error actualizado del agente" }] }]);
  });
  expect(document.querySelector('[data-agent-details]')!.textContent).toContain("Error actualizado del agente");
  expect(document.querySelector('[data-agent-details]')!.textContent).not.toContain("Datos sintéticos de rendimiento");
  expect(serialized).toBe(1);

});

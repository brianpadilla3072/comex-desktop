/** @jsxImportSource react */
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://localhost/" });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ConversationNavigator, conversationStops } = await import("../src/react-app/domains/session/surface/conversation-navigator");
import type { UIMessage } from "ai";
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const messages: UIMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "Investigar mercados" }] },
  { id: "a1", role: "assistant", parts: [{ type: "reasoning", text: "Razonamiento privado" }, { type: "text", text: "Hay tres destinos posibles." }] },
  { id: "u2", role: "user", parts: [{ type: "file", mediaType: "text/csv", filename: "respuestas.csv", url: "data:text/csv;base64,PRIVADO" }] },
  { id: "a2", role: "assistant", parts: [{ type: "text", text: "Recibí la encuesta." }] },
];
beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
afterAll(async () => { await GlobalRegistrator.unregister(); });
test("previews associate answers with requests and omit reasoning and attachment contents", () => {
  expect(conversationStops(messages)).toEqual([
    { id: "u1", prompt: "Investigar mercados", reply: "Hay tres destinos posibles." },
    { id: "u2", prompt: "respuestas.csv", reply: "Recibí la encuesta." },
  ]);
});
test("keyboard reaches messages and click navigates to their stable IDs", async () => {
  const jumps: string[] = [];
  await act(async () => root.render(<ConversationNavigator messages={messages} scrollRef={{ current: null }} onNavigate={id => jumps.push(id)} />));
  const buttons = host.querySelectorAll<HTMLElement>("[data-conversation-stop]");
  await act(async () => { buttons[0].focus(); buttons[0].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })); });
  expect(document.activeElement).toBe(buttons[1]);
  await act(async () => buttons[1].click());
  expect(jumps).toEqual(["u2"]);
  await act(async () => buttons[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
  expect(document.activeElement).toBe(buttons[0]);
});
test("empty chat has no rail; partial history can retry without losing available marks", async () => {
  await act(async () => root.render(<ConversationNavigator messages={[]} scrollRef={{ current: null }} onNavigate={() => {}} />));
  expect(host.querySelector("nav")).toBeNull();
  let attempts = 0;
  await act(async () => root.render(<ConversationNavigator messages={messages} scrollRef={{ current: null }} onNavigate={() => {}}
    historyComplete={false} onLoadHistory={async () => { attempts++; if (attempts === 1) throw Error("offline"); }} />));
  const load = host.querySelector<HTMLElement>('[aria-label="Cargar toda la conversación"]')!;
  await act(async () => { load.click(); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Volvé a intentarlo");
  expect(host.querySelectorAll("[data-conversation-stop]").length).toBe(2);
  await act(async () => { load.click(); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(attempts).toBe(2);
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

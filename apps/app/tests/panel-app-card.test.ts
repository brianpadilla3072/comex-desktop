import { expect, test } from "bun:test";
import { createV2EventTranslationState, translateV2Event } from "../src/app/lib/opencode-v2-adapter";

/** The last link between the engine and the chat card for the panel App: a v2 tool result whose
 *  metadata carries `openworkMcpResult` (what the results plugin preserves for a direct
 *  first-party App call) must reach the app as the part metadata the frame reads. Without this,
 *  the panel App could be served and resolvable and still never open in the conversation. */

const location = { directory: "/tmp/panel-app-card" };
const sessionID = "ses_panel_app_card";
const data = {
  sessionID,
  assistantMessageID: "msg_panel_app",
  callID: "call_panel_app",
  tool: "openwork-panels_dashboard_render",
  input: { panel: "cierres" },
};
const payload = { ok: true, panel: "cierres", title: "Cierres de soja", source: "file:precios.json", refreshedAt: 1, blocks: [{ type: "stat", field: "cierre", value: 489 }] };
const preserved = {
  content: [{ type: "text", text: "Panel con 1 bloque." }],
  structuredContent: payload,
  _meta: { ui: { resourceUri: "ui://openwork/panel/v1" } },
};

test("a direct panel App result reaches the part metadata the chat frame reads", () => {
  const state = createV2EventTranslationState();
  const events = [
    ...(translateV2Event({ type: "session.tool.input.started", created: 5, location, data: { sessionID, assistantMessageID: data.assistantMessageID, callID: data.callID, name: data.tool } }, state) ?? []),
    ...(translateV2Event({ type: "session.tool.called", created: 10, location, data }, state) ?? []),
    ...(translateV2Event({ type: "session.tool.success", created: 20, location, data: { ...data, metadata: { openworkMcpResult: preserved } } }, state) ?? []),
  ];
  const parts = events.flatMap(event => event.type === "message.part.updated" ? [event.properties.part] : []);
  expect(parts.length).toBeGreaterThan(0);
  const completed = parts.find(part => part.state.status === "completed");
  expect(completed).toBeDefined();
  if (!completed || completed.state.status !== "completed") return;
  expect(completed.tool).toBe("openwork-panels_dashboard_render");
  const metadata = completed.state.metadata as { openworkMcpResult?: { structuredContent?: unknown; _meta?: { ui?: { resourceUri?: string } } } };
  expect(metadata.openworkMcpResult?.structuredContent).toEqual(payload);
  expect(metadata.openworkMcpResult?._meta?.ui?.resourceUri).toBe("ui://openwork/panel/v1");
});

test("an ordinary tool result of the same server carries no App metadata", () => {
  const state = createV2EventTranslationState();
  const plain = { ...data, tool: "openwork-panels_panel_list" };
  const events = [
    ...(translateV2Event({ type: "session.tool.input.started", created: 5, location, data: { sessionID, assistantMessageID: plain.assistantMessageID, callID: plain.callID, name: plain.tool } }, state) ?? []),
    ...(translateV2Event({ type: "session.tool.called", created: 10, location, data: plain }, state) ?? []),
    ...(translateV2Event({ type: "session.tool.success", created: 20, location, data: { ...plain, metadata: {} } }, state) ?? []),
  ];
  const parts = events.flatMap(event => event.type === "message.part.updated" ? [event.properties.part] : []);
  const completed = parts.find(part => part.state.status === "completed");
  if (!completed || completed.state.status !== "completed") throw new Error("no completed part");
  const metadata = completed.state.metadata as { openworkMcpResult?: unknown };
  expect(metadata.openworkMcpResult).toBeUndefined();
});

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useCompanionHost } from "../../src/react-app/domains/desktop-companion/use-companion-host";
import { CompanionRecentsBridge } from "../../src/react-app/domains/desktop-companion/companion-recents-bridge";
import { useSessionActivityStore } from "../../src/react-app/domains/session/status/session-activity-store";
import type { CompanionSnapshot } from "../../src/app/lib/desktop-companion";

declare global { interface Window { __companionPerformance?: { working: (value: boolean) => void; snapshots: number; ready: boolean } } }
const workspace = { id: "performance-workspace", name: "Fixture", path: "/fixture", preset: "starter", workspaceType: "local" } satisfies import("../../src/app/types").WorkspaceSessionGroup["workspace"];
function PerformanceHost() {
  const [working, setWorking] = useState(false), [text, setText] = useState("Respuesta de prueba.");
  useEffect(() => {
    window.__companionPerformance = { working: setWorking, snapshots: 0, ready: true };
    useSessionActivityStore.getState().recordAssistantResponse(workspace.id, "fixture", Date.now() - 1000);
    return () => { delete window.__companionPerformance; };
  }, []);
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => { setText(value => value + " texto"); useSessionActivityStore.getState().markAssistantOutput(workspace.id, "fixture", undefined, { allowUnknownMessageRole: true, markDeltaProgress: true }); }, 50);
    useSessionActivityStore.getState().setRunStatus(workspace.id, "fixture", "running");
    return () => { clearInterval(timer); useSessionActivityStore.getState().setRunStatus(workspace.id, "fixture", "idle"); };
  }, [working]);
  const snapshot = (): Omit<CompanionSnapshot, "target"> => {
    if (window.__companionPerformance) window.__companionPerformance.snapshots++;
    return { sessionId: "fixture", workspaceId: workspace.id, title: "Fixture", project: "Fixture", model: "Fixture", state: working ? "working" : "idle", canSend: !working, messages: [{ id: "answer", role: "assistant", text }], activity: [], permission: null, question: null };
  };
  useCompanionHost({ active: true, owner: "performance-owner", scope: "performance", urgentKey: String(working), snapshot: detail => { const value = snapshot(); return { ...value, messages: detail ? value.messages : [] }; }, execute: async () => ({ ok: true }) });
  return <CompanionRecentsBridge source={{ draftScope: "performance", selectedWorkspaceId: workspace.id, selectedSessionId: "fixture", workspaceSessionGroups: [{ workspace, status: "ready", sessions: [{ id: "fixture", title: "Fixture" }] }], onOpenSession: () => {} }} />;
}
const root = document.getElementById("root"); if (root) createRoot(root).render(<PerformanceHost />);

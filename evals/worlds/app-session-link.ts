import { browserScript } from "@openwork/cdp";
import { evalIn } from "@openwork/behaviors";
import type { Seed } from "@openwork/env";
import { z } from "zod";

export async function appSessionLinkWorld(seed: Seed) {
  const app = await seed.desktop({
    name: "app-session-link",
    signIn: false,
    env: {
      OPENWORK_ELECTRON_SKIP_WORKSPACE_BUILD: "1",
      OPENWORK_ELECTRON_SKIP_NATIVE_REBUILD: "1",
    },
  });
  const workspace = z.object({ workspaceId: z.string().min(1) }).parse(await evalIn(app, async () => {
    const state = await window.__OPENWORK_ELECTRON__.invokeDesktop("workspaceBootstrap");
    if (!state.selectedId) throw new Error("The default workspace was not selected");
    return { workspaceId: state.selectedId };
  }, { awaitPromise: true }));
  // Browser control needs a requesting conversation; create one through the
  // server API instead of the control rail (the first-run dialog blocks it).
  const session = z.object({ sessionId: z.string().min(1) }).parse(await evalIn(app, browserScript(async (workspaceId: string) => {
    const info = await window.__OPENWORK_ELECTRON__.invokeDesktop("openworkServerInfo");
    const response = await fetch(`${info.baseUrl}/workspace/${encodeURIComponent(workspaceId)}/opencode/session`, {
      method: "POST",
      headers: { Authorization: `Bearer ${info.ownerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Handoff target" }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Session creation failed: ${response.status}`);
    const created = await response.json();
    if (typeof created.id !== "string") throw new Error("Session response had no id");
    return { sessionId: created.id };
  }, [workspace.workspaceId]), { awaitPromise: true }));

  return {
    app,
    workspace,
    session,
    async showSettings() {
      return evalIn(app, () => { location.hash = "#/settings/general"; });
    },
    async workspaceLinkUrl() {
      return evalIn(app, browserScript(async (workspaceId: string, targetSessionId: string) => (
        `${window.location.origin}/#/workspace/${encodeURIComponent(workspaceId)}/session/${encodeURIComponent(targetSessionId)}`
      ), [workspace.workspaceId, session.sessionId]), { awaitPromise: true });
    },
  };
}

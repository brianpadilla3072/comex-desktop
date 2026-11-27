import { expect } from "vitest";
import { spec } from "@openwork/testkit";
import type { BrowserTaskInput } from "@openwork/testkit";
import { appSessionLinkWorld } from "../worlds/app-session-link";

const test = spec.world(appSessionLinkWorld, {
  timeout: 300_000,
  needs: { placement: "local" },
  resources: { surfaces: ["desktop"], services: [], nativeReason: "The link handoff starts in Electron's built-in browser view and navigates the main renderer." },
});

test("a workspace link opened in the built-in browser lands in the main window instead of /welcome", async ({ world, user, agent, probe, step, evidence }) => {
  await user.resizeViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  const task = (operation: BrowserTaskInput["operation"], args: BrowserTaskInput["args"] = {}) => agent.browserTask({ sessionId: world.session.sessionId, operation, args });
  const target = `#/workspace/${encodeURIComponent(world.workspace.workspaceId)}/session/${encodeURIComponent(world.session.sessionId)}`;

  await step("before: the main window is not on the target workspace", async () => {
    await world.showSettings();
    await probe.eventually(() => probe.hash(), { within: 10_000, label: "left the workspace route", until: hash => hash !== target }).catch(() => undefined);
    const hash = await probe.hash();
    const leftTarget = hash !== target;
    evidence.recordAssertionEvidence("The main window is not on the target workspace yet", hash, leftTarget);
    expect(leftTarget).toBe(true);
  });

  await step("the built-in browser tool hands the link off and does not leave a broken tab", async () => {
    const url = await world.workspaceLinkUrl();
    expect(url).toContain("/#/workspace/");
    const opened = await task("open", { url, provider: "builtin" });
    expect(opened.ok, JSON.stringify(opened)).toBe(true);
    expect(opened.handoff).toBe(true);
    expect(opened.next).toBe("none");
    if (!opened.tabId) throw new Error("The browser tool returned no tab for the handoff.");
    const observed = await task("observe", { tabId: opened.tabId });
    expect(observed.ok).toBe(false);
    expect(observed.code).toBe("app_link_handed_off");
    await probe.eventually(() => probe.hash(), { within: 15_000, label: "main window receives the workspace route", until: hash => hash === target });
  });

  await step("after: the main window shows the requested workspace and never loads /welcome", async () => {
    const hash = await probe.hash();
    expect(hash).toBe(target);
    expect(hash).not.toBe("#/welcome");
    evidence.recordAssertionEvidence("The requested workspace route opened in the main renderer", hash, hash === target && hash !== "#/welcome");
    await user.reload();
    await probe.eventually(() => probe.hash(), { within: 15_000, label: "workspace route survives reload", until: hash => hash === target });
  });
});

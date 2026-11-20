/** @jsxImportSource react */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, describe, expect, test } from "bun:test";

// The DOM must exist before React loads: bun shares modules between test files, and a
// react-dom first loaded without a DOM breaks every later render in the same run.
const ownedDom = typeof window === "undefined";
if (ownedDom) GlobalRegistrator.register({ url: "http://localhost/" });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { renderToStaticMarkup } = await import("react-dom/server");
const { OpenworkServerError } = await import("../src/app/lib/openwork-server");
import type { OpenworkPendingApproval } from "../src/app/lib/openwork-server";
const { answerWebApproval, loadWebApprovals, WebApprovalsPanel, WebApprovalsResponder } = await import("../src/react-app/domains/connections/web-approvals");
import type { WebApprovalsClient } from "../src/react-app/domains/connections/web-approvals";
const { isDesktopRuntime } = await import("../src/app/utils");

const previousAct = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
afterAll(async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousAct);
  if (ownedDom) await GlobalRegistrator.unregister();
});

const pending: OpenworkPendingApproval = {
  id: "apr_1",
  workspaceId: "ws_1",
  action: "skills.upsert",
  summary: "Upsert skill reporte",
  paths: ["/workspace/.opencode/skills/reporte/SKILL.md"],
  createdAt: 1,
  actor: { type: "remote", scope: "collaborator" },
};

function fakeClient(options: { mode?: "manual" | "auto"; listStatus?: number; items?: OpenworkPendingApproval[]; respondStatus?: number }) {
  const replies: Array<{ id: string; reply: "allow" | "deny" }> = [];
  let items = options.items ?? [pending];
  const client: WebApprovalsClient = {
    status: async () => ({ approval: { mode: options.mode ?? "manual" } }),
    listApprovals: async () => {
      if (options.listStatus) throw new OpenworkServerError(options.listStatus, "unauthorized", "Invalid host token");
      return { items };
    },
    respondApproval: async (id, reply) => {
      replies.push({ id, reply });
      if (options.respondStatus) throw new OpenworkServerError(options.respondStatus, "approval_not_found", "gone");
      items = items.filter((item) => item.id !== id);
      return { ok: true, allowed: reply === "allow" };
    },
  };
  return { client, replies };
}

describe("web approvals model", () => {
  test("owner access lists pending approvals; collaborator access is read-only", async () => {
    expect(await loadWebApprovals(fakeClient({}).client)).toEqual({ kind: "owner", items: [pending] });
    expect(await loadWebApprovals(fakeClient({ listStatus: 401 }).client)).toEqual({ kind: "read-only" });
  });

  test("auto mode needs no responder and no notice", async () => {
    const { client } = fakeClient({ mode: "auto", listStatus: 401 });
    expect(await loadWebApprovals(client)).toEqual({ kind: "idle" });
  });

  test("an approval that already expired counts as answered; other failures surface", async () => {
    await answerWebApproval(fakeClient({ respondStatus: 404 }).client, "apr_1", "allow");
    await expect(answerWebApproval(fakeClient({ respondStatus: 500 }).client, "apr_1", "allow")).rejects.toThrow();
  });
});

describe("web approvals panel", () => {
  test("shows the change with approve and deny", () => {
    const html = renderToStaticMarkup(<WebApprovalsPanel state={{ kind: "owner", items: [pending] }} onRespond={() => {}} />);
    expect(html).toContain("Approve this change?");
    expect(html).toContain("Upsert skill reporte");
    expect(html).toContain("/workspace/.opencode/skills/reporte/SKILL.md");
    expect(html).toContain("Approve");
    expect(html).toContain("Deny");
  });

  test("renders nothing with no pending approvals or in auto mode", () => {
    expect(renderToStaticMarkup(<WebApprovalsPanel state={{ kind: "owner", items: [] }} />)).toBe("");
    expect(renderToStaticMarkup(<WebApprovalsPanel state={{ kind: "idle" }} />)).toBe("");
  });

  test("read-only connections get a clear notice that can be dismissed", () => {
    const html = renderToStaticMarkup(<WebApprovalsPanel state={{ kind: "read-only" }} />);
    expect(html).toContain("This connection can&#x27;t approve changes");
    expect(html).toContain("Pair this device");
    expect(renderToStaticMarkup(<WebApprovalsPanel state={{ kind: "read-only" }} noticeDismissed />)).toBe("");
  });
});

async function mountResponder(client: WebApprovalsClient) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const getClient = async () => client;
  await act(async () => {
    root.render(<WebApprovalsResponder getClient={getClient} pollMs={60_000} />);
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === label);
  if (!found) throw new Error(`button ${label} not found`);
  return found;
}

describe("web approvals responder (non-desktop runtime)", () => {
  test("runs outside the desktop shell", () => {
    expect(isDesktopRuntime()).toBe(false);
  });

  test("approve sends allow and removes the card", async () => {
    const { client, replies } = fakeClient({});
    const container = await mountResponder(client);
    expect(container.textContent).toContain("Upsert skill reporte");
    await act(async () => { button(container, "Approve").click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(replies).toEqual([{ id: "apr_1", reply: "allow" }]);
    expect(container.textContent).not.toContain("Upsert skill reporte");
  });

  test("deny sends deny", async () => {
    const { client, replies } = fakeClient({});
    const container = await mountResponder(client);
    await act(async () => { button(container, "Deny").click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(replies).toEqual([{ id: "apr_1", reply: "deny" }]);
  });

  test("a failed answer keeps the card and says so", async () => {
    const { client } = fakeClient({ respondStatus: 500 });
    const container = await mountResponder(client);
    await act(async () => { button(container, "Approve").click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(container.textContent).toContain("Upsert skill reporte");
    expect(container.textContent).toContain("Couldn't send your answer");
  });

  test("a collaborator connection shows the read-only notice", async () => {
    const container = await mountResponder(fakeClient({ listStatus: 401 }).client);
    expect(container.textContent).toContain("This connection can't approve changes");
    await act(async () => { button(container, "").click(); });
    expect(container.textContent).not.toContain("This connection can't approve changes");
  });
});

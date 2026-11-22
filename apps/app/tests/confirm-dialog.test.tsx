/** @jsxImportSource react */
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://localhost/" });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ConfirmDialogHost, confirmDialog } = await import("../src/components/ui/confirm-dialog");

// window.confirm froze the renderer and every CDP client (hive QA w5-10); the in-app dialog replaces it.
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
afterAll(async () => { await GlobalRegistrator.unregister(); });
const button = (label: string) => [...document.querySelectorAll("button")].find(element => element.textContent === label);
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
/** The dialog renders in a portal after its open animation frame: wait for it, up to 2 s. */
async function waitForText(text: string) {
  for (let attempt = 0; attempt < 100 && !(document.body.textContent ?? "").includes(text); attempt += 1) await flush();
}

test("without a mounted host the answer is no instead of hanging", async () => {
  expect(await confirmDialog({ title: "¿Quitar?" })).toBe(false);
});

test("confirm and cancel resolve the promise, and requests queue one at a time", async () => {
  await act(async () => root.render(<ConfirmDialogHost />));
  const first = confirmDialog({ title: "¿Quitar el workspace?", confirmLabel: "Quitar", destructive: true });
  const second = confirmDialog({ title: "¿Otra cosa?", confirmLabel: "Sí" });
  await waitForText("¿Quitar el workspace?");
  expect(document.body.textContent).toContain("¿Quitar el workspace?");
  expect(document.body.textContent).not.toContain("¿Otra cosa?");
  await act(async () => button("Quitar")?.click());
  expect(await first).toBe(true);
  await waitForText("¿Otra cosa?");
  expect(document.body.textContent).toContain("¿Otra cosa?");
  await act(async () => button("Cancel")?.click());
  expect(await second).toBe(false);
});

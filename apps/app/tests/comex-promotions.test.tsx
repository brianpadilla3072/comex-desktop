/** @jsxImportSource react */
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://localhost/" });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ShellConfigProvider, useShellConfig } = await import("../src/react-app/shell/shell-config");
const { CloudSignInBanner } = await import("../src/react-app/domains/cloud/cloud-sign-in-banner");
const { setOpenworkPromotionsEnabled } = await import("../src/react-app/domains/cloud/openwork-promotions-flag");
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
function Probe() {
  const { config } = useShellConfig();
  return <><output>{JSON.stringify({ cloudSignin: config.cloudSignin, docs: config.docsButton, feedback: config.feedbackButton, models: config.modelPicker })}</output><CloudSignInBanner media={<span>Cloud</span>} message="Promoción de prueba" onSignIn={() => {}} /></>;
}
beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear(); setOpenworkPromotionsEnabled(false);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
afterAll(async () => { await GlobalRegistrator.unregister(); });
test("false hides cloud advertising even if an older shell profile enabled every invitation", async () => {
  localStorage.setItem("openwork.shell-config", JSON.stringify({ cloudSignin: true, docsButton: true, feedbackButton: true }));
  await act(async () => root.render(<ShellConfigProvider><Probe /></ShellConfigProvider>));
  expect(host.textContent).not.toContain("Promoción de prueba");
  expect(JSON.parse(host.querySelector("output")!.textContent!)).toEqual({ cloudSignin: false, docs: false, feedback: false, models: true });
});
test("true restores invitations; switching back to false removes them without losing provider controls", async () => {
  await act(async () => root.render(<ShellConfigProvider><Probe /></ShellConfigProvider>));
  await act(async () => setOpenworkPromotionsEnabled(true));
  expect(host.textContent).toContain("Promoción de prueba");
  expect(JSON.parse(host.querySelector("output")!.textContent!).cloudSignin).toBe(true);
  await act(async () => setOpenworkPromotionsEnabled(false));
  expect(host.textContent).not.toContain("Promoción de prueba");
  expect(JSON.parse(host.querySelector("output")!.textContent!).models).toBe(true);
});

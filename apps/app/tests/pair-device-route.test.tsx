/** @jsxImportSource react */
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://localhost/pair?code=ABCD-2345" });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router");
const { BootStateProvider, useBootState } = await import("../src/react-app/shell/boot-state");
const { PairDeviceRoute } = await import("../src/react-app/shell/pair-device-route");

// The boot overlay waits for a route to call markRouteReady. /pair mounts no session route, so the
// overlay stayed on top of the form and real clicks never reached "Vincular dispositivo".
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
afterAll(async () => { await GlobalRegistrator.unregister(); });

let ready = false;
function ReadyProbe() { ready = useBootState().routeReady; return null; }

test("the pairing screen releases the boot overlay and prefills the code from the link", async () => {
  await act(async () => root.render(<BootStateProvider><MemoryRouter initialEntries={["/pair?code=ABCD-2345"]}><PairDeviceRoute /><ReadyProbe /></MemoryRouter></BootStateProvider>));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(ready).toBe(true);
  expect(host.querySelector<HTMLInputElement>("#pair-code")?.value).toBe("ABCD-2345");
});

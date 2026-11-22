/** @jsxImportSource react */
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const ownsDom = !GlobalRegistrator.isRegistered;
if (ownsDom) GlobalRegistrator.register({ url: "http://localhost/" });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter, useLocation, useNavigate } = await import("react-router");
const { SidebarProvider } = await import("../src/components/ui/sidebar");
const { CompactSidebarNav } = await import("../src/react-app/domains/session/sidebar/compact-sidebar-nav");
const { flaggedDestinationHandler, flaggedDestinationReachable } = await import("../src/react-app/shell/flagged-destination");
const { t } = await import("../src/i18n");
type FlagAvailability = import("../src/react-app/shell/flagged-destination").FlagAvailability;

// Right after startup the command center and results inbox flags are still
// loading. The entries used to get no handler then, so early clicks did
// nothing. A visible entry must always navigate; the route redirects home only
// once the server answers "off".

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
afterAll(async () => {
  if (ownsDom) await GlobalRegistrator.unregister();
});

const LOADING: FlagAvailability = { enabled: false, known: false };
const ON: FlagAvailability = { enabled: true, known: true };
const OFF: FlagAvailability = { enabled: false, known: true };

function Rail({ commandCenter, resultsInbox }: { commandCenter: FlagAvailability; resultsInbox: FlagAvailability }) {
  const navigate = useNavigate();
  const location = useLocation();
  return <SidebarProvider defaultOpen={false}>
    <output>{location.pathname}</output>
    <CompactSidebarNav
      onNewTask={() => {}}
      onExtensions={() => {}}
      onCommandCenter={flaggedDestinationHandler(commandCenter, () => navigate("/command-center"))}
      onResultsInbox={flaggedDestinationHandler(resultsInbox, () => navigate("/inbox"))}
    />
  </SidebarProvider>;
}

async function render(commandCenter: FlagAvailability, resultsInbox: FlagAvailability) {
  await act(async () => root.render(<MemoryRouter initialEntries={["/"]}><Rail commandCenter={commandCenter} resultsInbox={resultsInbox} /></MemoryRouter>));
}

const button = (label: string) => host.querySelector<HTMLElement>(`button[aria-label="${label}"]`);
const pathname = () => host.querySelector("output")?.textContent;

test("a click on the command center while its flag is loading navigates", async () => {
  await render(LOADING, LOADING);
  await act(async () => button(t("command_center.nav"))?.click());
  expect(pathname()).toBe("/command-center");
});

test("a click on the results inbox while its flag is loading navigates", async () => {
  await render(LOADING, LOADING);
  await act(async () => button(t("results_inbox.nav"))?.click());
  expect(pathname()).toBe("/inbox");
});

test("entries stay hidden once the server says the flag is off", async () => {
  await render(OFF, OFF);
  expect(button(t("command_center.nav"))).toBeNull();
  expect(button(t("results_inbox.nav"))).toBeNull();
});

test("the route stays reachable until the server answered off", () => {
  expect(flaggedDestinationReachable(LOADING)).toBe(true);
  expect(flaggedDestinationReachable(ON)).toBe(true);
  expect(flaggedDestinationReachable(OFF)).toBe(false);
});

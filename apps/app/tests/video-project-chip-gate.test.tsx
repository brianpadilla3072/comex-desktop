/** @jsxImportSource react */
/**
 * The video icon above the chat must follow the same switch as the sidebar
 * section (Settings › Video › "Show the Video panel"), so turning the section
 * off removes both entries instead of leaving the icon behind.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, mock } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const ownsDom = !GlobalRegistrator.isRegistered;
if (ownsDom) GlobalRegistrator.register({ url: "http://localhost/" });

const workspace = {
  workspaceId: "ws_fixture",
  selectedWorkspaceRoot: "J:/fixture",
  openworkServerClient: {
    getVideoProjects: async () => ({
      projects: [
        {
          slug: "prueba",
          root: "video-projects/prueba",
          project: { title: "Prueba" },
          hasStyle: true,
          hasStoryboard: false,
          hasStill: false,
          hasFinal: false,
        },
      ],
      workspaceRoot: "J:/fixture",
      videoStudio: true,
    }),
  },
};

mock.module("@/react-app/shell/workspace-provider", () => ({
  useWorkspaceMaybe: () => workspace,
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { VideoProjectChip } = await import("../src/react-app/domains/video/video-project-chip");
const { useUiStateStore } = await import("../src/react-app/shell/ui-state-store");

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let cache: InstanceType<typeof QueryClient>;

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

function chipButton() {
  return Array.from(host.querySelectorAll("button")).find((button) =>
    (button.getAttribute("aria-label") ?? "").includes("panel de video"),
  ) ?? null;
}

beforeAll(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
});

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  useUiStateStore.setState({ videoSidebarSectionVisible: true });
});

afterEach(async () => {
  await act(async () => root.unmount());
  cache.clear();
});

afterAll(async () => {
  if (ownsDom) await GlobalRegistrator.unregister();
});

async function renderChip() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={cache}>
        <VideoProjectChip sessionId="ses_chat" />
      </QueryClientProvider>,
    );
  });
  await flush();
}

test("con la sección activada se ve el icono sobre el chat", async () => {
  await renderChip();
  expect(chipButton()).not.toBeNull();
});

test("apagar la sección de video en Preferencias oculta el icono", async () => {
  await renderChip();
  expect(chipButton()).not.toBeNull();
  await act(async () => {
    useUiStateStore.getState().setVideoSidebarSectionVisible(false);
  });
  await flush();
  expect(chipButton()).toBeNull();
});

test("volver a prenderla devuelve el icono", async () => {
  useUiStateStore.setState({ videoSidebarSectionVisible: false });
  await renderChip();
  expect(chipButton()).toBeNull();
  await act(async () => {
    useUiStateStore.getState().setVideoSidebarSectionVisible(true);
  });
  await flush();
  expect(chipButton()).not.toBeNull();
});

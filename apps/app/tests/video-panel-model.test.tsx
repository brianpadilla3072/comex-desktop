/** @jsxImportSource react */
/**
 * The video panel must let the person pick the model of each video's chat.
 * This mounts the real panel with a fixture workspace and checks that:
 *  - the model of the video is shown (stored in project.json, not the app default),
 *  - opening the selector renders the shared model picker,
 *  - choosing a model saves it in that video's project.json.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { mock } from "bun:test";

const ownsDom = !GlobalRegistrator.isRegistered;
if (ownsDom) GlobalRegistrator.register({ url: "http://localhost/" });

// The real providers need the desktop bridge, which does not exist in this
// mount. These stubs answer exactly what the panel and the model picker read.
mock.module("@/react-app/domains/cloud/desktop-config-provider", () => ({
  DesktopConfigProvider: ({ children }: { children: unknown }) => children,
  useDesktopConfig: () => ({ config: null, loading: false, error: null }),
  useOrgRestrictions: () => ({}),
  useCheckDesktopRestriction: () => () => false,
  useDesktopRestriction: () => false,
  useComexWorkspaceEnabled: () => true,
  useConversationNavigatorEnabled: () => false,
  useAgentActivityMapEnabled: () => false,
  useComexModelGuideEnabled: () => false,
  useComexTaskSoundEnabled: () => false,
  useComexVideoStudioEnabled: () => true,
  resolveConnectStateToPush: () => null,
}));
mock.module("@/react-app/domains/session/status/use-desktop-feature", () => ({
  useDesktopFeature: () => false,
}));
mock.module("@/react-app/domains/cloud/auto-access-ui", () => ({
  useAutoAccess: () => ({ query: { data: undefined, isPending: false, fetchStatus: "idle" }, refreshing: false, refresh: () => undefined }),
  useObservedAutoAccessSnapshot: () => undefined,
  useObservedAutoAccessStatus: () => undefined,
  openAutoProviderSettings: () => undefined,
  openAutoUpdate: () => undefined,
  openAutoSignIn: () => undefined,
  autoAccessStatusQueryKey: () => ["auto-access"],
  AutoPickerRecovery: () => null,
  AutoAccessFooter: () => null,
  AutoAccessNotice: () => null,
  AutoRejectedTurnRecoveryBridge: () => null,
}));
mock.module("@/react-app/domains/connections/provider-auth/gateway-model-access", () => ({
  useGatewayModelSelection: () => ({
    options: [],
    disabledProviders: [] as string[],
    loginOpen: false,
    select: (_option: unknown, commit: () => void) => {
      commit();
      return () => undefined;
    },
  }),
  GatewayModelAccessProvider: ({ children }: { children: unknown }) => children,
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { MemoryRouter } = await import("react-router");
const { VideoPanel } = await import("../src/react-app/domains/video/video-panel");
const { createOpenworkServerClient } = await import("../src/app/lib/openwork-server");
const { DenAuthProvider } = await import("@/react-app/domains/cloud/den-auth-provider");
const { PlatformProvider, createDefaultPlatform } = await import("@/react-app/kernel/platform");

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let cache: InstanceType<typeof QueryClient>;

const files = new Map<string, string>();

const openwork = {
  ...createOpenworkServerClient({ baseUrl: "http://localhost/openwork" }),
  getVideoProjects: async () => ({
    projects: [
      {
        slug: "prueba",
        root: "video-projects/prueba",
        project: { title: "Prueba" },
        hasStyle: true,
        hasStoryboard: true,
        hasStill: false,
        hasFinal: false,
        style: { palette: ["#111"] },
        cue: { beats: [{ at: 0, text: "hola" }] },
      },
    ],
    workspaceRoot: "J:/fixture",
    videoStudio: true,
  }),
  readWorkspaceFile: async (_workspaceId: string, path: string) => {
    const content = files.get(path);
    if (content === undefined) throw new Error("missing");
    return { path, content, bytes: content.length, updatedAt: 1 };
  },
  writeWorkspaceFile: async (_workspaceId: string, payload: { path: string; content: string }) => {
    files.set(payload.path, payload.content);
    return { ok: true, path: payload.path, bytes: payload.content.length, updatedAt: 2 };
  },
  statWorkspaceFile: async (_workspaceId: string, path: string) => ({
    ok: files.has(path),
    path,
    exists: files.has(path),
    kind: "file" as const,
    size: 1,
    updatedAt: 1,
  }),
  listWorkspaceFiles: async () => ({
    items: [
      { path: "voices/dylan/referencia.webm", kind: "file", size: 1, mtimeMs: 1, revision: "1" },
      { path: "voices/dylan/consentimiento.md", kind: "file", size: 1, mtimeMs: 1, revision: "1" },
      { path: "voices/dylan/perfil.json", kind: "file", size: 1, mtimeMs: 1, revision: "1" },
      { path: "video-projects/prueba/inspiracion/refs/ref-01.mp4", kind: "file", size: 1, mtimeMs: 1, revision: "1" },
      { path: "video-library/references/mias/ref-01.mp4", kind: "file", size: 1, mtimeMs: 1, revision: "1" },
    ],
    total: 5,
    truncated: false,
  }),
  getVideoProject: async () => null,
};

const providers = {
  providers: [
    { id: "opencode", name: "Personal / OpenCode", models: { "big-pickle": { id: "big-pickle", name: "Big Pickle" } } },
    { id: "opencode-go", name: "OpenCode Go", models: { "qwen4-max": { id: "qwen4-max", name: "Qwen 4 Max" } } },
  ],
  connected: ["opencode", "opencode-go"],
  default: { opencode: "big-pickle" },
};

const opencode = {
  config: {
    providers: async () => ({ data: providers }),
  },
  provider: {
    list: async () => ({ data: providers }),
  },
} as never;

const workspace = {
  client: opencode,
  opencodeBaseUrl: "http://127.0.0.1:1/opencode",
  openworkServerClient: openwork as never,
  workspaceId: "ws_fixture",
  selectedWorkspaceRoot: "J:/fixture",
};

function buttonByText(text: string) {
  const element = Array.from(host.querySelectorAll("button")).find((item) => (item.textContent ?? "").includes(text));
  if (!element) throw new Error(`Missing button containing ${text}`);
  return element;
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

beforeAll(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
});

beforeEach(() => {
  files.clear();
  localStorage.clear();
  document.body.innerHTML = "";
  files.set(
    "video-projects/prueba/project.json",
    JSON.stringify({
      title: "Prueba",
      chatSessionId: "ses_chat",
      chatModel: { providerID: "opencode-go", modelID: "qwen4-max" },
    }),
  );
  files.set(
    "video-projects/prueba/cue-sheet.json",
    JSON.stringify({ meta: { slug: "prueba", voice: "vieja" }, beats: [] }),
  );
  files.set(
    "video-library/references.json",
    JSON.stringify({
      version: 1,
      sets: [{ id: "mias", name: "mias", refs: 1, updatedAt: "2026-11-23" }],
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});

afterEach(async () => {
  await act(async () => root.unmount());
  cache.clear();
});

afterAll(async () => {
  if (ownsDom) await GlobalRegistrator.unregister();
});

async function renderPanel() {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <PlatformProvider value={createDefaultPlatform()}>
          <DenAuthProvider>
            <QueryClientProvider client={cache}>
              <VideoPanel
                workspace={workspace as never}
                endpoint={{ opencodeBaseUrl: "http://127.0.0.1:1/opencode", token: "token" }}
              />
            </QueryClientProvider>
          </DenAuthProvider>
        </PlatformProvider>
      </MemoryRouter>,
    );
  });
  await flush();
}

test("muestra el modelo guardado del video", async () => {
  await renderPanel();
  expect(host.textContent).toContain("Modelo:");
  expect(host.textContent).toContain("qwen4-max");
  expect(host.textContent).not.toContain("(de la app)");
});

test("abre el selector de modelos", async () => {
  await renderPanel();
  await act(async () => {
    buttonByText("Modelo:").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await flush();
  expect(document.body.querySelector('[data-testid="all-models-picker"]')).not.toBeNull();
});

test("elegir un modelo lo guarda en el project.json del video", async () => {
  await renderPanel();
  await act(async () => {
    buttonByText("Modelo:").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await flush();
  const option = Array.from(document.body.querySelectorAll<HTMLElement>("[role='option'], button"))
    .find((element) => (element.textContent ?? "").includes("Big Pickle"));
  expect(option).toBeDefined();
  await act(async () => {
    option?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await flush();
  await flush();
  const saved = JSON.parse(files.get("video-projects/prueba/project.json") ?? "{}") as {
    chatModel?: { providerID?: string; modelID?: string };
  };
  expect(saved.chatModel?.modelID).toBe("big-pickle");
});

function bodyButton(text: string) {
  const element = Array.from(document.body.querySelectorAll("button"))
    .find((item) => (item.textContent ?? "").includes(text));
  if (!element) throw new Error(`Missing body button ${text}`);
  return element;
}

async function openStudio() {
  await act(async () => {
    buttonByText("Estudio").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await flush();
  await flush();
}

test("Estudio lista las voces clonadas del workspace", async () => {
  await renderPanel();
  await openStudio();
  const text = document.body.textContent ?? "";
  expect(text).toContain("Estudio");
  expect(text).toContain("dylan");
  expect(text).toContain("1 referencias en inspiracion/refs/");
});

test("Estudio muestra la biblioteca propia del workspace", async () => {
  await renderPanel();
  await openStudio();
  const text = document.body.textContent ?? "";
  expect(text).toContain("video-library/");
  expect(text).toContain("mias");
  expect(text).toContain("propia");
});

test("elegir voz la guarda como predeterminada del workspace", async () => {
  await renderPanel();
  await openStudio();
  await act(async () => {
    bodyButton("dylan").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await flush();
  await flush();
  const saved = JSON.parse(files.get("video-settings.json") ?? "{}") as { voice?: string };
  expect(saved.voice).toBe("dylan");
});

test("usar la voz en este video escribe el cue-sheet del proyecto", async () => {
  await renderPanel();
  await openStudio();
  await act(async () => {
    bodyButton("dylan").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await flush();
  await flush();
  await act(async () => {
    bodyButton("Usar en este video").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await flush();
  await flush();
  const cue = JSON.parse(files.get("video-projects/prueba/cue-sheet.json") ?? "{}") as {
    meta?: { voice?: string };
  };
  expect(cue.meta?.voice).toBe("dylan");
});

/** A button whose whole label is `text`, so "Guardar" never matches "Guardar y pedir render". */
function exactButton(text: string) {
  const element = Array.from(host.querySelectorAll("button"))
    .find((item) => (item.textContent ?? "").trim() === text);
  if (!element) throw new Error(`Missing exact button ${text}`);
  return element;
}

async function click(node: Element) {
  await act(async () => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await flush();
}

test("las opciones tocadas quedan marcadas como sin guardar", async () => {
  await renderPanel();
  expect(host.textContent).not.toContain("Sin guardar");
  expect((exactButton("Guardar") as HTMLButtonElement).disabled).toBe(true);
  await click(exactButton("1:1"));
  expect(host.textContent).toContain("Sin guardar");
  expect((exactButton("Guardar") as HTMLButtonElement).disabled).toBe(false);
});

test("guardar escribe el formato elegido en el style.json del video", async () => {
  await renderPanel();
  await click(exactButton("1:1"));
  await click(exactButton("Guardar"));
  await flush();
  const style = JSON.parse(files.get("video-projects/prueba/style.json") ?? "{}") as {
    format?: { aspect?: string };
  };
  expect(style.format?.aspect).toBe("1:1");
});

test("el botón Nuevo video abre el pedido en un diálogo", async () => {
  await renderPanel();
  await click(exactButton("Nuevo video"));
  expect(document.body.textContent).toContain("Contá qué video querés");
});

test("el botón Chat abre y cierra el panel de conversación", async () => {
  await renderPanel();
  const chat = exactButton("Chat");
  expect(chat.getAttribute("aria-expanded")).toBe("false");
  await click(chat);
  expect(exactButton("Chat").getAttribute("aria-expanded")).toBe("true");
});


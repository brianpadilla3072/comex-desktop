/** @jsxImportSource react */
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://localhost/" });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { FolderBrowserDialog, useWebFolderPicker } = await import("../src/react-app/domains/workspace/folder-browser-dialog");
const { folderBreadcrumbs, isValidNewFolderName } = await import("../src/app/lib/web-folder-browser");

// The web app cannot open a native folder picker on the server's computer; owners browse its
// folders instead (docs/features/web-folder-browser).
type Listing = { path: string; parent: string | null; root: string; roots: Array<{ name: string; path: string }>; entries: Array<{ name: string; path: string; isGitRepo: boolean; hasOpencode: boolean }>; truncated: boolean };
const roots = [{ name: "~", path: "/srv/home" }];
const tree: Record<string, string[]> = { "/srv/home": ["Proyectos", "notas"], "/srv/home/Proyectos": ["cliente"], "/srv/home/Proyectos/cliente": [], "/srv/home/notas": [] };
function listingFor(path: string, hidden: boolean): Listing {
  const children = [...(tree[path] ?? []), ...(hidden ? [".oculta"] : [])];
  return {
    path, parent: path === "/srv/home" ? null : path.slice(0, path.lastIndexOf("/")), root: "/srv/home", roots,
    entries: children.map(name => ({ name, path: `${path}/${name}`, isGitRepo: name === "cliente", hasOpencode: false })),
    truncated: false,
  };
}
function fakeClient() {
  const calls: Array<{ path: string | null | undefined; hidden: boolean }> = [];
  const created: Array<{ parent: string; name: string }> = [];
  return {
    calls, created,
    browseFolders: async (path?: string | null, options?: { hidden?: boolean }) => {
      calls.push({ path, hidden: options?.hidden === true });
      return listingFor(path || "/srv/home", options?.hidden === true);
    },
    createFolder: async (parent: string, name: string) => {
      created.push({ parent, name });
      tree[parent] = [...(tree[parent] ?? []), name];
      tree[`${parent}/${name}`] = [];
      return { path: `${parent}/${name}` };
    },
  };
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
afterAll(async () => { await GlobalRegistrator.unregister(); });
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 100 && !check(); attempt += 1) await flush();
  expect(check()).toBe(true);
}
const buttons = () => [...document.querySelectorAll("button")];
const button = (label: string) => buttons().find(element => element.textContent?.trim() === label);
const entry = (name: string) => document.querySelector<HTMLButtonElement>(`[data-folder-entry="${name}"]`);
const crumbs = () => [...document.querySelectorAll("nav button")].map(element => element.textContent?.trim());

test("breadcrumbs go from the root to the current folder, for / and \\ paths", () => {
  expect(folderBreadcrumbs({ path: "/srv/home/a/b", root: "/srv/home", roots })).toEqual([
    { name: "~", path: "/srv/home" }, { name: "a", path: "/srv/home/a" }, { name: "b", path: "/srv/home/a/b" },
  ]);
  expect(folderBreadcrumbs({ path: "C:\\Users\\ana\\docs", root: "C:\\Users\\ana", roots: [{ name: "ana", path: "C:\\Users\\ana" }] }).map(crumb => crumb.path))
    .toEqual(["C:\\Users\\ana", "C:\\Users\\ana\\docs"]);
  expect(folderBreadcrumbs({ path: "/", root: "/", roots: [{ name: "/", path: "/" }] })).toEqual([{ name: "/", path: "/" }]);
  expect(folderBreadcrumbs({ path: "/x", root: "/", roots: [{ name: "/", path: "/" }] }).map(crumb => crumb.path)).toEqual(["/", "/x"]);
  expect(["Nuevo", "a/b", "..", " x", ""].map(isValidNewFolderName)).toEqual([true, false, false, false, false]);
});

test("navigates into folders and back with breadcrumbs, then chooses the current folder", async () => {
  const client = fakeClient();
  const chosen: string[] = [];
  let cancelled = 0;
  await act(async () => root.render(<FolderBrowserDialog open client={client} onChoose={path => chosen.push(path)} onCancel={() => { cancelled += 1; }} />));
  await waitFor(() => entry("Proyectos") !== null);
  expect(entry("notas")).not.toBeNull();
  expect(entry(".oculta")).toBeNull();

  await act(async () => entry("Proyectos")?.click());
  await waitFor(() => entry("cliente") !== null);
  expect(crumbs()).toEqual(["~", "Proyectos"]);
  expect(document.body.textContent).toContain("Git");

  await act(async () => entry("cliente")?.click());
  await waitFor(() => crumbs().length === 3);
  expect(document.body.textContent).toContain("This folder has no subfolders");

  await act(async () => buttons().find(element => element.closest("nav") && element.textContent === "Proyectos")?.click());
  await waitFor(() => entry("cliente") !== null);
  await act(async () => button("Use this folder")?.click());
  expect(chosen).toEqual(["/srv/home/Proyectos"]);
  expect(cancelled).toBe(0);
  expect(client.calls.map(call => call.path ?? null)).toEqual([null, "/srv/home/Proyectos", "/srv/home/Proyectos/cliente", "/srv/home/Proyectos"]);
});

test("creates a folder inside the current one and opens it; hidden folders on request", async () => {
  const client = fakeClient();
  const chosen: string[] = [];
  await act(async () => root.render(<FolderBrowserDialog open client={client} onChoose={path => chosen.push(path)} onCancel={() => undefined} />));
  await waitFor(() => entry("notas") !== null);

  const toggle = document.querySelector<HTMLElement>("[role=checkbox]");
  await act(async () => toggle?.click());
  await waitFor(() => entry(".oculta") !== null);

  await act(async () => button("New folder")?.click());
  const input = document.querySelector<HTMLInputElement>("input[aria-label='Folder name']");
  expect(input).not.toBeNull();
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => { if (input) { setValue?.call(input, "Nuevo proyecto"); input.dispatchEvent(new Event("input", { bubbles: true })); } });
  await act(async () => button("Create folder")?.click());
  await waitFor(() => crumbs().includes("Nuevo proyecto"));
  expect(client.created).toEqual([{ parent: "/srv/home", name: "Nuevo proyecto" }]);
  await act(async () => button("Use this folder")?.click());
  expect(chosen).toEqual(["/srv/home/Nuevo proyecto"]);
});

test("the picker hook resolves pick() with the chosen folder, or null on cancel, and reports owner access", async () => {
  const client = fakeClient();
  let picker: ReturnType<typeof useWebFolderPicker> | null = null;
  function Harness(props: { client: typeof client | null }) {
    picker = useWebFolderPicker(props.client, true);
    return <>{picker.dialog}</>;
  }
  await act(async () => root.render(<Harness client={client} />));
  await waitFor(() => picker?.availability === "available");

  let result: Promise<string | null> = Promise.resolve(null);
  await act(async () => { result = picker?.pick() ?? Promise.resolve(null); });
  await waitFor(() => entry("notas") !== null);
  await act(async () => entry("notas")?.click());
  await waitFor(() => crumbs().includes("notas"));
  await act(async () => button("Use this folder")?.click());
  expect(await result).toBe("/srv/home/notas");

  await act(async () => { result = picker?.pick() ?? Promise.resolve(null); });
  await waitFor(() => button("Cancel") !== undefined);
  await act(async () => button("Cancel")?.click());
  expect(await result).toBeNull();

  const collaborator = { ...fakeClient(), browseFolders: async () => { throw Object.assign(new Error("Invalid host token"), { status: 401, code: "unauthorized" }); } };
  await act(async () => root.render(<Harness client={collaborator} />));
  await waitFor(() => picker?.availability === "needs_owner");
});

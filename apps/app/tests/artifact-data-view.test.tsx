/** @jsxImportSource react */
// El visor data debe resolver contra el snapshot más reciente y fallar en voz alta.
import { afterAll, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://localhost/" });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { DataView } = await import("../src/react-app/domains/artifacts/views/data-view");

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let cache: InstanceType<typeof QueryClient>;

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  if (!("ResizeObserver" in globalThis)) Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterAll(async () => { await act(async () => root.unmount()); GlobalRegistrator.unregister(); });

function client(resolve: () => Promise<unknown>) {
  return { baseUrl: "http://localhost:8787", resolveArtifact: resolve } as never;
}

test("el visor data muestra la fuente viva y el bloque resuelto", async () => {
  const fake = client(async () => ({
    spec: { title: "Ventas", source: { dataset: "ds_1" }, blocks: [{ type: "stat", field: "valor", agg: "sum", title: "Total" }] },
    resolution: { ok: true, data: [{ valor: 100 }, { valor: 200 }], sourceLabel: "dataset:ds_1", diff: null },
  }));
  await act(async () => root.render(
    <QueryClientProvider client={cache}><DataView client={fake} appId="app_test" artifactId="art_data" /></QueryClientProvider>,
  ));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  expect((document.body.textContent ?? "").includes("dataset:ds_1")).toBe(true);
  expect((document.body.textContent ?? "").includes("Total")).toBe(true);
});

test("si la resolución falla, el visor lo dice en voz alta", async () => {
  const fake = client(async () => ({
    spec: { title: "Ventas", source: { dataset: "ds_1" }, blocks: [{ type: "stat", field: "valor" }] },
    resolution: { ok: false, error: "El dataset no existe en este proyecto." },
  }));
  await act(async () => root.render(
    <QueryClientProvider client={cache}><DataView client={fake} appId="app_test" artifactId="art_data" /></QueryClientProvider>,
  ));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  expect((document.body.textContent ?? "").includes("El dataset no existe")).toBe(true);
});

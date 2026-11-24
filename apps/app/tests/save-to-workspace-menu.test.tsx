/** @jsxImportSource react */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://localhost/" });
import { expect, test } from "bun:test";
import type { OpenworkServerClient } from "../src/app/lib/openwork-server";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { SaveToWorkspaceMenu } = await import("../src/react-app/domains/specialists/save-to-workspace-menu");

test("el menú guarda el recurso y muestra el resultado en español", async () => {
  const calls: unknown[] = [];
  const client = {
    baseUrl: "http://localhost:8787",
    saveSpecialistWorkspaceResource: async (...args: unknown[]) => {
      calls.push(args);
      return { created: true, resource: { id: "res_1" }, workspaceId: "ws_1" };
    },
  } as unknown as OpenworkServerClient;

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const cache = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={cache}>
        <SaveToWorkspaceMenu applicationId="app_1" client={client} resource={{ kind: "source", id: "src_1" }} workspaceId="ws_1" />
      </QueryClientProvider>,
    );
  });

  const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Más opciones"]');
  expect(trigger).not.toBeNull();
  await act(async () => { trigger!.click(); });
  expect(document.body.textContent).toContain("Queda en proyecto/recursos/ y no se pierde al recargar");

  const option = [...document.querySelectorAll('[data-slot="dropdown-menu-item"]')]
    .find(element => (element.textContent ?? "").includes("Guardar en workspace"));
  expect(option).toBeDefined();
  await act(async () => { (option as HTMLElement).click(); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });

  expect(calls).toEqual([["app_1", { kind: "source", id: "src_1" }, "ws_1"]]);
  expect(document.body.textContent).toContain("Guardado en el workspace");
  await act(async () => { root.unmount(); });
  host.remove();
});

import { afterEach, expect, spyOn, test } from "bun:test";

import { createOpenworkServerClient } from "../src/app/lib/openwork-server";

const spies: Array<{ mockRestore: () => void }> = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

function client() {
  return createOpenworkServerClient({
    baseUrl: "http://127.0.0.1:1",
    token: "token",
    hostToken: "host-token",
  });
}

const resource = {
  id: "res_1",
  kind: "dataset",
  title: "Exportaciones",
  savedAt: 1,
  sourceId: "dat_1",
};

test("getSpecialistWorkspaceResources manda el workspace como query", async () => {
  const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ resources: [resource] }));
  spies.push(fetchSpy);

  const result = await client().getSpecialistWorkspaceResources("app_1", "ws_1");

  const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("http://127.0.0.1:1/specialist-applications/app_1/workspace-resources?workspace=ws_1");
  const headers = new Headers(init.headers);
  expect(headers.get("Authorization")).toBe("Bearer token");
  expect(headers.get("X-OpenWork-Host-Token")).toBe("host-token");
  expect(result.resources[0]?.title).toBe("Exportaciones");
});

test("saveSpecialistWorkspaceResource manda el recurso y el workspace en el body", async () => {
  const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
    resource, created: true, workspacePath: "/proyecto", note: "Guardado",
    workspaceId: "ws_1", workspaceName: "Proyecto",
  }, { status: 201 }));
  spies.push(fetchSpy);

  const result = await client().saveSpecialistWorkspaceResource(
    "app_1",
    { kind: "source", id: "src_1" },
    "ws_1",
  );

  const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("http://127.0.0.1:1/specialist-applications/app_1/workspace-resources");
  expect(init.method).toBe("POST");
  expect(JSON.parse(String(init.body))).toEqual({ resource: { kind: "source", id: "src_1" }, workspaceId: "ws_1" });
  expect(result.created).toBe(true);
  expect(result.workspaceName).toBe("Proyecto");
});

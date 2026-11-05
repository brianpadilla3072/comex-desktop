import { expect, test } from "bun:test";
import { createNativeProviderAuth } from "../src/app/lib/opencode-v2-auth";

function engine() {
  const calls: { method: string; path: string; body?: Record<string, unknown> }[] = [];
  let status = "pending";
  const auth = createNativeProviderAuth(async (method, path, body) => {
    calls.push({ method, path, body });
    let payload: unknown = null;
    if (path === "/api/integration") payload = { data: [
      { id: "opencode", methods: [{ type: "key" }, { type: "env", names: ["KEY"] }, { type: "oauth", id: "device", label: "OpenCode Console account", form: [{ key: "server", hidden: true, default: "https://opencode.ai/console" }] }], connections: [{ type: "credential", id: "cred_console" }] },
      { id: "opencode-go", methods: [{ type: "key" }], connections: [{ type: "credential", id: "cred_go" }, { type: "env", name: "KEY" }] },
    ] };
    else if (path.endsWith("/connect/oauth")) payload = { data: { attemptID: "attempt_fixture", url: "https://opencode.ai/console/device", mode: "auto", instructions: "Ingresá el código de prueba." } };
    else if (method === "GET" && path.includes("attempt_fixture")) payload = { data: { status } };
    const request = new Request(`http://localhost${path}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { payload, request, response: Response.json(payload) };
  });
  return { auth, calls, setStatus: (value: string) => { status = value; } };
}
test("Go and Console use native integrations, without the retired v1 authentication route", async () => {
  const { auth, calls } = engine();
  const catalog = await auth.catalog();
  expect(catalog.data?.["opencode-go"]).toEqual([{ type: "api", label: "API key" }]);
  expect(catalog.data?.opencode?.[1]).toEqual({ type: "oauth", label: "OpenCode Console account" });
  await auth.credentials.set({ providerID: "opencode-go", auth: { type: "api", key: "fixture-key" } });
  expect(calls.find(call => call.method === "POST")).toMatchObject({ method: "POST", path: "/api/integration/opencode-go/connect/key", body: { key: "fixture-key", answer: null, label: null } });
  expect(calls.some(call => call.path === "/provider/auth" || call.path === "/api/credential")).toBe(false);
});
test("Console device authorization retains the native method and defaults, then polls the same attempt", async () => {
  const { auth, calls, setStatus } = engine();
  const started = await auth.oauth.authorize({ providerID: "opencode", method: 1 });
  expect(started.data?.method).toBe("auto");
  expect(calls.find(call => call.method === "POST")?.body).toMatchObject({ methodID: "device", answer: { server: "https://opencode.ai/console" } });
  const pending = await auth.oauth.callback({ providerID: "opencode", method: 1 });
  expect(pending.error).toMatchObject({ name: "ProviderAuthOauthMissing" });
  setStatus("complete");
  expect((await auth.oauth.callback({ providerID: "opencode", method: 1 })).data).toBe(true);
  expect(calls.filter(call => call.path.endsWith("/connect/oauth")).length).toBe(1);
});
test("pasted OAuth completion is submitted once, and expired attempts cannot be reused", async () => {
  const { auth, calls, setStatus } = engine();
  await auth.oauth.authorize({ providerID: "opencode", method: 1 });
  await auth.oauth.callback({ providerID: "opencode", method: 1, code: "fixture-code" });
  await auth.oauth.callback({ providerID: "opencode", method: 1, code: "fixture-code" });
  expect(calls.filter(call => call.path.endsWith("/complete")).length).toBe(1);
  setStatus("expired");
  expect((await auth.oauth.callback({ providerID: "opencode", method: 1 })).error).toBeDefined();
  await expect(auth.oauth.callback({ providerID: "opencode", method: 1 })).rejects.toThrow("venció");
});
test("disconnect removes only the chosen integration's credentials and never lists secrets", async () => {
  const { auth, calls } = engine();
  await auth.credentials.remove({ providerID: "opencode-go" });
  expect(calls.filter(call => call.method === "DELETE").map(call => call.path)).toEqual(["/api/credential/cred_go"]);
  expect(calls.some(call => call.path === "/api/credential")).toBe(false);
});
test("native authentication failures remain failures instead of reporting a connection", async () => {
  const auth = createNativeProviderAuth(async (method, path) => ({ payload: { message: "Access denied" }, request: new Request(`http://localhost${path}`, { method }), response: new Response(null, { status: 403 }) }));
  expect((await auth.catalog()).error).toBeDefined();
  expect((await auth.credentials.set({ providerID: "opencode-go", auth: { type: "api", key: "fixture-key" } })).error).toBeDefined();
});

test("a stored key that the engine reports as needing authentication is not called connected", async () => {
  const auth = createNativeProviderAuth(async (method, path) => ({
    payload: path === "/api/integration" ? { data: [{ id: "opencode-go", connections: [{ type: "credential", status: { status: "needs_auth" } }] }] } : null,
    request: new Request(`http://localhost${path}`, { method }), response: new Response(null, { status: method === "POST" ? 204 : 200 }),
  }));
  expect((await auth.credentials.set({ providerID: "opencode-go", auth: { type: "api", key: "fixture-expired" } })).error).toBeDefined();
});

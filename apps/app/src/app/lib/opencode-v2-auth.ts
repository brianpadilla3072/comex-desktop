import type { ProviderAuthMethod, ProviderAuthAuthorization } from "@opencode-ai/sdk/v2/client";
import type { FieldsResult } from "./opencode";

type Transport = { payload: unknown; request: Request; response: Response };
type NativeRequest = (method: string, path: string, body?: Record<string, unknown>, signal?: AbortSignal) => Promise<Transport>;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const data = (payload: unknown) => record(payload) && "data" in payload ? payload.data : payload;
const items = (payload: unknown): Record<string, unknown>[] => { const value = data(payload); return Array.isArray(value) ? value.filter(record) : []; };
function result<T>(transport: Transport, value: T): FieldsResult<T> {
  return transport.response.ok ? { data: value, request: transport.request, response: transport.response } : { error: transport.payload, request: transport.request, response: transport.response };
}
function failure(transport: Transport, message: string, name = "ProviderAuthValidationFailed"): FieldsResult<never> {
  return { error: { name, data: { message } }, request: transport.request, response: new Response(null, { status: 400 }) };
}

/** OpenCode v2 uses integration connections, not the retired v1 /provider/auth
 * and /auth routes. Never list /api/credential: that route returns secrets. */
export function createNativeProviderAuth(request: NativeRequest) {
  const methods = new Map<string, Record<string, unknown>[]>();
  const attempts = new Map<string, { id: string; codeSubmitted: boolean }>();
  const catalog = async () => {
    const transport = await request("GET", "/api/integration");
    const mapped: Record<string, ProviderAuthMethod[]> = {};
    if (transport.response.ok) {
      methods.clear();
      for (const integration of items(transport.payload)) {
        if (typeof integration.id !== "string" || !Array.isArray(integration.methods)) continue;
        const supported = integration.methods.filter(record).filter(method => method.type === "key" || (method.type === "oauth" && typeof method.id === "string"));
        methods.set(integration.id, supported);
        mapped[integration.id] = supported.map(method => ({ type: method.type === "key" ? "api" : "oauth", label: typeof method.label === "string" ? method.label : "API key" }));
      }
    }
    return result(transport, mapped);
  };
  const answer = (method: Record<string, unknown>, inputs?: Record<string, string>) => {
    const values: Record<string, unknown> = {};
    for (const field of Array.isArray(method.form) ? method.form.filter(record) : []) {
      if (typeof field.key === "string" && field.default !== undefined) values[field.key] = field.default;
    }
    return { ...values, ...inputs };
  };
  return {
    catalog,
    oauth: {
      authorize: async (parameters: { providerID: string; method: number; inputs?: Record<string, string> }): Promise<FieldsResult<ProviderAuthAuthorization>> => {
        if (!methods.has(parameters.providerID)) {
          const loaded = await catalog();
          if (loaded.error !== undefined) return { error: loaded.error, request: loaded.request, response: loaded.response };
        }
        const method = methods.get(parameters.providerID)?.[parameters.method];
        if (!method || method.type !== "oauth") throw new Error("El método de conexión no está disponible. Volvé a abrir el proveedor.");
        const endpoint = `/api/integration/${encodeURIComponent(parameters.providerID)}/connect/oauth`;
        const transport = await request("POST", endpoint, { methodID: method.id, answer: answer(method, parameters.inputs), label: null });
        const value = data(transport.payload);
        if (!transport.response.ok) return { error: transport.payload, request: transport.request, response: transport.response };
        if (!record(value) || typeof value.attemptID !== "string" || typeof value.url !== "string" || (value.mode !== "auto" && value.mode !== "code")) return failure(transport, "El servidor no devolvió un inicio de sesión válido.");
        if (!/^https?:\/\//i.test(value.url)) return failure(transport, "El servidor devolvió una dirección de inicio de sesión no válida.");
        attempts.set(`${parameters.providerID}:${parameters.method}`, { id: value.attemptID, codeSubmitted: false });
        return result(transport, { url: value.url, method: value.mode, instructions: typeof value.instructions === "string" ? value.instructions : "Completá el inicio de sesión en el navegador." });
      },
      callback: async (parameters: { providerID: string; method: number; code?: string }): Promise<FieldsResult<boolean>> => {
        const key = `${parameters.providerID}:${parameters.method}`;
        const attempt = attempts.get(key);
        if (!attempt) throw new Error("La conexión venció. Iniciá sesión de nuevo.");
        const endpoint = `/api/integration/${encodeURIComponent(parameters.providerID)}/connect/oauth/${encodeURIComponent(attempt.id)}`;
        if (parameters.code && !attempt.codeSubmitted) {
          const completed = await request("POST", `${endpoint}/complete`, { code: parameters.code });
          if (!completed.response.ok) return { error: completed.payload, request: completed.request, response: completed.response };
          attempt.codeSubmitted = true;
        }
        const transport = await request("GET", endpoint);
        if (!transport.response.ok) return { error: transport.payload, request: transport.request, response: transport.response };
        const value = data(transport.payload);
        if (record(value) && value.status === "complete") { attempts.delete(key); return result(transport, true); }
        if (record(value) && value.status === "pending") return failure(transport, "ProviderAuthOauthMissing: completá el inicio de sesión en el navegador.", "ProviderAuthOauthMissing");
        attempts.delete(key);
        return failure(transport, record(value) && typeof value.message === "string" ? value.message : "El inicio de sesión venció o fue cancelado.");
      },
    },
    credentials: {
      set: async (parameters: { providerID: string; auth: unknown }): Promise<FieldsResult<boolean>> => {
        if (!record(parameters.auth) || parameters.auth.type !== "api" || typeof parameters.auth.key !== "string") throw new Error("Usá el inicio de sesión del proveedor o una API key válida.");
        const transport = await request("POST", `/api/integration/${encodeURIComponent(parameters.providerID)}/connect/key`, { key: parameters.auth.key, answer: null, label: null });
        if (!transport.response.ok) return result(transport, false);
        // A stored key is not necessarily usable. Honor a known native auth
        // failure instead of announcing that an expired/rejected key connected.
        const checked = await request("GET", "/api/integration");
        if (!checked.response.ok) return result(checked, false);
        const integration = items(checked.payload).find(item => item.id === parameters.providerID);
        const connections = record(integration) && Array.isArray(integration.connections) ? integration.connections.filter(record) : [];
        if (connections.length && connections.every(connection => record(connection.status) && connection.status.status === "needs_auth")) {
          return failure(checked, "La clave se guardó, pero OpenCode indica que no sirve para autenticar esta conexión. Generá una clave vigente para este proveedor.");
        }
        return result(transport, true);
      },
      remove: async (parameters: { providerID: string }): Promise<FieldsResult<boolean>> => {
        let transport = await request("GET", "/api/integration");
        if (!transport.response.ok) return result(transport, false);
        const integration = items(transport.payload).find(item => item.id === parameters.providerID);
        const connections = record(integration) && Array.isArray(integration.connections) ? integration.connections.filter(record) : [];
        for (const connection of connections) {
          if (connection.type !== "credential" || typeof connection.id !== "string") continue;
          transport = await request("DELETE", `/api/credential/${encodeURIComponent(connection.id)}`);
          if (!transport.response.ok) return result(transport, false);
        }
        return result(transport, true);
      },
    },
  };
}

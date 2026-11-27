import { browserWebRequestSchema, browserWebReplySchema } from "@openwork/types/browser-web-view";
import { ApiError } from "../errors.js";
import { desktopLocalWebEnabled, desktopWebAllowed } from "../desktop-local-web.js";
import { uiBridgeRequest } from "../opencode-plugins/openwork-ui-bridge.js";
import type { ServerConfig, TokenScope } from "../types.js";
import { addRoute, type Route, type RequestContext } from "./registry.js";

export async function dispatchBrowserWebView(input: {
  config: Pick<ServerConfig, "host" | "desktopWebRoot">; raw: unknown; workspaceId: string; signal: AbortSignal;
  assertSession: (workspaceId: string, sessionId: string, signal: AbortSignal) => Promise<void>;
  forward: (request: import("@openwork/types/browser-web-view").BrowserWebRequest, signal: AbortSignal) => Promise<unknown>;
}) {
  if (!input.config.desktopWebRoot || !desktopWebAllowed(input.config.host, desktopLocalWebEnabled())) throw new ApiError(403, "desktop_web_disabled", "El navegador web local está deshabilitado.");
  const parsed = browserWebRequestSchema.safeParse(input.raw);
  if (!parsed.success) throw new ApiError(400, "invalid_browser_view_request", "La solicitud del navegador no es válida.");
  input.signal.throwIfAborted();
  await input.assertSession(input.workspaceId, parsed.data.sessionId, input.signal);
  input.signal.throwIfAborted();
  const response = browserWebReplySchema.safeParse(await input.forward(parsed.data, input.signal));
  if (!response.success) throw new ApiError(502, "browser_view_unavailable", "No se pudo conectar con el navegador de la app.");
  return response.data;
}

export function registerBrowserWebViewRoutes(options: {
  routes: Route[]; config: ServerConfig;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
  requireClientScope: (ctx: RequestContext, scope: TokenScope) => void;
  assertSession: (workspaceId: string, sessionId: string, signal: AbortSignal) => Promise<void>;
}) {
  addRoute(options.routes, "POST", "/workspace/:id/browser/view", "client", async ctx => {
    options.requireClientScope(ctx, "collaborator");
    const response = await dispatchBrowserWebView({ config: options.config, raw: await options.readJsonBody(ctx.request), workspaceId: ctx.params.id, signal: ctx.request.signal,
      assertSession: options.assertSession,
      forward: (request, signal) => uiBridgeRequest("/browser/view", { method: "POST", body: request, signal, timeoutMs: 15000 }),
    });
    return Response.json(response, { headers: { "Cache-Control": "no-store" } });
  });
}

import { browserWebRequestSchema, browserWebReplySchema } from "@openwork/types/browser-web-view";

const failure = (code, error) => ({ version: 1, ok: false, code, error });

/** Instance-owned queue; frame reads never call observe or change the agent's refs. */
export function createBrowserWebView(host) {
  const pending = new Map();
  const depth = new Map();
  /** @param {unknown} raw @param {{ signal?: AbortSignal }} options */
  async function apply(raw, { signal } = {}) {
    const parsed = browserWebRequestSchema.safeParse(raw);
    if (!parsed.success) return failure("invalid_browser_view_request", "La solicitud del navegador no es válida.");
    const request = parsed.data;
    if ((depth.get(request.sessionId) ?? 0) >= 8) return failure("browser_view_busy", "El navegador está ocupado. Vuelve a intentar.");
    depth.set(request.sessionId, (depth.get(request.sessionId) ?? 0) + 1);
    const previous = pending.get(request.sessionId) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(() => signal?.aborted ? failure("browser_view_canceled", "La solicitud fue cancelada.") : perform(request, signal));
    pending.set(request.sessionId, task);
    try { return browserWebReplySchema.parse(await task); }
    finally {
      if (pending.get(request.sessionId) === task) pending.delete(request.sessionId);
      const remaining = (depth.get(request.sessionId) ?? 1) - 1;
      if (remaining) depth.set(request.sessionId, remaining); else depth.delete(request.sessionId);
    }
  }
  async function perform(request, signal) {
    try {
      let id = request.tabId;
      if (request.operation === "open") {
        if (!request.url) return failure("invalid_browser_url", "Escribe una dirección HTTP o HTTPS.");
        const existing = host.tabsFor(request.sessionId).find(tab => host.describe(tab).url === request.url);
        const opened = existing ? { ok: true, tabId: existing.tabId } : await host.open(request.sessionId, request.url, { signal });
        if (!opened.ok) return failure(opened.code ?? "browser_open_failed", opened.error ?? "No se pudo abrir la página.");
        if (opened.handoff) return failure("app_link_handed_off", "La conversación se abrió en la app de escritorio.");
        if (signal?.aborted) return failure("browser_view_canceled", "La solicitud fue cancelada.");
        id = opened.tabId;
      }
      const tab = id ? host.getTab(id) : host.tabsFor(request.sessionId).at(-1);
      if (!tab || host.ownerOf(tab.tabId) !== request.sessionId) return failure("browser_tab_not_found", "No hay una pestaña de esta conversación disponible.");
      if (request.operation === "pause") await host.pause(tab.tabId);
      else if (request.operation === "resume") host.resume(tab.tabId);
      else if (["input", "navigate", "back", "forward", "reload"].includes(request.operation)) {
        if (!host.paused(tab.tabId)) return failure("browser_control_required", "Pulsa Tomar control para interactuar con la página.");
        await host.interact(tab, request);
      }
      if (host.ownerOf(tab.tabId) !== request.sessionId) return failure("browser_tab_not_found", "La pestaña ya no pertenece a esta conversación.");
      return { version: 1, ok: true, tab: host.describe(tab), ...(["state", "open"].includes(request.operation) ? { frame: await host.capture(tab) } : {}) };
    } catch { return failure("browser_view_unavailable", "No se pudo conectar con el navegador de la app."); }
  }
  return { request: apply };
}

/** @jsxImportSource react */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, Hand, Maximize, Minimize, Play, RotateCw } from "lucide-react";
import type { BrowserWebReply, BrowserWebRequest } from "@openwork/types/browser-web-view";
import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePlatform } from "../../../kernel/platform";

type View = Extract<BrowserWebReply, { ok: true }>;
export function WebBrowserPane({ client, workspaceId, sessionId, url, nativeId, active, onLocation }: {
  client: OpenworkServerClient; workspaceId: string; sessionId: string; url: string;
  nativeId?: string; active: boolean;
  onLocation: (tab: View["tab"]) => void;
}) {
  const platform = usePlatform();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [address, setAddress] = useState(url);
  const [retry, setRetry] = useState(0);
  const [visible, setVisible] = useState(document.visibilityState === "visible");
  const pane = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  const id = useRef(nativeId);
  const generation = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const command = useRef<(operation: BrowserWebRequest["operation"], input?: BrowserWebRequest["input"], nextUrl?: string) => void>(() => {});
  const location = useRef(onLocation);
  location.current = onLocation;
  const person = view?.tab.control === "person" && !error;

  useEffect(() => {
    const change = () => setExpanded(document.fullscreenElement === pane.current);
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);
  useEffect(() => {
    const change = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  useEffect(() => {
    const current = ++generation.current;
    if (!active || !visible) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let statePending = false;
    setError("");
    const apply = (reply: BrowserWebReply) => {
      if (current !== generation.current || abort.signal.aborted) return;
      if (!reply.ok) { setError(reply.error); return; }
      id.current = reply.tab.id;
      setView(previous => ({ ...reply, frame: reply.frame ?? previous?.frame }));
      setError("");
      location.current(reply.tab);
      if (document.activeElement?.getAttribute("data-web-browser-address") !== "true") setAddress(reply.tab.url);
    };
    const request = async (operation: BrowserWebRequest["operation"], input?: BrowserWebRequest["input"], nextUrl?: string) => {
      if (current !== generation.current || abort.signal.aborted) return;
      const reply = await client.browserWebView(workspaceId, { sessionId, tabId: id.current, operation, ...(input ? { input } : {}), ...(nextUrl ? { url: nextUrl } : {}) }, abort.signal);
      apply(reply);
      return reply.ok;
    };
    command.current = (operation, input, nextUrl) => {
      queue.current = queue.current.catch(() => undefined).then(async () => {
        if (operation === "navigate" && !await request("pause")) return;
        await request(operation, input, nextUrl);
      }).catch(() => { if (!abort.signal.aborted) setError("Se perdió la conexión con el navegador. Vuelve a conectar."); });
    };
    const poll = async () => {
      if (abort.signal.aborted) return;
      if (!statePending) {
        statePending = true;
        try { await request("state"); }
        catch { if (!abort.signal.aborted) setError("Se perdió la conexión con el navegador. Vuelve a conectar."); }
        finally { statePending = false; }
      }
      if (!abort.signal.aborted) timer = setTimeout(poll, 1200);
    };
    void request(id.current ? "state" : "open", undefined, id.current ? undefined : url).then(success => { if (success && !abort.signal.aborted) timer = setTimeout(poll, 1200); }).catch(() => { if (!abort.signal.aborted) setError("No se pudo abrir el navegador. Vuelve a conectar."); });
    return () => { ++generation.current; abort.abort(); clearTimeout(timer); command.current = () => {}; };
  }, [client, workspaceId, sessionId, active, visible, retry]);

  useEffect(() => {
    const element = surface.current;
    if (!element || !person) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      command.current("input", { type: "scroll", deltaY: Math.max(-1200, Math.min(1200, Math.round(event.deltaY))) });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [person]);

  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!person) return;
    const allowed = ["Enter", "Tab", "Backspace", "Delete", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"];
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") return;
    event.preventDefault();
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) command.current("input", { type: "text", text: event.key });
    else if (allowed.includes(event.key)) {
      // The same schema validates the key before it crosses the server boundary.
      const parsed = browserKey(event.key);
      if (parsed) command.current("input", parsed);
    }
  };
  return <div ref={pane} className="flex h-full min-h-0 flex-col bg-background fullscreen:h-screen fullscreen:w-screen" data-web-browser-pane>
    <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-1 border-b border-border px-2">
      <Button variant="ghost" size="icon-sm" aria-label="Atrás" disabled={!person || !view?.tab.canGoBack} onClick={() => command.current("back")}><ArrowLeft /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Adelante" disabled={!person || !view?.tab.canGoForward} onClick={() => command.current("forward")}><ArrowRight /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Recargar página" disabled={!person} onClick={() => command.current("reload")}><RotateCw /></Button>
      <form className="min-w-32 flex-1" onSubmit={event => { event.preventDefault(); command.current("navigate", undefined, address); }}>
        <Input data-web-browser-address="true" aria-label="Dirección del navegador integrado" className="h-8" value={address} onChange={event => setAddress(event.currentTarget.value)} />
      </form>
      <Button variant={person ? "default" : "outline"} size="sm" disabled={!view || !!error} onClick={() => { command.current(person ? "resume" : "pause"); surface.current?.focus(); }}>
        {person ? <Play /> : <Hand />}{person ? "Devolver al agente" : "Tomar control"}
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={expanded ? "Salir de pantalla completa" : "Ampliar navegador"} title={expanded ? "Salir de pantalla completa" : "Ampliar navegador"} onClick={() => {
        const action = expanded ? document.exitFullscreen() : pane.current?.requestFullscreen();
        void action?.catch(() => {});
      }}>{expanded ? <Minimize /> : <Maximize />}</Button>
      <Button variant="ghost" size="icon-sm" aria-label="Abrir sitio afuera" onClick={() => void platform.openLink(view?.tab.url ?? url)}><ExternalLink /></Button>
    </div>
    <div className="relative flex min-h-0 flex-1 items-start justify-center overflow-auto bg-muted/20 outline-none focus-visible:ring-2 focus-visible:ring-ring" ref={surface} tabIndex={person ? 0 : -1} role="application" aria-label="Página del navegador integrado" onKeyDown={key}
      onPaste={event => { if (person) { event.preventDefault(); const text = event.clipboardData.getData("text/plain"); if (text) command.current("input", { type: "text", text }); } }}>
      {view?.frame ? <img data-web-browser-frame src={`data:image/jpeg;base64,${view.frame.data}`} width={view.frame.width} height={view.frame.height} alt="Página del navegador integrado" draggable={false} className="block h-auto w-full max-w-none shrink-0 select-none" onClick={event => {
        if (!person) return;
        surface.current?.focus(); const rect = event.currentTarget.getBoundingClientRect();
        command.current("input", { type: "click", x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) });
      }} /> : <p role="status" className="p-6 text-sm text-muted-foreground">Conectando con la pestaña de esta conversación…</p>}
      {error ? <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/95 p-6 text-center"><p className="text-sm">{error}</p><Button variant="outline" onClick={() => { id.current = undefined; setRetry(value => value + 1); }}>Volver a conectar</Button></div> : null}
    </div>
    <p role="status" className="shrink-0 border-t border-border px-3 py-1 text-xs text-muted-foreground">{person ? "Tienes el control. El navegador del agente está pausado." : "Vista en vivo · El agente tiene el control"}</p>
  </div>;
}
function browserKey(key: string): BrowserWebRequest["input"] | null {
  switch (key) {
    case "Enter": case "Tab": case "Backspace": case "Delete": case "Escape": case "ArrowUp": case "ArrowDown": case "ArrowLeft": case "ArrowRight": case "Home": case "End": case "PageUp": case "PageDown": return { type: "key", key };
    default: return null;
  }
}

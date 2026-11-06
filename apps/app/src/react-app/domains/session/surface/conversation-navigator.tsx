/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { UIMessage } from "ai";
import { ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";

function previewText(message: UIMessage) {
  return message.parts.flatMap(part => part.type === "text" ? [part.text]
    : part.type === "file" ? [part.filename || "Archivo adjunto"] : []).join(" ").replace(/\s+/g, " ").trim();
}

export function conversationStops(messages: readonly UIMessage[]) {
  const stops: { id: string; prompt: string; reply: string }[] = [];
  for (const message of messages) {
    if (message.role === "user") stops.push({ id: message.id, prompt: previewText(message) || "Mensaje con archivos", reply: "" });
    else if (message.role === "assistant" && stops.length) {
      const stop = stops[stops.length - 1];
      const text = previewText(message);
      if (text) stop.reply = `${stop.reply} ${text}`.trim().slice(0, 360);
    }
  }
  return stops;
}

export function ConversationNavigator({ messages, scrollRef, onNavigate, historyComplete = true, onLoadHistory }: {
  messages: readonly UIMessage[];
  scrollRef: RefObject<HTMLDivElement | null>;
  onNavigate: (messageId: string) => void;
  historyComplete?: boolean;
  onLoadHistory?: () => Promise<unknown>;
}) {
  const stops = useMemo(() => conversationStops(messages), [messages]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const rail = useRef<HTMLElement>(null);
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !stops.length) return;
    let frame = 0;
    const ids = new Set(stops.map(stop => stop.id));
    const measure = () => {
      frame = 0;
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 8) {
        setActiveId(stops[stops.length - 1].id); return;
      }
      const top = container.getBoundingClientRect().top + 32;
      let current: string | null = null;
      for (const node of container.querySelectorAll<HTMLElement>('[data-message-role="user"][data-message-id]')) {
        const id = node.dataset.messageId;
        if (!id || !ids.has(id)) continue;
        if (!current || node.getBoundingClientRect().top <= top) current = id;
        else break;
      }
      if (current) setActiveId(current);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new MutationObserver(schedule);
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    const resize = new ResizeObserver(schedule); resize.observe(container);
    container.addEventListener("scroll", schedule, { passive: true });
    schedule();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); resize.disconnect(); container.removeEventListener("scroll", schedule); };
  }, [scrollRef, stops]);
  if (stops.length < 2 && historyComplete) return null;
  const active = stops.some(stop => stop.id === activeId) ? activeId : stops[0]?.id;
  return <nav ref={rail} aria-label="Navegar conversación" data-conversation-navigator
    className="absolute inset-y-5 left-0 z-20 hidden w-9 flex-col items-center justify-center lg:flex">
    {!historyComplete && onLoadHistory ? <Button variant="ghost" size="icon-xs" aria-label="Cargar toda la conversación" title={loadError ? "Reintentar cargar la conversación" : "Cargar toda la conversación"}
      disabled={loading} onClick={() => { setLoading(true); setLoadError(false); void onLoadHistory().catch(() => setLoadError(true)).finally(() => setLoading(false)); }}><ChevronUp /></Button> : null}
    {loadError ? <span className="sr-only" role="alert">No se pudo cargar la conversación. Volvé a intentarlo.</span> : null}
    <div className="max-h-full w-full overflow-y-auto py-1 [scrollbar-width:none]">
      {stops.map((stop, index) => <HoverCard key={stop.id} open={previewId === stop.id} onOpenChange={open => setPreviewId(open ? stop.id : null)}>
        <HoverCardTrigger render={<Button variant="ghost" className="group/stop flex h-3 w-9 rounded-sm p-0 transition-none" />}
          tabIndex={stop.id === active ? 0 : -1} data-conversation-stop={stop.id}
          aria-label={`Ir al mensaje ${index + 1}: ${stop.prompt.slice(0, 100)}`} aria-current={stop.id === active ? "location" : undefined}
          onClick={() => { setPreviewId(null); onNavigate(stop.id); }}
          onKeyDown={event => {
            let next = index;
            if (event.key === "ArrowDown") next = Math.min(stops.length - 1, index + 1);
            else if (event.key === "ArrowUp") next = Math.max(0, index - 1);
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = stops.length - 1;
            else return;
            event.preventDefault();
            rail.current?.querySelectorAll<HTMLElement>("[data-conversation-stop]")[next]?.focus();
          }}>
          <span aria-hidden className={cn("h-0.5 w-2 rounded-full bg-muted-foreground/35 transition-[width,background-color] duration-150 motion-reduce:transition-none group-hover/stop:w-5 group-hover/stop:bg-foreground group-focus-visible/stop:w-5",
            stop.id === active && "w-5 bg-foreground/80")} />
        </HoverCardTrigger>
        <HoverCardContent side="right" align="center" sideOffset={4} className="w-80 rounded-xl p-3">
          <p className="mb-1 text-xs text-muted-foreground">Mensaje {index + 1} de {stops.length}</p>
          <p className="line-clamp-2 break-words text-sm font-medium">{stop.prompt}</p>
          {stop.reply ? <p className="mt-1 line-clamp-3 break-words text-sm text-muted-foreground">{stop.reply}</p> : null}
        </HoverCardContent>
      </HoverCard>)}
    </div>
  </nav>;
}

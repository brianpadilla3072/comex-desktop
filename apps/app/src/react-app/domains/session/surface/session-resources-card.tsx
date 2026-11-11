import { useState, type Ref, type ReactNode } from "react";
import type { UIMessage } from "ai";
import { FileText, Globe, Link, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deriveOpenTargets, type OpenTarget } from "../artifacts/open-target";

export function conversationResources(messages: UIMessage[], verified: OpenTarget[]) {
  const userMessages = messages.filter(message => message.role === "user");
  const sources = deriveOpenTargets(userMessages);
  const sourceIds = new Set(sources.map(target => target.id));
  const images = userMessages.flatMap(message => message.parts.flatMap((part, index) =>
    part.type === "file" && part.mediaType.startsWith("image/") && /^(data:image\/|https?:\/\/)/.test(part.url)
      ? [{ id: `${message.id}:${index}`, name: part.filename || "Imagen adjunta", url: part.url }] : [])).map(image => ({ ...image, path: sources.find(target => target.kind === "file" && target.name === image.name)?.value }));
  return { sources: sources.filter(target => !images.some(image => image.name === target.name)), images, results: Array.from(new Map(verified.filter(target => !sourceIds.has(target.id) && target.exists !== false).map(target => [target.id, target])).values()) };
}

export function SessionResourcesCard(props: {
  agents?: ReactNode;
  messages: UIMessage[];
  targets: OpenTarget[];
  onOpen: (target: OpenTarget) => void;
  onAddResult: () => void;
  onViewSources: () => void;
  sourceMenuHostRef: Ref<HTMLDivElement>;
}) {
  const { sources, images, results } = conversationResources(props.messages, props.targets);
  const [image, setImage] = useState<{ name: string; url: string } | null>(null);
  const rowClass = "h-8 w-full justify-start gap-2.5 rounded-md px-1 text-sm font-normal text-dls-secondary hover:text-dls-text";
  function targetRow(target: OpenTarget) {
    const label = target.kind === "url" ? target.name.replace(/^https?:\/\//, "").replace(/\/$/, "") : target.name;
    return <Button key={target.id} variant="ghost" className={rowClass} title={target.value}
      onClick={() => props.onOpen(target)}>
      {target.kind === "url" ? <Globe strokeWidth={1.5} className="size-4 shrink-0 text-dls-text" /> : <FileText strokeWidth={1.5} className="size-4 shrink-0" />}
      <span className="min-w-0 truncate">{label}</span>
    </Button>;
  }
  const imageRow = (item: { id: string; name: string; url: string }) => <Button key={item.id} variant="ghost" className={rowClass} title={item.name} onClick={() => setImage(item)}>
    <img src={item.url} alt="" className="size-5 shrink-0 rounded-sm border border-dls-border object-cover" />
    <span className="min-w-0 truncate">{item.name}</span>
  </Button>;
  return <>
    <aside aria-label="Resultados y fuentes" className="space-y-4 overflow-hidden rounded-[var(--dls-radius)] bg-dls-active p-4 text-dls-text" data-testid="session-resources-card">
      <section aria-label="Resultados">
        <div className="mb-1 flex h-6 items-center justify-between text-xs font-medium text-dls-secondary">Resultados
          <Button variant="ghost" size="icon" className="size-6 rounded-full text-dls-secondary hover:text-dls-text" aria-label="Agregar resultado" onClick={props.onAddResult}><Plus strokeWidth={1.5} className="size-4" /></Button>
        </div>
        {results.slice(0, 3).map(targetRow)}
        {!results.length && <p className="px-1 py-1 text-xs text-dls-secondary">Sin resultados</p>}
      </section>
      {props.agents ? <section aria-label="Subagentes"><div className="mb-1 flex h-6 items-center text-xs font-medium text-dls-secondary">Subagentes</div>{props.agents}</section> : null}
      <section aria-label="Fuentes">
        <div className="mb-1 flex h-6 items-center justify-between text-xs font-medium text-dls-secondary">Fuentes
          <div ref={props.sourceMenuHostRef} />
        </div>
        {images.slice(0, 3).map(imageRow)}
        {sources.slice(0, Math.max(0, 3 - images.length)).map(targetRow)}
        {!sources.length && !images.length && <p className="px-1 py-1 text-xs text-dls-secondary">Sin fuentes</p>}
        <Button variant="ghost" className="mt-1 h-7 gap-2.5 rounded-md px-1 text-xs font-normal text-dls-secondary hover:text-dls-text" onClick={props.onViewSources}><Link strokeWidth={1.5} className="size-4" />Ver todo</Button>
      </section>
    </aside>
    <Dialog open={Boolean(image)} onOpenChange={open => { if (!open) setImage(null); }}><DialogContent className="sm:max-w-4xl"><DialogHeader><DialogTitle>{image?.name}</DialogTitle></DialogHeader>{image && <img src={image.url} alt={image.name} className="max-h-[75vh] w-full object-contain" />}</DialogContent></Dialog>
  </>;
}

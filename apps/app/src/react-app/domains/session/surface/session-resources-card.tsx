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
  function targetRow(target: OpenTarget) {
    return <Button key={target.id} variant="ghost" className="h-8 w-full justify-start gap-3 px-1 text-xs font-normal" title={target.value}
      onClick={() => props.onOpen(target)}>
      {target.kind === "url" ? <Globe className="size-4 shrink-0" /> : <FileText className="size-4 shrink-0" />}
      <span className="truncate">{target.name}</span>
    </Button>;
  }
  const imageRow = (item: { id: string; name: string; url: string }) => <Button key={item.id} variant="ghost" className="h-8 w-full justify-start gap-3 px-1 text-xs font-normal text-dls-secondary" title={item.name} onClick={() => setImage(item)}>
    <img src={item.url} alt="" className="size-4 shrink-0 rounded-sm object-cover" /><span className="truncate">{item.name}</span>
  </Button>;
  return <>
    <aside aria-label="Resultados y fuentes" className="rounded-[20px] bg-dls-active p-4 text-dls-text" data-testid="session-resources-card">
      <div className="mb-1 flex items-center justify-between text-xs text-dls-secondary">Resultados
        <Button variant="ghost" size="icon" className="size-6" aria-label="Agregar resultado" onClick={props.onAddResult}><Plus className="size-4" /></Button>
      </div>
      {results.slice(0, 3).map(targetRow)}
      {!results.length && <p className="py-1 text-xs text-dls-secondary">Sin resultados</p>}
      {props.agents ? <div className="mt-4"><div className="mb-1 text-xs text-dls-secondary">Subagentes</div>{props.agents}</div> : null}
      <div className="mb-1 mt-4 flex items-center justify-between text-xs text-dls-secondary">Fuentes
        <div ref={props.sourceMenuHostRef} />
      </div>
      {images.slice(0, 3).map(imageRow)}
      {sources.slice(0, Math.max(0, 3 - images.length)).map(targetRow)}
      {!sources.length && !images.length && <p className="py-1 text-xs text-dls-secondary">Sin fuentes</p>}
      <Button variant="ghost" className="mt-1 h-7 gap-3 px-1 text-xs font-normal text-dls-secondary" onClick={props.onViewSources}><Link className="size-4" />Ver todo</Button>
    </aside>
    <Dialog open={Boolean(image)} onOpenChange={open => { if (!open) setImage(null); }}><DialogContent className="sm:max-w-4xl"><DialogHeader><DialogTitle>{image?.name}</DialogTitle></DialogHeader>{image && <img src={image.url} alt={image.name} className="max-h-[75vh] w-full object-contain" />}</DialogContent></Dialog>
  </>;
}

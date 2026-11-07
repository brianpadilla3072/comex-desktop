import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import { FileText, Globe, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getNativeSessionMessages } from "@/app/lib/opencode-session-native";
import { sessionHistoryCredential } from "../sync/session-sync";
import { snapshotToUIMessages } from "../sync/usechat-adapter";
import { conversationResources } from "../surface/session-resources-card";
import type { OpenTarget } from "../artifacts/open-target";

export function WorkspaceSourcesList({ messages, onOpen }: { messages: UIMessage[]; onOpen: (target: OpenTarget) => void }) {
  const { images, sources } = conversationResources(messages.toReversed(), []);
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);
  const tools = new Map<string, number>();
  for (const message of messages) for (const part of message.parts) {
    if (part.type === "dynamic-tool" && (part.state === "output-available" || part.state === "output-error")) {
      tools.set(part.toolName, (tools.get(part.toolName) ?? 0) + 1);
    }
  }
  return <section aria-label="Fuentes de la conversación" className="h-full overflow-y-auto px-4 pb-32 text-dls-text" data-workspace-sources>
    {!images.length && !sources.length && !tools.size ? <p className="py-6 text-sm text-dls-secondary">Sin fuentes en esta conversación</p> : null}
    {images.map(item => <Button key={item.id} variant="ghost" className="h-auto w-full justify-start gap-3 rounded-none border-b border-dls-border px-0 py-4 text-left font-normal" onClick={() => setPreview(item)}>
      <img src={item.url} alt="" className="size-4 shrink-0 self-start rounded-sm object-cover" />
      <span className="min-w-0 flex-1"><span className="block truncate text-xs">{item.name}</span><span className="mt-1 block truncate text-xs text-dls-secondary" title={item.path}>{item.path ?? "Imagen adjunta"}</span><span className="mt-3 block text-xs text-dls-secondary">Adjunto a la conversación</span></span>
    </Button>)}
    {sources.map(target => <Button key={target.id} variant="ghost" className="h-auto w-full justify-start gap-3 rounded-none border-b border-dls-border px-0 py-4 text-left font-normal" onClick={() => onOpen(target)}>
      {target.kind === "url" ? <Globe className="size-4 shrink-0 self-start" /> : <FileText className="size-4 shrink-0 self-start" />}
      <span className="min-w-0 flex-1"><span className="block truncate text-xs">{target.name}</span><span className="mt-1 block truncate text-xs text-dls-secondary" title={target.value}>{target.value}</span><span className="mt-3 block text-xs text-dls-secondary">{target.kind === "url" ? "Enlace de la conversación" : "Adjunto a la conversación"}</span></span>
    </Button>)}
    {Array.from(tools, ([name, count]) => <div key={name} className="flex gap-3 border-b border-dls-border py-4"><Wrench className="size-4 shrink-0" /><div className="min-w-0"><div className="truncate text-xs">{name}</div><div className="mt-3 text-xs text-dls-secondary">{count === 1 ? "1 llamada registrada" : `${count} llamadas registradas`}</div></div></div>)}
    <Dialog open={Boolean(preview)} onOpenChange={open => { if (!open) setPreview(null); }}><DialogContent className="sm:max-w-4xl"><DialogHeader><DialogTitle>{preview?.name}</DialogTitle></DialogHeader>{preview && <img src={preview.url} alt={preview.name} className="max-h-[75vh] w-full object-contain" />}</DialogContent></Dialog>
  </section>;
}

export function WorkspaceSourcesView(props: {
  scope: string; sessionId: string | null; endpoint?: { opencodeBaseUrl: string; token: string };
  visible: boolean; onOpen: (target: OpenTarget) => void;
}) {
  const history = useQuery({
    queryKey: ["workspace-conversation-sources", props.scope, props.endpoint?.opencodeBaseUrl, sessionHistoryCredential(props.endpoint?.token), props.sessionId],
    enabled: props.visible && Boolean(props.sessionId && props.endpoint?.opencodeBaseUrl),
    queryFn: async ({ signal }) => {
      if (!props.endpoint || !props.sessionId) throw new Error("Conversación no disponible");
      return snapshotToUIMessages({ messages: await getNativeSessionMessages(props.endpoint, props.sessionId, { signal }) });
    },
  });
  if (history.isError) return <div role="alert" className="p-4 text-sm">No se pudieron cargar las fuentes.<Button variant="ghost" onClick={() => void history.refetch()}>Reintentar</Button></div>;
  if (!history.data) return <p role="status" className="p-4 text-sm text-dls-secondary">{history.isFetching ? "Cargando fuentes…" : "Conversación no disponible"}</p>;
  return <WorkspaceSourcesList key={`${props.scope}:${props.sessionId}`} messages={history.data} onOpen={props.onOpen} />;
}

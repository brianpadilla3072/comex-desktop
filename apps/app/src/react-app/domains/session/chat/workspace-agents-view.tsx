import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { getNativeSessionMessages } from "@/app/lib/opencode-session-native";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { isToolPartInFlight } from "@/lib/tool-activity";
import { taskChildSessionId } from "@/lib/build-in-tools";
import { AgentActivityMap, conversationAgentTasks } from "../surface/composer/agent-activity-map";
import { snapshotToUIMessages } from "../sync/usechat-adapter";
import { sessionHistoryCredential } from "../sync/session-sync";
import { useSessionActivityStore } from "../status/session-activity-store";

export function WorkspaceAgentsView(props: { scope: string; workspaceId: string; sessionId: string | null; endpoint?: { opencodeBaseUrl: string; token: string }; visible: boolean; childId?: string; onOpenChild?: (id: string) => void }) {
  const readChild = useCallback(async (id: string) => {
    if (!props.endpoint) throw new Error("Conexión no disponible");
    return snapshotToUIMessages({ messages: await getNativeSessionMessages(props.endpoint, id) });
  }, [props.endpoint?.opencodeBaseUrl, props.endpoint?.token]);
  const history = useQuery({ queryKey: ["workspace-agents", props.scope, props.endpoint?.opencodeBaseUrl, sessionHistoryCredential(props.endpoint?.token), props.sessionId],
    enabled: props.visible && Boolean(props.endpoint?.opencodeBaseUrl && props.sessionId),
    queryFn: ({ signal }) => getNativeSessionMessages(props.endpoint!, props.sessionId!, { signal }).then(messages => snapshotToUIMessages({ messages })),
    refetchInterval: query => {
      if (!props.visible) return false;
      const records = useSessionActivityStore.getState().recordsByWorkspaceId[props.workspaceId];
      const tasks = conversationAgentTasks(query.state.data ?? []);
      return (props.sessionId && records?.[props.sessionId]?.runActive) || tasks.some(task => isToolPartInFlight(task) || records?.[taskChildSessionId(task) ?? ""]?.runActive) ? 3000 : false;
    }, retry: false });
  const parentActive = useSessionActivityStore(state => props.sessionId ? state.recordsByWorkspaceId[props.workspaceId]?.[props.sessionId]?.runActive ?? false : false);
  if (history.isError && !history.data) return <div role="alert" className="p-4 text-sm">No se pudo actualizar la actividad.<Button variant="ghost" onClick={() => void history.refetch()}>Reintentar</Button></div>;
  if (!history.data && history.isFetching) return <div role="status" aria-label="Cargando actividad" className="h-full">
    <div className="flex h-12 items-center border-b border-border px-4"><Skeleton className="h-3.5 w-24 motion-reduce:animate-none" /></div>
    <div className="mx-auto max-w-3xl divide-y divide-border px-4 py-6 sm:px-6">{["w-44", "w-56", "w-36"].map(width => <div key={width} className="flex min-h-16 items-center gap-3 py-3"><Skeleton className="size-4 rounded-sm motion-reduce:animate-none" /><div className="flex-1 space-y-2"><Skeleton className={`h-3 ${width} max-w-full motion-reduce:animate-none`} /><Skeleton className="h-2.5 w-24 motion-reduce:animate-none" /></div></div>)}</div>
  </div>;
  if (!history.data) return <p className="p-4 text-sm text-muted-foreground">Conversación no disponible</p>;
  return <AgentActivityMap key={`${props.scope}:${props.sessionId}`} presentation="workspace" visible={props.visible} initialChildId={props.childId} messages={history.data} workspaceId={props.workspaceId} owner={`${props.scope}:${props.sessionId}:${sessionHistoryCredential(props.endpoint?.token)}`} parentTitle="Conversación principal" parentActive={parentActive} syncDegraded={history.isError} readChild={readChild} onOpenChild={props.onOpenChild} />;
}

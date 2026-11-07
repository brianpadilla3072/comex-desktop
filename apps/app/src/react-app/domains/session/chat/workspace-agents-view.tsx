import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { getNativeSessionMessages } from "@/app/lib/opencode-session-native";
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
  if (!history.data) return <p role="status" className="p-4 text-sm text-muted-foreground">{history.isFetching ? "Cargando actividad…" : "Conversación no disponible"}</p>;
  return <AgentActivityMap key={`${props.scope}:${props.sessionId}`} presentation="workspace" visible={props.visible} initialChildId={props.childId} messages={history.data} workspaceId={props.workspaceId} owner={`${props.scope}:${props.sessionId}:${sessionHistoryCredential(props.endpoint?.token)}`} parentTitle="Conversación principal" parentActive={parentActive} syncDegraded={history.isError} readChild={readChild} onOpenChild={props.onOpenChild} />;
}

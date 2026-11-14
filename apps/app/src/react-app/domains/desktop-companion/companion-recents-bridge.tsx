import { useEffect, useRef } from "react";
import { createCompanionBatch } from "./scheduling";
import type { AppSidebarProps } from "../session/sidebar/app-sidebar";
import { getRootSessions, isNeedsAttentionSessionStatus } from "../session/sidebar/utils";
import { useSessionActivityStore } from "../session/status/session-activity-store";
import { useSessionManagementStore } from "../session/sidebar/session-management-store";
import { buildCompanionRecents, companionMemoryKey, companionSessionKey, nextCompanionExpiry, useCompanionSeen } from "./recent-sessions";
import { useCompanionEnabled } from "./use-companion-enabled";

type Source = Pick<AppSidebarProps, "draftScope" | "workspaceSessionGroups" | "selectedWorkspaceId" | "selectedSessionId" | "sessionStatusById" | "onOpenSession">;

/** Reads the existing inventory and activity stream; never starts another engine or transcript poller. */
export function CompanionRecentsBridge({ source }: { source: Source }) {
  const enabled = useCompanionEnabled(source.draftScope !== null);
  const latest = useRef({ source }); latest.current = { source };
  const refresh = useRef<(() => void) | undefined>(undefined);
  useEffect(() => { refresh.current?.(); }, [source.workspaceSessionGroups, source.selectedWorkspaceId, source.selectedSessionId, source.sessionStatusById]);
  useEffect(() => {
    const host = window.__OPENWORK_COMPANION_HOST__;
    if (!host?.recentSessions || !enabled || source.draftScope === null) return;
    let disposed = false, publishing = false, lastPayload = "";
    let expiry: ReturnType<typeof setTimeout> | undefined, expiryAt: number | undefined;
    let cleanup = () => {};
    const scope = source.draftScope ?? "local";
    const candidates = () => {
      const input = latest.current.source;
      const records = useSessionActivityStore.getState().recordsByWorkspaceId;
      const memory = useCompanionSeen.getState().entries;
      return input.workspaceSessionGroups.flatMap(group => getRootSessions(group.sessions).filter(session => !session.time?.archived).map(session => {
        const workspaceId = group.workspace.id, sessionId = session.id;
        const entry = memory[companionMemoryKey(scope, workspaceId, sessionId)];
        const activity = records[workspaceId]?.[sessionId];
        return { key: companionSessionKey(workspaceId, sessionId), workspaceId, sessionId, title: session.title || "Nuevo chat",
          selected: input.selectedWorkspaceId === workspaceId && input.selectedSessionId === sessionId,
          waiting: isNeedsAttentionSessionStatus(input.sessionStatusById?.[sessionId]) || Boolean(activity?.waitingPermissionIds.length || activity?.waitingQuestionIds.length),
          responseAt: Math.max(entry?.responseAt ?? 0, records[workspaceId]?.[sessionId]?.lastAssistantResponseAt ?? 0), readAt: entry?.readAt ?? 0 };
      }));
    };
    void host.state().then(async ({ enabled }) => {
      if (!enabled || disposed) return;
      if (!useCompanionSeen.persist.hasHydrated()) await useCompanionSeen.persist.rehydrate();
      if (disposed) return;
      const read = (key: string, responseAt: number) => {
        const item = candidates().find(session => session.key === key);
        if (!item) return;
        useCompanionSeen.getState().read(companionMemoryKey(scope, item.workspaceId, item.sessionId), responseAt);
        useSessionManagementStore.getState().clearUnread(item.sessionId);
      };
      const batch = createCompanionBatch(() => {
        if (disposed || publishing) return;
        publishing = true;
        try {
          const items = candidates();
          useCompanionSeen.getState().responses(items.map(item => ({ key: companionMemoryKey(scope, item.workspaceId, item.sessionId), at: item.responseAt })));
          const recent = buildCompanionRecents(candidates());
          const payload = JSON.stringify(recent);
          if (payload !== lastPayload) { lastPayload = payload; host.recentSessions(recent); }
          const nextExpiry = nextCompanionExpiry(candidates());
          if (nextExpiry !== expiryAt) {
            clearTimeout(expiry); expiryAt = nextExpiry;
            expiry = nextExpiry === undefined ? undefined : setTimeout(() => { expiryAt = undefined; batch.request(true); }, Math.max(1, nextExpiry - Date.now()));
          }
        } finally { publishing = false; }
      });
      refresh.current = () => batch.request();
      const unsubscribeActivity = useSessionActivityStore.subscribe((state, previous) => {
        if (state.statusesByWorkspaceId !== previous.statusesByWorkspaceId || state.waitingByWorkspaceId !== previous.waitingByWorkspaceId || state.responseTimesByWorkspaceId !== previous.responseTimesByWorkspaceId) batch.request();
      });
      const unsubscribeSeen = useCompanionSeen.subscribe((state, previous) => { if (!publishing && state.entries !== previous.entries) batch.request(); });
      const unsubscribeSelect = host.onSelectSession(key => {
        const item = buildCompanionRecents(candidates()).find(session => session.key === key);
        if (item) latest.current.source.onOpenSession(item.workspaceId, item.sessionId);
      });
      const unsubscribeRead = host.onReadSession(read);
      const unsubscribeView = host.onView?.(() => batch.request(true));
      cleanup = () => {
        batch.dispose(); clearTimeout(expiry); unsubscribeActivity(); unsubscribeSeen(); unsubscribeSelect(); unsubscribeRead(); unsubscribeView?.();
        refresh.current = undefined; host.recentSessions([]);
      };
      batch.request(true);
    }).catch(() => { /* Older shells do not have the recent-session bridge. */ });
    return () => { disposed = true; cleanup(); };
  }, [source.draftScope, enabled]);
  return null;
}

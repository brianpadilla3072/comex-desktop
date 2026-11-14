import { useEffect, useMemo, useRef } from "react";
import type { CompanionAction, CompanionResult, CompanionSnapshot } from "@/app/lib/desktop-companion";
import { companionMemoryKey, useCompanionSeen } from "./recent-sessions";
import { createCompanionBatch } from "./scheduling";
import { useCompanionEnabled } from "./use-companion-enabled";

type Snapshot = Omit<CompanionSnapshot, "target">;
/** Dispatch stays with the existing session. Full transcript projection is requested only while expanded. */
export function useCompanionHost(options: {
  active: boolean;
  owner: string;
  scope?: string;
  urgentKey?: string;
  snapshot: Snapshot | ((detail: boolean) => Snapshot);
  execute: (action: CompanionAction) => Promise<CompanionResult>;
}) {
  const enabled = useCompanionEnabled(options.active);
  const target = useMemo(() => crypto.randomUUID(), [options.owner]);
  const latest = useRef(options); latest.current = options;
  const refresh = useRef<((urgent?: boolean) => void) | undefined>(undefined);
  const urgentKey = options.urgentKey ?? (typeof options.snapshot === "function" ? options.owner : JSON.stringify([
    options.snapshot.state, options.snapshot.canSend, options.snapshot.responseAt, options.snapshot.permission, options.snapshot.question,
  ]));
  useEffect(() => { refresh.current?.(); });
  useEffect(() => { refresh.current?.(true); }, [urgentKey]);
  useEffect(() => {
    const host = window.__OPENWORK_COMPANION_HOST__;
    if (!host || !options.active || !enabled) return;
    let disposed = false, expanded = false, previous = "";
    let cleanup = () => {};
    const seen = new Set<string>();
    void host.state().then(async state => {
      if (!state.enabled || disposed) return;
      if (!useCompanionSeen.persist.hasHydrated()) await useCompanionSeen.persist.rehydrate();
      if (disposed) return;
      expanded = state.expanded === true;
      const batch = createCompanionBatch(() => {
        const current = latest.current;
        if (disposed || !current.active || current.owner !== options.owner) return;
        const source = typeof current.snapshot === "function" ? current.snapshot(expanded) : current.snapshot;
        const snapshot = { ...source, scope: current.scope ?? "local", target, messages: expanded ? source.messages : [], activity: expanded ? source.activity : [] };
        const payload = JSON.stringify(snapshot);
        if (payload !== previous) { previous = payload; host.publish(snapshot); }
        if (snapshot.workspaceId && snapshot.responseAt && document.visibilityState === "visible" && document.hasFocus()) {
          useCompanionSeen.getState().read(companionMemoryKey(current.scope ?? "local", snapshot.workspaceId, snapshot.sessionId), snapshot.responseAt);
        }
      });
      refresh.current = (urgent = false) => { if (urgent || expanded) batch.request(urgent); };
      const unsubscribeView = host.onView?.(value => { expanded = value; batch.request(true); });
      const focus = () => batch.request(true);
      window.addEventListener("focus", focus); document.addEventListener("visibilitychange", focus);
      const unsubscribe = host.onCommand(command => {
        if (disposed || command.target !== target || seen.has(command.id)) return;
        if (!latest.current.active || latest.current.owner !== options.owner) {
          host.reply(command.id, { ok: false, error: "La conversación cambió. Volvé a abrir la cápsula." }); return;
        }
        seen.add(command.id);
        if (seen.size > 1000) { const first = seen.values().next().value; if (first) seen.delete(first); }
        void latest.current.execute(command.action).then(result => host.reply(command.id, result), error => {
          host.reply(command.id, { ok: false, error: error instanceof Error ? error.message.slice(0, 1000) : "No se pudo completar la acción." });
        });
      });
      cleanup = () => { batch.dispose(); unsubscribe(); unsubscribeView?.(); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); refresh.current = undefined; };
      batch.request(true);
    }).catch(() => { /* older desktop builds have no companion */ });
    return () => { disposed = true; cleanup(); host.clear(target); };
  }, [options.active, enabled, target]);
}

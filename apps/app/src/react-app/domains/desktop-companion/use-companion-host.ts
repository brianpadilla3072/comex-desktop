import { useEffect, useMemo, useRef } from "react";
import type { CompanionAction, CompanionResult, CompanionSnapshot } from "@/app/lib/desktop-companion";

/** One host owns dispatch. The small window never starts an engine or receives its credentials. */
export function useCompanionHost(options: {
  active: boolean;
  owner: string;
  snapshot: Omit<CompanionSnapshot, "target">;
  execute: (action: CompanionAction) => Promise<CompanionResult>;
}) {
  const target = useMemo(() => crypto.randomUUID(), [options.owner]);
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    const host = window.__OPENWORK_COMPANION_HOST__;
    if (!host || !options.active) return;
    let disposed = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let unsubscribe: (() => void) | undefined;
    const seen = new Set<string>();
    void host.state().then(({ enabled }) => {
      if (!enabled || disposed) return;
      const publish = () => { if (!disposed) host.publish({ ...latest.current.snapshot, target }); };
      publish(); timer = setInterval(publish, 1000);
      unsubscribe = host.onCommand(command => {
        if (disposed || command.target !== target || seen.has(command.id)) return;
        if (!latest.current.active || latest.current.owner !== options.owner) {
          host.reply(command.id, { ok: false, error: "La conversación cambió. Volvé a abrir la cápsula." }); return;
        }
        seen.add(command.id);
        // A remount/new owner invalidates this listener before it can dispatch.
        const execute = latest.current.execute;
        void execute(command.action).then(result => host.reply(command.id, result), error => {
          host.reply(command.id, { ok: false, error: error instanceof Error ? error.message.slice(0, 1000) : "No se pudo completar la acción." });
        });
      });
    }).catch(() => { /* older desktop builds have no companion */ });
    return () => { disposed = true; clearInterval(timer); unsubscribe?.(); host.clear(target); };
  }, [options.active, target]);
}

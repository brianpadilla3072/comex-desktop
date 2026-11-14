import { useEffect, useState } from "react";

/** Runtime opt-out stops host subscriptions as well as hiding the capsule. */
export function useCompanionEnabled(available = true) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const host = window.__OPENWORK_COMPANION_HOST__;
    if (!host || !available) { setEnabled(false); return; }
    let disposed = false, changed = false;
    const unsubscribe = host.onEnabled?.(value => {
      changed = true;
      if (!disposed) setEnabled(value);
    });
    void host.state().then(state => {
      if (!disposed && !changed) setEnabled(state.enabled);
    }).catch(() => { if (!disposed && !changed) setEnabled(false); });
    return () => { disposed = true; unsubscribe?.(); };
  }, [available]);
  return available && enabled;
}

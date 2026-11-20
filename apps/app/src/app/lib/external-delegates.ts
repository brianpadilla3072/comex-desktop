import { useSyncExternalStore } from "react";

// Flag `externalDelegates` (default off). The desktop config provider pushes the
// server's decision from GET /comex/features; until then the setting stays hidden.
let enabled = false;
const listeners = new Set<() => void>();

export function setExternalDelegatesFeatureEnabled(next: boolean): void {
  if (enabled === next) return;
  enabled = next;
  for (const listener of listeners) listener();
}

export function externalDelegatesFeatureEnabled(): boolean {
  return enabled;
}

export function subscribeExternalDelegatesFeature(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useExternalDelegatesFeature(): boolean {
  return useSyncExternalStore(subscribeExternalDelegatesFeature, externalDelegatesFeatureEnabled, () => false);
}

import { useSyncExternalStore } from "react";

let pending = false;
const listeners = new Set<() => void>();

export function setRemotePairingSetupPending(value: boolean): void {
  if (pending === value) return;
  pending = value;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Coordinates first-run dialogs so remote access and application setup never stack. */
export function useRemotePairingSetupPending(): boolean {
  return useSyncExternalStore(subscribe, () => pending, () => pending);
}

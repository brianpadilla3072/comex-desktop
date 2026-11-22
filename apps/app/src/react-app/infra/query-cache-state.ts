import { useMemo, useSyncExternalStore } from "react";

import type { QueryClient, QueryCacheNotifyEvent } from "@tanstack/react-query";

import { getReactQueryClient } from "./query-client";

/** Events that never change a query's data or state as these hooks read it. A component that
 *  mounts creates its query during render ("added"); passing that on re-rendered the subscriber
 *  in the middle of another component's render ("Cannot update a component while rendering a
 *  different component", hive QA w1-3). React re-reads the snapshot on its next render anyway. */
const IGNORED_EVENTS = new Set<QueryCacheNotifyEvent["type"]>(["added", "observerAdded", "observerRemoved", "observerOptionsUpdated"]);

export function subscribeToQueryCacheChanges(queryClient: QueryClient, onChange: () => void): () => void {
  return queryClient.getQueryCache().subscribe((event) => {
    if (!IGNORED_EVENTS.has(event.type)) onChange();
  });
}

/**
 * Subscribe to a TanStack Query cache entry as plain external state.
 * Pass a null key to pin the fallback (used while route params are missing).
 */
export function useQueryCacheState<T>(queryKey: readonly unknown[] | null, fallback: T): T {
  const queryClient = getReactQueryClient();
  return useSyncExternalStore(
    (callback) => (queryKey ? subscribeToQueryCacheChanges(queryClient, callback) : () => {}),
    () => (queryKey ? queryClient.getQueryData<T>(queryKey) ?? fallback : fallback),
    () => fallback,
  );
}

/**
 * Subscribe to several array-valued cache entries as one stable array. This is
 * useful for a selected session plus a dynamic set of child sessions, where
 * calling one hook per child would violate React's fixed hook ordering.
 */
export function useQueryCacheArrayState<T>(
  queryKeys: readonly (readonly unknown[])[],
  fallback: T[],
): T[] {
  const queryClient = getReactQueryClient();
  const getSnapshot = useMemo(() => {
    let previousEntries: T[][] = [];
    let previousValue = fallback;

    return () => {
      const entries = queryKeys.map((queryKey) => queryClient.getQueryData<T[]>(queryKey) ?? fallback);
      if (
        entries.length === previousEntries.length &&
        entries.every((entry, index) => entry === previousEntries[index])
      ) {
        return previousValue;
      }
      previousEntries = entries;
      previousValue = entries.flat();
      return previousValue;
    };
  }, [fallback, queryClient, queryKeys]);

  return useSyncExternalStore(
    (callback) => subscribeToQueryCacheChanges(queryClient, callback),
    getSnapshot,
    () => fallback,
  );
}

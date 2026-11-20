import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import { useCommandCenterConnection } from "@/react-app/domains/command-center/use-command-center";

import { resultsInboxSnapshotSchema, resultsInboxSummarySchema, resultsInboxUpdateSchema, type ResultsInboxSnapshot } from "./results-inbox-model";

export type ResultsInboxClient = Pick<OpenworkServerClient, "baseUrl" | "getResultsInbox" | "markResultsInboxSeen" | "markAllResultsInboxSeen">;

/** Results arrive at most every few minutes; the page refreshes on focus as well. */
export const RESULTS_INBOX_POLL_MS = 30_000;
/** The sidebar badge is a cheap count; it follows new results within a minute. */
export const RESULTS_INBOX_BADGE_POLL_MS = 60_000;

export const resultsInboxQueryKey = (baseUrl: string): [string, string] => ["results-inbox", baseUrl];
export const resultsInboxSummaryQueryKey = (baseUrl: string): [string, string, string] => ["results-inbox", baseUrl, "summary"];

/** The owner connection the command center uses (host token, or a paired device's token). */
export const useResultsInboxConnection = useCommandCenterConnection;

/**
 * The `resultsInbox` flag as the server resolves it. `known` stays false until the server
 * answered, so a slow or failed read never hides or redirects. Shares the cache entry every
 * other `/comex/features` reader uses.
 */
export function useResultsInboxAvailability(): { enabled: boolean; known: boolean } {
  const connection = useResultsInboxConnection();
  const client = connection.data ?? null;
  const query = useQuery({
    queryKey: ["comex-feature", client?.baseUrl],
    queryFn: () => {
      if (!client) throw new Error("No connection");
      return client.getComexFeatures();
    },
    enabled: Boolean(client),
    staleTime: 15_000,
    refetchInterval: 15_000,
    retry: false,
  });
  if (connection.isSuccess && !client) return { enabled: false, known: true };
  return { enabled: Boolean(client && query.data?.resultsInbox === true), known: query.isSuccess };
}

/** Unread results for the sidebar badge; null while unknown or unreadable (no badge, no guess). */
export function useResultsInboxUnread(enabled: boolean): number | null {
  const connection = useResultsInboxConnection();
  const client = connection.data ?? null;
  const query = useQuery({
    queryKey: resultsInboxSummaryQueryKey(client?.baseUrl ?? ""),
    queryFn: async () => {
      if (!client) throw new Error("No connection");
      return resultsInboxSummarySchema.parse(await client.getResultsInboxSummary());
    },
    enabled: enabled && Boolean(client),
    retry: false,
    refetchInterval: enabled ? RESULTS_INBOX_BADGE_POLL_MS : false,
    refetchOnWindowFocus: true,
  });
  return query.data ? query.data.counts.unseen : null;
}

export function useResultsInboxSnapshot(client: ResultsInboxClient, active: boolean) {
  return useQuery({
    queryKey: resultsInboxQueryKey(client.baseUrl),
    queryFn: async () => resultsInboxSnapshotSchema.parse(await client.getResultsInbox()),
    enabled: active,
    retry: false,
    refetchInterval: active ? RESULTS_INBOX_POLL_MS : false,
    refetchOnWindowFocus: true,
  });
}

/** Seen marks: applied to the cached list at once, then confirmed by the server. */
export function useResultsInboxSeen(client: ResultsInboxClient) {
  const queryClient = useQueryClient();
  const key = resultsInboxQueryKey(client.baseUrl);
  const patch = (update: (snapshot: ResultsInboxSnapshot) => ResultsInboxSnapshot) => {
    const previous = queryClient.getQueryData<ResultsInboxSnapshot>(key);
    if (previous) queryClient.setQueryData<ResultsInboxSnapshot>(key, update(previous));
    return previous;
  };
  const settle = async <T>(previous: ResultsInboxSnapshot | undefined, work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      if (previous) queryClient.setQueryData(key, previous);
      throw error;
    } finally {
      // Prefix match: the list and the sidebar badge both re-read.
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };
  const recount = (snapshot: ResultsInboxSnapshot, items: ResultsInboxSnapshot["items"]): ResultsInboxSnapshot => ({
    ...snapshot, items, counts: { ...snapshot.counts, unseen: items.filter(item => !item.seen).length },
  });
  return {
    setSeen: (ids: string[], seen: boolean) => {
      const now = Date.now();
      const targets = new Set(ids);
      const previous = patch(snapshot => recount(snapshot, snapshot.items.map(item => targets.has(item.id) ? { ...item, seen, seenAt: seen ? now : null } : item)));
      return settle(previous, async () => resultsInboxUpdateSchema.parse(await client.markResultsInboxSeen(ids, seen)));
    },
    setAllSeen: (upTo: number) => {
      const now = Date.now();
      const previous = patch(snapshot => recount(snapshot, snapshot.items.map(item => item.endedAt <= upTo && !item.seen ? { ...item, seen: true, seenAt: now } : item)));
      return settle(previous, async () => resultsInboxUpdateSchema.parse(await client.markAllResultsInboxSeen(upTo)));
    },
  };
}

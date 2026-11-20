import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import { createOpenworkServerClient } from "@/app/lib/openwork-server";
import { resolveOpenworkConnection } from "@/react-app/shell/openwork-connection";
import { useSessionActivityStore } from "@/react-app/domains/session/status/session-activity-store";

import { commandCenterSnapshotSchema } from "./command-center-model";

export type CommandCenterClient = Pick<OpenworkServerClient, "baseUrl" | "getCommandCenter" | "stopCommandCenterSession" | "runSpecialistTaskNow">;

/** Polling covers workspaces this window is not syncing; live events below cover the rest. */
export const COMMAND_CENTER_POLL_MS = 4_000;

export const commandCenterQueryKey = (baseUrl: string): [string, string] => ["command-center", baseUrl];

/** Owner connection (host token on the desktop, the paired token on a paired browser). */
export function useCommandCenterConnection() {
  return useQuery({
    queryKey: ["command-center-connection"],
    queryFn: async () => {
      const connection = await resolveOpenworkConnection();
      if (!connection.normalizedBaseUrl || !connection.resolvedToken) return null;
      return createOpenworkServerClient({ baseUrl: connection.normalizedBaseUrl, token: connection.resolvedToken, hostToken: connection.resolvedHostToken });
    },
    retry: false,
    staleTime: 30_000,
  });
}

/**
 * The `commandCenter` flag as the server resolves it. `known` stays false until
 * the server answered, so a slow or failed read never hides or redirects.
 * Shares the cache entry every other `/comex/features` reader uses.
 */
export function useCommandCenterAvailability(): { enabled: boolean; known: boolean } {
  const connection = useCommandCenterConnection();
  const client = connection.data ?? null;
  const query = useCommandCenterFeatureQuery(client);
  if (connection.isSuccess && !client) return { enabled: false, known: true };
  return { enabled: Boolean(client && query.data?.commandCenter === true), known: query.isSuccess };
}

function useCommandCenterFeatureQuery(client: OpenworkServerClient | null) {
  return useQuery({
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
}

export function useCommandCenterSnapshot(client: CommandCenterClient, active: boolean) {
  const queryClient = useQueryClient();
  const queryKey = commandCenterQueryKey(client.baseUrl);
  const query = useQuery({
    queryKey,
    queryFn: async () => commandCenterSnapshotSchema.parse(await client.getCommandCenter()),
    enabled: active,
    retry: false,
    refetchInterval: active ? COMMAND_CENTER_POLL_MS : false,
    refetchOnWindowFocus: true,
  });

  // Reuse the app's live session status (fed by the event stream) instead of
  // keeping a second copy: any status change re-reads the server's aggregate.
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = useSessionActivityStore.subscribe((state, previous) => {
      if (state.statusesByWorkspaceId === previous.statusesByWorkspaceId && state.waitingByWorkspaceId === previous.waitingByWorkspaceId) return;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void queryClient.invalidateQueries({ queryKey: commandCenterQueryKey(client.baseUrl) });
      }, 400);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [active, client.baseUrl, queryClient]);

  return query;
}

/** A ticking clock for elapsed times, only while the page is visible. */
export function useNow(active: boolean, intervalMs = 1_000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
  return now;
}

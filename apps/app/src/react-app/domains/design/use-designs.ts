import { useQuery } from "@tanstack/react-query";

import { useCommandCenterConnection } from "@/react-app/domains/command-center/use-command-center";

import { designQueryKeys, type DesignClient } from "./design-client";

/** The owner connection the command center and the Projects pages use (host token or paired device). */
export const useDesignConnection = useCommandCenterConnection;

/**
 * The `designStudio` flag as the server resolves it. `known` stays false until the server
 * answered, so a slow or failed read never hides or redirects. Shares the cache entry every other
 * `/comex/features` reader uses.
 */
export function useDesignStudioAvailability(): { enabled: boolean; known: boolean } {
  const connection = useDesignConnection();
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
  return { enabled: Boolean(client && query.data?.designStudio === true), known: query.isSuccess };
}

export function useDesignList(client: Pick<DesignClient, "baseUrl" | "listDesigns"> | null) {
  return useQuery({
    queryKey: designQueryKeys.list(client?.baseUrl ?? ""),
    queryFn: () => {
      if (!client) throw new Error("No connection");
      return client.listDesigns();
    },
    enabled: Boolean(client),
    retry: false,
    staleTime: 5_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

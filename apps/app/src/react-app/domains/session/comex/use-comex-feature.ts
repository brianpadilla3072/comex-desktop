import { useQuery } from "@tanstack/react-query";
import type { OpenworkServerClient } from "@/app/lib/openwork-server";

const comexFeatureQueryKey = (client: OpenworkServerClient | null) => ["comex-feature", client?.baseUrl] as const;

function useComexFeatureData(client: OpenworkServerClient | null) {
  return useQuery({
    queryKey: comexFeatureQueryKey(client),
    queryFn: () => {
      if (!client) throw new Error("No hay conexión al proyecto");
      return client.getComexFeatures();
    },
    enabled: Boolean(client),
    staleTime: 15_000,
    refetchInterval: 15_000,
    retry: false,
  });
}

export function useComexFeature(client: OpenworkServerClient | null, includeTasks = false): boolean {
  const query = useComexFeatureData(client);
  return Boolean(client && !query.isError && (query.data?.enabled || includeTasks && query.data?.taskContinuity));
}

/** Gate for the artifact shell; shares the single /comex/features query. */
export function useComexArtifactsFeature(client: OpenworkServerClient | null): boolean {
  const query = useComexFeatureData(client);
  return Boolean(client && !query.isError && query.data?.enabled && query.data?.comexArtifacts);
}

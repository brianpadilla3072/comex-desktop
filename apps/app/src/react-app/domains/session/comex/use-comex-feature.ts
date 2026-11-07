import { useQuery } from "@tanstack/react-query";
import type { OpenworkServerClient } from "@/app/lib/openwork-server";

export function useComexFeature(client: OpenworkServerClient | null, includeTasks = false): boolean {
  const query = useQuery({
    queryKey: ["comex-feature", client?.baseUrl],
    queryFn: () => {
      if (!client) throw new Error("No hay conexión al proyecto");
      return client.getComexFeatures();
    },
    enabled: Boolean(client),
    staleTime: 15_000,
    refetchInterval: 15_000,
    retry: false,
  });
  return Boolean(client && !query.isError && (query.data?.enabled || includeTasks && query.data?.taskContinuity));
}

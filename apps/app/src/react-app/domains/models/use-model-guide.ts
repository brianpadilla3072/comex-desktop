import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { guideObservationSchema, type GuideObservation, type GuideSnapshot } from "@openwork/types/model-guide";
import { createOpenworkServerClient } from "@/app/lib/openwork-server";
import type { ModelOption } from "@/app/types";
import { resolveOpenworkConnection } from "@/react-app/shell/openwork-connection";

/** Only sanitized catalog metadata is persisted; provider options, URLs and credentials are never submitted. */
export function modelGuideObservations(options: readonly ModelOption[]): GuideObservation[] {
  const unique = new Map<string, GuideObservation>();
  for (const option of options) {
    const parsed = guideObservationSchema.safeParse(option.guideObservation ?? {
      providerID: option.providerID, modelID: option.modelID, name: option.title, providerName: option.description ?? option.providerID,
      pricing: null, freeVerified: false, tools: null, reasoning: null, input: [], context: null, efforts: option.behaviorOptions?.flatMap(value => value.value ? [value.value] : []) ?? [],
    });
    if (parsed.success) unique.set(JSON.stringify([option.providerID, option.modelID]), parsed.data);
  }
  return [...unique.values()];
}

export function useModelGuide(options: readonly ModelOption[], enabled: boolean) {
  const queryClient = useQueryClient();
  const scope = typeof location === "undefined" ? "default" : location.pathname.split("/session")[0] || "default";
  const connection = useQuery({ queryKey: ["model-guide-connection"], enabled, staleTime: 15_000, queryFn: resolveOpenworkConnection });
  const client = useMemo(() => connection.data?.normalizedBaseUrl && connection.data.resolvedToken
    ? createOpenworkServerClient({ baseUrl: connection.data.normalizedBaseUrl, token: connection.data.resolvedToken, hostToken: connection.data.resolvedHostToken }) : null, [connection.data]);
  const queryKey = ["model-guide", connection.data?.normalizedBaseUrl, scope];
  const query = useQuery({ queryKey, enabled: enabled && Boolean(client), staleTime: 60_000, refetchInterval: enabled ? 60_000 : false, retry: false,
    queryFn: () => { if (!client) throw new Error("Sin conexión al catálogo local"); return client.getModelGuide(scope); },
  });
  const observations = useMemo(() => modelGuideObservations(options), [options]);
  const serialized = JSON.stringify(observations);
  useEffect(() => {
    if (!enabled || !client || observations.length === 0) return;
    let active = true;
    void client.discoverModels(scope, observations).then(data => {
      if (active) queryClient.setQueryData<GuideSnapshot>(["model-guide", client.baseUrl, scope], data);
    }).catch(() => { /* Read-only/offline: the shipped or cached catalog remains usable. */ });
    return () => { active = false; };
  // Serialized observations avoid writes for unrelated picker renders.
  }, [enabled, client, scope, serialized, queryClient]);
  const refresh = async () => {
    if (!client) return;
    const next = await client.refreshModelGuide(scope);
    queryClient.setQueryData(queryKey, next);
  };
  return { snapshot: enabled ? query.data : undefined, refresh, isError: query.isError, loading: query.isPending };
}

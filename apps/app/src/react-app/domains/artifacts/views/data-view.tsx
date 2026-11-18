/** @jsxImportSource react */
import { useQuery } from "@tanstack/react-query";
import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import { PreviewError } from "../../session/artifacts/preview";
import { PanelResolutionBlocks } from "../../specialists/library-dialog";
import { MarkdownPreview } from "../../session/artifacts/preview";

interface DataViewProps {
  client: OpenworkServerClient;
  appId: string;
  artifactId: string;
  workspaceId?: string;
  narrative?: string;
}

/** Live data: the artifact stores a deterministic panel spec; resolution always reads the
 *  dataset's LATEST snapshot through the same engine as the Studio panels. No duplicated logic,
 *  no AI-authored code and no captured screenshot. */
export function DataView({ client, appId, artifactId, workspaceId, narrative }: DataViewProps) {
  const query = useQuery({
    queryKey: ["artifact-resolve", client.baseUrl, appId, workspaceId, artifactId],
    queryFn: () => client.resolveArtifact(appId, artifactId, workspaceId),
    retry: false,
    refetchInterval: 15_000,
  });

  if (query.isPending) return <div className="p-6 text-sm text-muted-foreground" role="status">Resolviendo datos del proyecto…</div>;
  if (query.isError || !query.data) return <PreviewError message={query.error instanceof Error ? query.error.message : "No se pudieron resolver los datos."} />;

  const { spec, resolution } = query.data;
  return (
    <div className="grid gap-3 p-6">
      {narrative ? <MarkdownPreview content={narrative} className="max-w-[68ch] overflow-visible p-0" /> : null}
      <p className="text-xs text-muted-foreground" data-testid="artifact-data-source">
        {resolution.ok ? `Fuente viva: ${resolution.sourceLabel}` : "Fuente no disponible"}
      </p>
      <PanelResolutionBlocks resolution={resolution} spec={spec} />
    </div>
  );
}

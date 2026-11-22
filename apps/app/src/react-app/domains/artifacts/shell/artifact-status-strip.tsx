import { Badge } from "@/components/ui/badge";
import type { ArtifactBase } from "../types";

const STATUS_LABEL: Record<ArtifactBase["status"], string> = {
  streaming: "Generando", draft: "Borrador", saved: "Guardado", archived: "Archivado",
};

export function ArtifactStatusStrip({ meta }: { meta: ArtifactBase }) {
  const audit = meta.metadata.audit;
  const version = meta.versions.at(-1);
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground">
      <Badge variant="secondary">{meta.type}</Badge>
      <Badge variant={meta.status === "saved" ? "default" : "outline"}>{STATUS_LABEL[meta.status]}</Badge>
      {version ? <span data-testid="artifact-version">{version.id}</span> : null}
      {meta.metadata.workspaceName ? <span>{meta.metadata.workspaceName}</span> : null}
      {audit ? (
        <span data-testid="artifact-audit" className={audit.invalid.length ? "text-destructive" : undefined}>
          {audit.valid}/{audit.total} citas{audit.invalid.length ? ` · ${audit.invalid.length} rotas` : ""}
        </span>
      ) : null}
    </div>
  );
}

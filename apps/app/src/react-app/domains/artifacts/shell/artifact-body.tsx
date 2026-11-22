import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import type { ArtifactRecord } from "../types";
import { DocView } from "../views/doc-view";
import { DataView } from "../views/data-view";
import { SlidesView } from "../views/slides-view";
import { SheetView } from "../views/sheet-view";
import { BoardView } from "../views/board-view";

/** Fail loud: an unimplemented renderer says so, it never shows a blank canvas. */
interface ArtifactBodyProps {
  artifact: ArtifactRecord;
  client: OpenworkServerClient;
  appId: string;
  workspaceId?: string;
}

export function ArtifactBody({ artifact, client, appId, workspaceId }: ArtifactBodyProps) {
  if (artifact.meta.type === "doc") return <DocView content={artifact.content} />;
  if (artifact.meta.type === "data") {
    const parsed: unknown = (() => { try { return JSON.parse(artifact.content); } catch { return null; } })();
    const narrative = typeof parsed === "object" && parsed !== null && "narrative" in parsed && typeof Reflect.get(parsed, "narrative") === "string"
      ? Reflect.get(parsed, "narrative") as string : undefined;
    return <DataView client={client} appId={appId} artifactId={artifact.meta.id} workspaceId={workspaceId} narrative={narrative} />;
  }
  if (artifact.meta.type === "slides") {
    return <SlidesView content={artifact.content} />;
  }
  if (artifact.meta.type === "sheet") {
    return <SheetView content={artifact.content} />;
  }
  if (artifact.meta.type === "board") {
    return <BoardView content={artifact.content} />;
  }
  return (
    <div className="p-6 text-sm text-muted-foreground" role="status">
      El artefacto <strong>{artifact.meta.type}</strong> todavía no tiene visor en este shell.
      El contenido y sus versiones están guardados en el proyecto; el visor llega con su sub-issue.
    </div>
  );
}

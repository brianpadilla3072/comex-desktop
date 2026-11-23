import { lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";

import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import type { ArtifactRecord } from "../types";
import { DocView } from "../views/doc-view";
import { DataView } from "../views/data-view";
import { SlidesView } from "../views/slides-view";
import { SheetView } from "../views/sheet-view";
import { BoardView } from "../views/board-view";
import { tableRowsToSheetContent } from "../views/table-to-sheet";

const JspreadsheetView = lazy(() =>
  import("../views/jspreadsheet-view").then((module) => ({ default: module.JspreadsheetView })),
);

/** Fail loud: an unimplemented renderer says so, it never shows a blank canvas. */
interface ArtifactBodyProps {
  artifact: ArtifactRecord;
  client: OpenworkServerClient;
  appId: string;
  workspaceId?: string;
}

export function ArtifactBody({ artifact, client, appId, workspaceId }: ArtifactBodyProps) {
  const features = useQuery({
    queryKey: ["comex-features", client.baseUrl],
    queryFn: () => client.getComexFeatures(),
    retry: false,
    staleTime: 15_000,
  });
  const excelEditorEnabled = features.data?.artifactSpreadsheetEditor === true;

  if (artifact.meta.type === "doc") return <DocView content={artifact.content} />;
  if (artifact.meta.type === "data") {
    // Salidas `table` del mini-Studio se guardaron como `data` con filas JSON crudas;
    // el resolve de panel falla (422). Renderizamos como hoja para que sí se abra.
    const sheetContent = tableRowsToSheetContent(artifact.content);
    if (sheetContent) return <SheetView content={sheetContent} />;
    const parsed: unknown = (() => { try { return JSON.parse(artifact.content); } catch { return null; } })();
    const narrative = typeof parsed === "object" && parsed !== null && "narrative" in parsed && typeof Reflect.get(parsed, "narrative") === "string"
      ? Reflect.get(parsed, "narrative") as string : undefined;
    return <DataView client={client} appId={appId} artifactId={artifact.meta.id} workspaceId={workspaceId} narrative={narrative} />;
  }
  if (artifact.meta.type === "slides") {
    return <SlidesView content={artifact.content} />;
  }
  if (artifact.meta.type === "sheet") {
    if (excelEditorEnabled) {
      return (
        <Suspense fallback={<div className="p-6 text-sm text-muted-foreground" role="status">Cargando hoja de cálculo…</div>}>
          <JspreadsheetView content={artifact.content} />
        </Suspense>
      );
    }
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

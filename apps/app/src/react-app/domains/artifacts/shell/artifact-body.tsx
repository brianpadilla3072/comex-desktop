import { lazy, Suspense } from "react";

import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import type { ArtifactMetadata, ArtifactRecord, DocComment } from "../types";
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
  /** Persist an edit as a new artifact version (used by the editable sheet title). */
  onSave?: (patch: { title?: string; content?: string }) => void | Promise<void>;
  /** Presentation/review state lives in metadata and never creates a content version. */
  onMetadataChange?: (patch: Partial<ArtifactMetadata>) => void | Promise<void>;
}

export function ArtifactBody({ artifact, client, appId, workspaceId, onSave, onMetadataChange }: ArtifactBodyProps) {
  if (artifact.meta.type === "doc") return <DocView
    content={artifact.content}
    title={artifact.meta.title}
    format={artifact.meta.metadata.viewer?.format}
    viewer={artifact.meta.metadata.viewer}
    comments={artifact.meta.metadata.comments}
    sources={artifact.meta.sources}
    audit={artifact.meta.metadata.audit}
    onContentChange={(content) => void onSave?.({ content })}
    onViewerChange={(viewer) => void onMetadataChange?.({ viewer: { ...artifact.meta.metadata.viewer, ...viewer } })}
    onCommentsChange={(comments: DocComment[]) => void onMetadataChange?.({ comments })}
  />;
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
    return (
      <Suspense fallback={<div className="p-6 text-sm text-muted-foreground" role="status">Cargando hoja de cálculo…</div>}>
        <JspreadsheetView
          content={artifact.content}
          title={artifact.meta.title}
          onTitleChange={(title) => void onSave?.({ title })}
          onChange={(updatedContent) => void onSave?.({ content: updatedContent })}
        />
      </Suspense>
    );
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

/** @jsxImportSource react */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "bun:test";
import React from "react";
import { ArtifactHeader } from "../src/react-app/domains/artifacts/shell/artifact-header";
import type { ArtifactBase } from "../src/react-app/domains/artifacts/types";

const meta: ArtifactBase = {
  id: "art-1",
  type: "sheet",
  title: "Hoja de cálculo",
  status: "saved",
  sources: [],
  versions: [{ id: "v1", createdAt: 1, author: "agent", contentRef: "v1" }],
  metadata: { workspaceId: "ws-1", schemaVersion: 1 },
  createdAt: 1,
  updatedAt: 1,
};

function render(canRevert: boolean) {
  return renderToStaticMarkup(
    <ArtifactHeader
      meta={meta}
      focusMode={false}
      canRevert={canRevert}
      onToggleFocus={() => undefined}
      onCopy={() => undefined}
      onExport={() => undefined}
      onRequestChange={() => undefined}
      onRevert={() => undefined}
      onClose={() => undefined}
    />,
  );
}

describe("ArtifactHeader actions", () => {
  test("copy, export, request change, maximize and close are in the header toolbar", () => {
    const html = render(true);
    expect(html).toContain('aria-label="Acciones del artefacto"');
    for (const label of ["Copiar contenido", "Exportar .md", "Pedir un cambio", "Descartar cambios", "Maximizar artefacto", "Cerrar artefacto"]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
  });

  test("discard only appears when there is a previous version to go back to", () => {
    expect(render(true)).toContain('aria-label="Descartar cambios"');
    expect(render(false)).not.toContain('aria-label="Descartar cambios"');
  });
});

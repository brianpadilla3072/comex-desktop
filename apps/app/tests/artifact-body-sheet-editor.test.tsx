/** @jsxImportSource react */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://localhost/" });
import { renderToStaticMarkup } from "react-dom/server";
import { describe, test, expect } from "bun:test";
import React from "react";
import { ArtifactBody } from "../src/react-app/domains/artifacts/shell/artifact-body";

const meta = { id: "art_sheet", type: "sheet" as const, title: "Exportaciones", status: "draft" as const, sources: [], versions: [], schemaVersion: 1 as const };
const client = { baseUrl: "http://localhost:44129" } as never;
const content = JSON.stringify({ sheets: [{ id: "s1", name: "Datos", cells: { A1: { value: "Producto" } } }] });

describe("ArtifactBody sheet editor (no flag)", () => {
  test("a sheet artifact always renders the Jspreadsheet editor without querying features", () => {
    // No QueryClientProvider: if ArtifactBody queried /comex/features again, this would throw.
    // The lazy editor renders its Suspense fallback in static markup; the old read-only
    // SheetView must never appear for a sheet artifact.
    const html = renderToStaticMarkup(<ArtifactBody artifact={{ meta, content }} client={client} appId="app_demo" />);
    expect(html).toContain("Cargando hoja de cálculo");
    expect(html).not.toContain('data-testid="sheet-view"');
    expect(html).not.toContain('data-testid="sheet-tabs"');
  });
});

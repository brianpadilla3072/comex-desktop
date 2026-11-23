/** @jsxImportSource react */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://localhost/" });
import { renderToStaticMarkup } from "react-dom/server";
import { describe, test, expect } from "bun:test";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ArtifactBody } from "../src/react-app/domains/artifacts/shell/artifact-body";

const meta = { id: "art_demo", type: "data" as const, title: "Demo", status: "draft" as const, sources: [], versions: [], schemaVersion: 1 as const };
const client = { baseUrl: "http://localhost:44129" } as never;

describe("ArtifactBody sheet fallback", () => {
  test("data artifact with JSON rows renders as sheet tabs", () => {
    const content = JSON.stringify([{ producto: "Soja", usd: 1200 }, { producto: "Trigo", usd: 800 }]);
    const qc = new QueryClient();
    const html = renderToStaticMarkup(<QueryClientProvider client={qc}><ArtifactBody artifact={{ meta, content }} client={client} appId="app_demo" /></QueryClientProvider>);
    expect(html).toContain('data-testid="sheet-view"');
    expect(html).toContain('data-testid="sheet-tabs"');
    expect(html).toContain("Soja");
    expect(html).toContain("1200");
  });

  test("data artifact without rows still uses the panel view (no sheet)", () => {
    const content = JSON.stringify({ narrative: "hola", blocks: [] });
    const qc = new QueryClient();
    const html = renderToStaticMarkup(<QueryClientProvider client={qc}><ArtifactBody artifact={{ meta, content }} client={client} appId="app_demo" /></QueryClientProvider>);
    expect(html).not.toContain('data-testid="sheet-view"');
  });
});

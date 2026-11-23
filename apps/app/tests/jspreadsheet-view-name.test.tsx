/** @jsxImportSource react */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://localhost/" });
import { renderToStaticMarkup } from "react-dom/server";
import { describe, test, expect } from "bun:test";
import React from "react";
import { JspreadsheetView } from "../src/react-app/domains/artifacts/views/jspreadsheet-view";

const content = JSON.stringify({ sheets: [{ id: "s1", name: "Hoja1", cells: { A1: { value: "Hola" } } }] });

describe("JspreadsheetView file name", () => {
  test("the file name is an editable input showing the artifact title", () => {
    const html = renderToStaticMarkup(<JspreadsheetView content={content} title="Exportaciones de ejemplo" />);
    expect(html).toContain('data-testid="sheet-file-name"');
    expect(html).toContain('value="Exportaciones de ejemplo"');
    expect(html).toContain('aria-label="Nombre del archivo"');
  });

  test("without a title prop it falls back to the default sheet name", () => {
    const html = renderToStaticMarkup(<JspreadsheetView content={content} />);
    expect(html).toContain('value="Hoja de cálculo"');
  });
});

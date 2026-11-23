/** @jsxImportSource react */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://localhost/" });
import { afterAll, describe, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import React from "react";

const previousAct = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
afterAll(() => Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousAct));

type MockWorksheet = {
  parent: { worksheets: MockWorksheet[] };
  getData: () => string[][];
  insertRow: (count: number) => void;
  insertColumn: (count: number) => void;
  getValueFromCoords: (x: number, y: number, processed?: boolean) => string;
  updateSelectionFromCoords: (x: number, y: number) => void;
  openWorksheet: (index: number) => void;
  createWorksheet: (options: unknown) => void;
};

const state = {
  init: 0,
  destroy: 0,
  onchange: null as ((instance: MockWorksheet) => void) | null,
  rows: 60,
};
const instance: MockWorksheet = {
  parent: { worksheets: [] },
  getData: () => [],
  insertRow: (count) => { state.rows += count; },
  insertColumn: () => undefined,
  getValueFromCoords: () => "",
  updateSelectionFromCoords: () => undefined,
  openWorksheet: () => undefined,
  createWorksheet: () => undefined,
};

// The library owns the DOM of the grid; a recording stub is enough to observe
// when the view tears it down and builds it again.
mock.module("jspreadsheet-ce", () => ({
  default: Object.assign(
    (_root: HTMLElement, options: { onchange?: (sheet: MockWorksheet) => void }) => {
      state.init += 1;
      state.onchange = options.onchange ?? null;
      instance.parent.worksheets = [instance];
      return [instance];
    },
    { destroy: () => { state.destroy += 1; } },
  ),
}));

const { JspreadsheetView } = await import("../src/react-app/domains/artifacts/views/jspreadsheet-view");

const initial = JSON.stringify({ sheets: [{ id: "s1", name: "Hoja1", cells: { A1: { value: "Producto" } } }] });
const external = JSON.stringify({ sheets: [{ id: "s1", name: "Hoja1", cells: { A1: { value: "Otro" } } }] });

describe("JspreadsheetView growth", () => {
  test("the echo of our own save does not rebuild the grid back to 60 rows", async () => {
    state.init = 0;
    state.destroy = 0;
    state.rows = 60;
    let emitted = "";
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const render = (content: string) => (
      <JspreadsheetView content={content} onChange={(updated) => { emitted = updated; }} />
    );

    try {
      await act(async () => { root.render(render(initial)); });
      expect(state.init).toBe(1);

      // Reaching the bottom edge grows the live instance by 50 rows.
      state.onchange?.(instance);
      expect(state.rows).toBe(60);
      expect(emitted).not.toBe(initial);

      // The shell saves that JSON and refetches it. The identical string is our
      // own echo: rebuilding here is what snapped the sheet back to 60 rows.
      await act(async () => { root.render(render(emitted)); });
      expect(state.destroy).toBe(0);
      expect(state.init).toBe(1);

      // A genuine change from outside still reloads the document.
      await act(async () => { root.render(render(external)); });
      expect(state.destroy).toBe(1);
      expect(state.init).toBe(2);
    } finally {
      await act(async () => { root.unmount(); });
      host.remove();
    }
  });
});

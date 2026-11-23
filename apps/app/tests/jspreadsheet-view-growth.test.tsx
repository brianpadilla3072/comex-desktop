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
  onselection: null as ((instance: MockWorksheet, x: number, y: number) => void) | null,
  rows: 60,
  cols: 26,
};
const instance: MockWorksheet = {
  parent: { worksheets: [] },
  getData: () => [],
  insertRow: (count) => { state.rows += count; },
  insertColumn: (count) => { state.cols += count; },
  getValueFromCoords: () => "",
  updateSelectionFromCoords: () => undefined,
  openWorksheet: () => undefined,
  createWorksheet: () => undefined,
};

function resetState() {
  state.init = 0;
  state.destroy = 0;
  state.onchange = null;
  state.onselection = null;
  state.rows = 60;
  state.cols = 26;
}

function setScroll(element: Element | null, metrics: {
  top?: number; left?: number;
  clientHeight?: number; scrollHeight?: number;
  clientWidth?: number; scrollWidth?: number;
}) {
  if (!element) throw new Error("missing scroll container");
  Object.defineProperties(element, {
    scrollTop: { configurable: true, writable: true, value: metrics.top ?? 0 },
    scrollLeft: { configurable: true, writable: true, value: metrics.left ?? 0 },
    clientHeight: { configurable: true, value: metrics.clientHeight ?? 0 },
    scrollHeight: { configurable: true, value: metrics.scrollHeight ?? 0 },
    clientWidth: { configurable: true, value: metrics.clientWidth ?? 0 },
    scrollWidth: { configurable: true, value: metrics.scrollWidth ?? 0 },
  });
}

// The library owns the DOM of the grid; a recording stub is enough to observe
// when the view tears it down and which containers actually receive scroll events.
mock.module("jspreadsheet-ce", () => ({
  default: Object.assign(
    (root: HTMLElement, options: {
      onchange?: (sheet: MockWorksheet) => void;
      onselection?: (sheet: MockWorksheet, x: number, y: number) => void;
    }) => {
      state.init += 1;
      state.onchange = options.onchange ?? null;
      state.onselection = options.onselection ?? null;
      const content = document.createElement("div");
      content.className = "jss_content";
      const tabs = document.createElement("div");
      tabs.className = "jtabs-content";
      tabs.append(content);
      root.append(tabs);
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
    resetState();
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

      // A change serializes the live instance; the echo of that save must not
      // destroy it and rebuild at the initial size.
      state.onchange?.(instance);
      expect(state.rows).toBe(60);
      expect(emitted).not.toBe(initial);

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

  test("grows continuously past 110 rows and column Z on selection and on the real scrollers", async () => {
    resetState();
    const host = document.createElement("div");
    host.className = "sheet-editor__grid";
    document.body.append(host);
    const root = createRoot(host);

    try {
      await act(async () => { root.render(<JspreadsheetView content={initial} />); });

      // Selection adds only the missing spare rows/columns: no 110/Z ceiling.
      await act(async () => { state.onselection?.(instance, 0, 59); });
      expect(state.rows).toBe(80);
      await act(async () => { state.onselection?.(instance, 25, 79); });
      expect(state.rows).toBe(100);
      expect(state.cols).toBe(34);
      await act(async () => {
        for (let y = 99; y < 220; y += 20) state.onselection?.(instance, 33, y);
      });
      expect(state.rows).toBeGreaterThan(220);
      expect(state.cols).toBeGreaterThan(26);

      // The library's inner content does not scroll in our layout.
      const beforeInner = state.rows;
      await act(async () => {
        host.querySelector(".jss_content")?.dispatchEvent(new Event("scroll"));
      });
      expect(state.rows).toBe(beforeInner);

      // Our grid wrapper scrolls vertically; `.jtabs-content` horizontally.
      const grid = host.querySelector<HTMLElement>(".sheet-editor__grid");
      const beforeRows = state.rows;
      await act(async () => {
        setScroll(grid, { top: 1000, clientHeight: 200, scrollHeight: 1100 });
        grid?.dispatchEvent(new Event("scroll"));
      });
      expect(state.rows).toBeGreaterThan(beforeRows);

      await new Promise(resolve => setTimeout(resolve, 100));
      const beforeCols = state.cols;
      await act(async () => {
        setScroll(host.querySelector(".jtabs-content"), { left: 1000, clientWidth: 200, scrollWidth: 1100 });
        host.querySelector(".jtabs-content")?.dispatchEvent(new Event("scroll"));
      });
      expect(state.cols).toBeGreaterThan(beforeCols);
    } finally {
      await act(async () => { root.unmount(); });
      host.remove();
    }
  });
});

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

type MockSheet = {
  parent: { worksheets: MockSheet[] };
  getData: (highlighted?: boolean, processed?: boolean) => string[][];
  getValueFromCoords: (x: number, y: number, processed?: boolean) => string;
  getSelection: () => [number, number, number, number];
  setValueFromCoords: (x: number, y: number, value: string) => void;
  getStyle: () => string;
  insertRow: (...args: unknown[]) => void;
  insertColumn: (...args: unknown[]) => void;
  updateSelectionFromCoords: (x: number, y: number) => void;
  openWorksheet: (index: number) => void;
  createWorksheet: (options: unknown) => void;
};

const state = {
  raw: [] as string[][],
  rendered: [] as string[][],
  selection: [0, 0, 0, 0] as [number, number, number, number],
  initData: [] as string[][][],
  writes: [] as Array<[number, number, string]>,
  onchange: null as ((sheet: MockSheet) => void) | null,
  onselection: null as ((sheet: MockSheet, x: number, y: number) => void) | null,
};

const instance: MockSheet = {
  parent: { worksheets: [] },
  // CE's `processed` flag is the difference between "=B3*C3" and "20". The view
  // must ask for the raw value when it saves, or a formula comes back as a dead number.
  getData: (_highlighted, processed) => (processed ? state.rendered : state.raw),
  getValueFromCoords: (x, y, processed) => {
    const grid = processed ? state.rendered : state.raw;
    return grid[y]?.[x] ?? "";
  },
  getSelection: () => state.selection,
  setValueFromCoords: (x, y, value) => {
    state.writes.push([x, y, value]);
    state.raw[y] ??= [];
    state.raw[y][x] = value;
    state.onchange?.(instance);
  },
  getStyle: () => "",
  insertRow: () => undefined,
  insertColumn: () => undefined,
  updateSelectionFromCoords: () => undefined,
  openWorksheet: () => undefined,
  createWorksheet: () => undefined,
};

function resetState() {
  state.raw = [
    ["Producto", "Precio", "Cantidad", "Total"],
    ["Manzana", "10", "2", ""],
    ["Pera", "20", "3", "=B3*C3"],
  ];
  state.rendered = state.raw.map(row => [...row]);
  state.rendered[2][3] = "20";
  state.selection = [0, 0, 0, 0];
  state.initData = [];
  state.writes = [];
  state.onchange = null;
  state.onselection = null;
}

mock.module("jspreadsheet-ce", () => ({
  default: Object.assign(
    (root: HTMLElement, options: {
      worksheets?: Array<{ data: string[][] }>;
      onchange?: (sheet: MockSheet) => void;
      onselection?: (sheet: MockSheet, x: number, y: number) => void;
    }) => {
      const data = options.worksheets?.[0]?.data ?? [];
      state.initData.push(data);
      state.onchange = options.onchange ?? null;
      state.onselection = options.onselection ?? null;
      const tabs = document.createElement("div");
      tabs.className = "jtabs-content";
      const content = document.createElement("div");
      content.className = "jss_content";
      const table = document.createElement("table");
      table.className = "jss_worksheet";
      for (let y = 0; y < data.length; y += 1) {
        for (let x = 0; x < (data[y]?.length ?? 0); x += 1) {
          const td = document.createElement("td");
          td.setAttribute("data-x", String(x));
          td.setAttribute("data-y", String(y));
          td.textContent = data[y][x];
          table.append(td);
        }
      }
      content.append(table);
      tabs.append(content);
      root.append(tabs);
      instance.parent.worksheets = [instance];
      return [instance];
    },
    { destroy: () => undefined },
  ),
}));

const { JspreadsheetView } = await import("../src/react-app/domains/artifacts/views/jspreadsheet-view");

const initial = JSON.stringify({
  sheets: [{
    id: "s1",
    name: "Hoja1",
    cells: {
      A1: { value: "Producto" }, B1: { value: "Precio" }, C1: { value: "Cantidad" }, D1: { value: "Total" },
      A2: { value: "Manzana" }, B2: { value: "10" }, C2: { value: "2" },
      A3: { value: "Pera" }, B3: { value: "20" }, C3: { value: "3" },
      D3: { formula: "=B3*C3" },
    },
  }],
});

type View = {
  host: HTMLDivElement;
  root: ReturnType<typeof createRoot>;
  bar: () => HTMLInputElement;
  ref: () => string | undefined;
  cell: (x: number, y: number) => HTMLElement;
};

async function mount(content: string, onChange?: (value: string) => void): Promise<View> {
  const host = document.createElement("div");
  host.className = "sheet-editor__grid";
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<JspreadsheetView content={content} onChange={onChange} />);
  });
  const required = <T extends Element>(selector: string): T => {
    const element = host.querySelector<T>(selector);
    if (!element) throw new Error(`missing ${selector}`);
    return element;
  };
  return {
    host,
    root,
    bar: () => required<HTMLInputElement>("[data-testid=sheet-formula-input]"),
    ref: () => host.querySelector(".sheet-editor__formula-ref")?.textContent ?? undefined,
    cell: (x, y) => required<HTMLElement>(`td[data-x="${x}"][data-y="${y}"]`),
  };
}

async function unmount(view: View) {
  await act(async () => { view.root.unmount(); });
  view.host.remove();
}

async function pressEquals(view: View) {
  await act(async () => {
    view.cell(0, 0).dispatchEvent(new KeyboardEvent("keydown", { key: "=", bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

async function clickCell(view: View, x: number, y: number) {
  await act(async () => {
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    view.cell(x, y).dispatchEvent(event);
    // Jspreadsheet moves the selection unless our reference picker swallowed the
    // mousedown. Modeling that distinction is what makes the regressions visible.
    if (!event.defaultPrevented) {
      state.selection = [x, y, x, y];
      state.onselection?.(instance, x, y);
    }
  });
}

async function pressBarKey(view: View, key: string) {
  await act(async () => {
    view.bar().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

describe("JspreadsheetView formulas", () => {
  test("saves the raw formula and restores it on remount", async () => {
    resetState();
    let emitted = "";
    const first = await mount(initial, value => { emitted = value; });
    try {
      await act(async () => { state.onchange?.(instance); });
      const saved = JSON.parse(emitted) as {
        sheets: Array<{ cells: Record<string, { value: string; formula?: string }> }>;
      };
      expect(saved.sheets[0].cells.D3).toEqual({ value: "", formula: "=B3*C3" });
      // The rendered result is not stored anywhere: a real "20" in B3 stays a value.
      expect(saved.sheets[0].cells.B3).toEqual({ value: "20" });
    } finally {
      await unmount(first);
    }

    const second = await mount(emitted);
    try {
      expect(state.initData.at(-1)?.[2]?.[3]).toBe("=B3*C3");
    } finally {
      await unmount(second);
    }
  });

  test("typing = over a cell moves the caret to that cell in the formula bar", async () => {
    resetState();
    state.selection = [0, 4, 0, 4];
    const view = await mount(initial);
    try {
      await pressEquals(view);
      expect(view.bar().value).toBe("=");
      expect(document.activeElement).toBe(view.bar());
      expect(view.ref()).toBe("A5");
      expect(state.writes).toHaveLength(0);
    } finally {
      await unmount(view);
    }
  });

  test("clicking cells adds references, keeps the anchor, and Enter commits once", async () => {
    resetState();
    state.selection = [0, 4, 0, 4];
    const view = await mount(initial);
    try {
      await pressEquals(view);
      expect(document.activeElement).toBe(view.bar());

      await clickCell(view, 1, 2);
      expect(view.bar().value).toBe("=B3");
      await clickCell(view, 2, 2);
      expect(view.bar().value).toBe("=B3+C3");
      expect(view.ref()).toBe("A5");
      expect(state.writes).toHaveLength(0);

      await act(async () => {
        view.bar().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      });
      expect(state.writes).toEqual([[0, 4, "=B3+C3"]]);
    } finally {
      await unmount(view);
    }
  });

  test("after Enter, a click selects another cell instead of extending the formula", async () => {
    resetState();
    state.selection = [0, 4, 0, 4];
    const view = await mount(initial);
    try {
      await pressEquals(view);
      await clickCell(view, 1, 2);
      await clickCell(view, 2, 2);
      await pressBarKey(view, "Enter");
      expect(state.writes).toEqual([[0, 4, "=B3+C3"]]);

      // This is the reported bug: the next click was still treated as a
      // reference and the user could never leave formula mode.
      await clickCell(view, 5, 6);
      expect(view.ref()).toBe("F7");
      expect(view.bar().value).toBe("");
      expect(state.writes).toEqual([[0, 4, "=B3+C3"]]);

      // A brand-new formula can be started on the newly selected cell.
      await pressEquals(view);
      expect(view.ref()).toBe("F7");
      expect(view.bar().value).toBe("=");
      expect(document.activeElement).toBe(view.bar());
    } finally {
      await unmount(view);
    }
  });

  test("Escape cancels the formula and leaves the grid ready to select", async () => {
    resetState();
    state.selection = [0, 4, 0, 4];
    const view = await mount(initial);
    try {
      await pressEquals(view);
      await clickCell(view, 1, 2);
      expect(view.bar().value).toBe("=B3");

      await pressBarKey(view, "Escape");
      expect(state.writes).toHaveLength(0);
      expect(view.bar().value).toBe("");

      await clickCell(view, 2, 2);
      expect(view.ref()).toBe("C3");
      expect(view.bar().value).toBe("3");
      expect(state.writes).toHaveLength(0);
    } finally {
      await unmount(view);
    }
  });
});

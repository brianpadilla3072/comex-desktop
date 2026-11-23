/** @jsxImportSource react */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://localhost/" });
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import React from "react";

const previousAct = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
afterAll(() => Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousAct));

type Args = unknown[][];
const calls = {
  insertRow: [] as Args,
  insertColumn: [] as Args,
  deleteRow: [] as Args,
  deleteColumn: [] as Args,
  undo: 0,
  redo: 0,
  copy: [] as Args,
  paste: [] as Args,
  selectAll: 0,
  search: [] as Args,
  resetSearch: 0,
  resetFilters: 0,
  orderBy: [] as Args,
  setStyle: [] as Args,
  resetStyle: [] as Args,
  updateSelectionFromCoords: [] as Args,
  openWorksheet: [] as Args,
  downloads: [] as Array<{ name: string; href: string }>,
  clipboard: [],
  clipboardText: "",
};

function resetCalls() {
  for (const key of Object.keys(calls)) {
    const value = Reflect.get(calls, key);
    if (Array.isArray(value)) value.length = 0;
    else Reflect.set(calls, key, typeof value === "number" ? 0 : "");
  }
}

type MockSheet = {
  parent: { worksheets: MockSheet[] };
  getData: () => string[][];
  getValueFromCoords: () => string;
  getSelection: () => [number, number, number, number];
  getStyle: () => string;
  insertRow: (...args: unknown[]) => void;
  insertColumn: (...args: unknown[]) => void;
  deleteRow: (...args: unknown[]) => void;
  deleteColumn: (...args: unknown[]) => void;
  undo: () => void;
  redo: () => void;
  copy: (...args: unknown[]) => void;
  paste: (...args: unknown[]) => void;
  selectAll: () => void;
  search: (...args: unknown[]) => void;
  resetSearch: () => void;
  resetFilters: () => void;
  orderBy: (...args: unknown[]) => void;
  setStyle: (...args: unknown[]) => void;
  resetStyle: (...args: unknown[]) => void;
  updateSelectionFromCoords: (...args: unknown[]) => void;
  openWorksheet: (...args: unknown[]) => void;
  createWorksheet: (options: unknown) => void;
};

const instance: MockSheet = {
  parent: { worksheets: [] },
  getData: () => [["Producto", "Precio"], ["A", "10"]],
  getValueFromCoords: () => "",
  getSelection: () => [1, 2, 2, 3],
  getStyle: () => "",
  insertRow: (...args) => { calls.insertRow.push(args); },
  insertColumn: (...args) => { calls.insertColumn.push(args); },
  deleteRow: (...args) => { calls.deleteRow.push(args); },
  deleteColumn: (...args) => { calls.deleteColumn.push(args); },
  undo: () => { calls.undo += 1; },
  redo: () => { calls.redo += 1; },
  copy: (...args) => { calls.copy.push(args); },
  paste: (...args) => { calls.paste.push(args); },
  selectAll: () => { calls.selectAll += 1; },
  search: (...args) => { calls.search.push(args); },
  resetSearch: () => { calls.resetSearch += 1; },
  resetFilters: () => { calls.resetFilters += 1; },
  orderBy: (...args) => { calls.orderBy.push(args); },
  setStyle: (...args) => { calls.setStyle.push(args); },
  resetStyle: (...args) => { calls.resetStyle.push(args); },
  updateSelectionFromCoords: (...args) => { calls.updateSelectionFromCoords.push(args); },
  openWorksheet: (...args) => { calls.openWorksheet.push(args); },
  createWorksheet: () => undefined,
};

mock.module("jspreadsheet-ce", () => ({
  default: Object.assign(
    (root: HTMLElement) => {
      const tabs = document.createElement("div");
      tabs.className = "jtabs-content";
      root.append(tabs);
      const headers = document.createElement("div");
      headers.className = "jtabs-headers-container";
      root.append(headers);
      instance.parent.worksheets = [instance];
      return [instance];
    },
    { destroy: () => undefined },
  ),
}));

// Base UI portals need browser layout APIs that happy-dom does not provide, so
// the tests exercise our item wiring through a tiny stand-in. Production uses
// the real primitives; floating-surface-guard.test.ts enforces that.
mock.module("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children, onOpenChange }: { children: React.ReactNode; onOpenChange?: (open: boolean) => void }) => (
    <div className="mock-menu" onClick={() => onOpenChange?.(true)}>{children}</div>
  ),
  DropdownMenuTrigger: ({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...rest}>{children}</button>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div role="menu" className="mock-menu-content">{children}</div>
  ),
  DropdownMenuGroup: ({ children }: { children: React.ReactNode }) => <div role="group">{children}</div>,
  // Match the real Base UI primitive: items activate on `onClick`, not Radix's `onSelect`.
  DropdownMenuItem: ({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" role="menuitem" {...rest}>{children}</button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuShortcut: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

const { JspreadsheetView } = await import("../src/react-app/domains/artifacts/views/jspreadsheet-view");

const content = JSON.stringify({ sheets: [{ id: "s1", name: "Ventas", cells: { A1: { value: "Producto" } } }] });
const MENUS = ["Archivo", "Editar", "Ver", "Insertar", "Formato", "Datos", "Herramientas"];

const originalClick = HTMLAnchorElement.prototype.click;
beforeEach(() => {
  resetCalls();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:test" });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => undefined });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      readText: async () => "desde el portapapeles",
      writeText: async (text: string) => { calls.clipboardText = text; },
    },
  });
  Object.defineProperty(HTMLAnchorElement.prototype, "click", {
    configurable: true,
    value: function (this: HTMLAnchorElement) {
      calls.downloads.push({ name: this.download, href: this.href });
    },
  });
});
afterAll(() => {
  Object.defineProperty(HTMLAnchorElement.prototype, "click", { configurable: true, value: originalClick });
});

async function renderView() {
  const host = document.createElement("div");
  host.className = "sheet-editor__grid";
  document.body.append(host);
  const root = createRoot(host);
  let emitted = "";
  await act(async () => {
    root.render(<JspreadsheetView
      content={content}
      title="Ventas"
      onChange={(value) => { emitted = value; }}
    />);
  });
  return {
    host,
    emitted: () => emitted,
    close: async () => {
      await act(async () => { root.unmount(); });
      host.remove();
    },
  };
}

async function clickItem(menu: string, label: string) {
  const item = document.querySelector<HTMLButtonElement>(`[data-testid="sheet-menu-${menu}-${label}"]`);
  if (!item) throw new Error(`missing item ${menu} / ${label}`);
  await act(async () => { item.click(); });
}

describe("JspreadsheetView menus", () => {
  test("the menu markup follows the Base UI primitive API", () => {
    // happy-dom cannot open a real Base UI menu, so these two composition rules
    // are checked here. Both broke when the menus were first wired: Radix's
    // `onSelect` is ignored by Base UI, and a GroupLabel outside a Group crashes
    // the whole artifact when the Herramientas menu opens.
    const source = readFileSync(
      join(import.meta.dir, "..", "src/react-app/domains/artifacts/views/jspreadsheet-view.tsx"),
      "utf8",
    );
    expect(source).not.toContain("onSelect=");
    expect(source).toContain("<DropdownMenuGroup><DropdownMenuLabel>");
  });

  test("the seven menus are real controls with actionable items", async () => {
    const view = await renderView();
    try {
      const bar = view.host.querySelector(".sheet-editor__menubar");
      expect(bar?.getAttribute("aria-hidden")).toBeNull();
      for (const menu of MENUS) {
        expect(view.host.querySelector(`button[aria-label="${menu}"]`)).not.toBeNull();
      }
      expect(view.host.querySelectorAll('[data-testid^="sheet-menu-"]').length).toBeGreaterThan(30);
    } finally {
      await view.close();
    }
  });

  test("Editar undoes, redoes and pastes from the clipboard at the selection", async () => {
    const view = await renderView();
    try {
      await clickItem("Editar", "Deshacer");
      await clickItem("Editar", "Rehacer");
      await act(async () => { await clickItem("Editar", "Pegar"); });
      expect(calls.undo).toBe(1);
      expect(calls.redo).toBe(1);
      expect(calls.paste).toEqual([[1, 2, "desde el portapapeles"]]);
      expect(view.emitted()).not.toBe("");
    } finally {
      await view.close();
    }
  });

  test("Insertar and Editar insert and delete around the selected cell and persist the size", async () => {
    const view = await renderView();
    try {
      await clickItem("Insertar", "Filas arriba");
      await clickItem("Insertar", "Columnas a la derecha");
      expect(calls.insertRow).toEqual([[1, 2, 1]]);
      expect(calls.insertColumn).toEqual([[1, 1, false]]);
      const saved = JSON.parse(view.emitted()) as {
        sheets: Array<{ rows: number; cols: number }>;
      };
      expect(saved.sheets[0].rows).toBe(61);
      expect(saved.sheets[0].cols).toBe(27);

      await clickItem("Editar", "Eliminar fila");
      await clickItem("Editar", "Eliminar columna");
      expect(calls.deleteRow).toEqual([[2, 1]]);
      expect(calls.deleteColumn).toEqual([[1, 1]]);
    } finally {
      await view.close();
    }
  });

  test("Formato styles the selected range and can clear it", async () => {
    const view = await renderView();
    try {
      await clickItem("Formato", "Negrita");
      const styles = calls.setStyle[0]?.[0] as Record<string, string[]>;
      expect(styles.B3).toEqual(["font-weight: bold"]);
      expect(styles.C4).toEqual(["font-weight: bold"]);
      await clickItem("Formato", "Limpiar formato");
      expect(Object.keys(calls.resetStyle[0]?.[0] as Record<string, boolean>)).toEqual(["B3", "C3", "B4", "C4"]);
    } finally {
      await view.close();
    }
  });

  test("Datos sorts, clears filters and clears the search", async () => {
    const view = await renderView();
    try {
      await clickItem("Datos", "Ordenar descendente");
      await clickItem("Datos", "Quitar filtros");
      await clickItem("Datos", "Borrar búsqueda");
      expect(calls.orderBy).toEqual([[1, 1]]);
      expect(calls.resetFilters).toBe(1);
      expect(calls.resetSearch).toBe(1);
    } finally {
      await view.close();
    }
  });

  test("Ver toggles chrome, zoom and the go-to-cell prompt", async () => {
    const view = await renderView();
    try {
      await clickItem("Ver", "Ocultar cuadrícula");
      expect(view.host.querySelector(".sheet-editor__grid")?.classList.contains("sheet-editor__grid--no-lines")).toBe(true);
      await clickItem("Ver", "Ocultar barra de fórmulas");
      expect(view.host.querySelector('[data-testid="sheet-formula-input"]')).toBeNull();
      await clickItem("Ver", "Agrandar");
      const gridRoot = view.host.querySelector(".sheet-editor .sheet-editor__grid > div") as HTMLElement;
      expect(gridRoot.style.getPropertyValue("--sheet-zoom")).toBe("1.1");

      await clickItem("Ver", "Ir a celda…");
      const input = document.querySelector<HTMLInputElement>('[data-testid="sheet-menu-prompt"]');
      expect(input).not.toBeNull();
      if (!input) throw new Error("missing prompt");
      const propsKey = Object.keys(input).find(key => key.startsWith("__reactProps$"));
      if (!propsKey) throw new Error("missing React props on prompt");
      const props = Reflect.get(input, propsKey) as {
        onChange?: (event: { target: { value: string } }) => void;
      };
      await act(async () => { props.onChange?.({ target: { value: "D10" } }); });
      const form = input?.closest("form");
      await act(async () => { form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
      expect(calls.updateSelectionFromCoords).toEqual([[3, 9]]);
    } finally {
      await view.close();
    }
  });

  test("Herramientas copies CSV and downloads both formats", async () => {
    const view = await renderView();
    try {
      await clickItem("Herramientas", "Copiar CSV al portapapeles");
      await act(async () => { await Promise.resolve(); });
      expect(calls.clipboardText).toBe('Producto,Precio\r\nA,10');
      await clickItem("Archivo", "Descargar CSV");
      await clickItem("Herramientas", "Descargar JSON");
      expect(calls.downloads.map(download => download.name)).toEqual(["Ventas.csv", "Ventas.json"]);
      expect(calls.downloads[1]?.href).toBe("blob:test");
    } finally {
      await view.close();
    }
  });

  test("the sheet-tab menu opens through the floating primitive and jumps to a sheet", async () => {
    const view = await renderView();
    try {
      const trigger = view.host.querySelector<HTMLButtonElement>('[data-testid="sheet-tabs-menu"]');
      expect(trigger).not.toBeNull();
      await act(async () => { trigger?.click(); });
      const item = document.querySelector<HTMLButtonElement>('[role="menu"] button[data-active="true"]');
      expect(item?.textContent).toBe("Ventas");
      await act(async () => { item?.click(); });
      expect(calls.openWorksheet).toEqual([[0]]);
    } finally {
      await view.close();
    }
  });
});

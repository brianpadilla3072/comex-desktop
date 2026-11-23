/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import jspreadsheet, { type WorksheetInstance } from "jspreadsheet-ce";

import "jspreadsheet-ce/dist/jspreadsheet.css";
import "jsuites/dist/jsuites.css";
import "./jspreadsheet-icons.css";

import { parseSheets, type Sheet } from "./sheet-view";
import { resolveExtensionIconSrc } from "../../../design-system/extension-icon-src";

interface JspreadsheetViewProps {
  content: string;
  title?: string;
  onTitleChange?: (title: string) => void;
  onChange?: (content: string) => void;
}

const DEFAULT_TITLE = "Hoja de cálculo";

/** Starting size. It is intentionally bigger than the data so the grid already
 *  feels open, and it grows on demand (see `expand`) instead of stopping here. */
const INITIAL_COLUMNS = 26;
const INITIAL_ROWS = 60;
const GROW_COLUMNS = 10;
const GROW_ROWS = 50;
const EDGE_THRESHOLD = 4;
const SCROLL_THRESHOLD = 80;

function columnLabel(index: number): string {
  let label = "";
  let n = index;
  while (n >= 0) {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  }
  return label;
}

function cellCoords(ref: string): { col: number; row: number } {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? "A";
  const row = Number.parseInt(ref.slice(letters.length), 10) || 1;
  let col = 0;
  for (const ch of letters) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: row - 1 };
}

/** Turn the artifact's sheets into the array-of-rows format Jspreadsheet CE expects. */
function sheetToData(sheet: Sheet): { rows: string[][]; colCount: number; rowCount: number } {
  let maxCol = 0;
  let maxRow = 0;
  for (const [ref] of Object.entries(sheet.cells ?? {})) {
    const { col, row } = cellCoords(ref.toUpperCase());
    maxCol = Math.max(maxCol, col);
    maxRow = Math.max(maxRow, row);
  }
  const colCount = Math.max(maxCol + 1, INITIAL_COLUMNS);
  const rowCount = Math.max(maxRow + 1, INITIAL_ROWS);
  const rows = Array.from({ length: rowCount }, () => Array.from({ length: colCount }, () => ""));
  for (const [ref, cell] of Object.entries(sheet.cells ?? {})) {
    const { col, row } = cellCoords(ref.toUpperCase());
    if (row < rowCount && col < colCount) {
      rows[row][col] = cell.formula ? cell.formula : cell.value;
    }
  }
  return { rows, colCount, rowCount };
}

/** Serialize the live worksheets back into the artifact's { sheets: [...] } JSON format. */
function serializeSheets(sheets: Sheet[], instances: WorksheetInstance[]): string {
  const next = sheets.map((sheet, index) => {
    const instance = instances[index];
    const cells: Record<string, { value: string; formula?: string }> = {};
    const data = instance?.getData(false, true) ?? [];
    data.forEach((row, rowIndex) => {
      row.forEach((raw, colIndex) => {
        const value = raw === null || raw === undefined ? "" : String(raw);
        if (!value) return;
        const ref = `${columnLabel(colIndex)}${rowIndex + 1}`;
        if (value.startsWith("=")) cells[ref] = { value: "", formula: value };
        else cells[ref] = { value };
      });
    });
    return { ...sheet, cells };
  });
  return JSON.stringify({ sheets: next });
}

/** Spreadsheet editor for sheet artifacts, styled after a familiar sheet UI.
 *  Powered by Jspreadsheet CE (MIT); the formula bar and the fixed sheet-tab
 *  strip are ours because CE hides the tabs when there is only one worksheet. */
export function JspreadsheetView({ content, title, onTitleChange, onChange }: JspreadsheetViewProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Saving echoes the exact JSON we emitted back as `content`. Rebuilding on that
  // echo would recreate the library at its initial 60 rows, dropping the rows we
  // grew on demand and resetting the selection, so keep the live instance.
  const lastEmittedRef = useRef<string | null>(null);
  const appliedContentRef = useRef(content);
  const effectiveContent = content === lastEmittedRef.current ? appliedContentRef.current : content;
  const sheets = useMemo(() => parseSheets(effectiveContent), [effectiveContent]);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const selectionRef = useRef<{ instance: WorksheetInstance; x: number; y: number } | null>(null);
  const instancesRef = useRef<WorksheetInstance[]>([]);
  const dimensionsRef = useRef<Array<{ rows: number; cols: number }>>([]);
  const sheetRefsRef = useRef<Sheet[]>(sheets);
  const activeInstanceRef = useRef<WorksheetInstance | null>(null);
  const addSheetRef = useRef<() => void>(() => undefined);
  const selectSheetRef = useRef<(index: number) => void>(() => undefined);

  const [activeCell, setActiveCell] = useState("A1");
  const [formula, setFormula] = useState("");
  const [formulaSlot, setFormulaSlot] = useState<HTMLElement | null>(null);
  const [tabsSlot, setTabsSlot] = useState<HTMLElement | null>(null);
  const [sheetMenu, setSheetMenu] = useState<{ items: Array<{ index: number; name: string }>; active: number } | null>(null);

  const resolvedTitle = title ?? DEFAULT_TITLE;
  const [displayName, setDisplayName] = useState(resolvedTitle);
  useEffect(() => setDisplayName(resolvedTitle), [resolvedTitle]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || sheets.length === 0) return;
    appliedContentRef.current = effectiveContent;
    sheetRefsRef.current = sheets;

    // jSuites fires selection events while rows/columns are being inserted.
    // Without this guard a selection near the edge re-enters `expand` forever.
    let growing = false;
    const expand = (instance: WorksheetInstance, addRows: number, addCols: number) => {
      if (!addRows && !addCols || growing) return;
      const index = instancesRef.current.indexOf(instance);
      const dimensions = dimensionsRef.current[index >= 0 ? index : 0];
      if (!dimensions) return;
      growing = true;
      try {
        dimensions.rows += addRows;
        dimensions.cols += addCols;
        if (addCols) instance.insertColumn(addCols);
        if (addRows) instance.insertRow(addRows);
      } finally {
        growing = false;
      }
    };

    const growToward = (instance: WorksheetInstance, x: number, y: number) => {
      const index = instancesRef.current.indexOf(instance);
      const dimensions = dimensionsRef.current[index >= 0 ? index : 0];
      if (!dimensions || growing) return;
      expand(
        instance,
        y >= dimensions.rows - EDGE_THRESHOLD ? GROW_ROWS : 0,
        x >= dimensions.cols - EDGE_THRESHOLD ? GROW_COLUMNS : 0,
      );
    };

    const syncFormula = (instance: WorksheetInstance, x: number, y: number) => {
      selectionRef.current = { instance, x, y };
      activeInstanceRef.current = instance;
      setActiveCell(`${columnLabel(x)}${y + 1}`);
      const value = instance.getValueFromCoords(x, y, false);
      setFormula(value === null || value === undefined ? "" : String(value));
    };

    const worksheets = sheets.map((sheet) => {
      const { rows, colCount, rowCount } = sheetToData(sheet);
      return {
        type: "spreadsheet" as const,
        minDimensions: [colCount, rowCount] as [number, number],
        data: rows,
        worksheetName: sheet.name,
      };
    });

    const instances = jspreadsheet(root, {
      worksheets,
      allowExport: false,
      onselection: (instance, left, top) => {
        syncFormula(instance, left, top);
        growToward(instance, left, top);
      },
      onchange: (instance) => {
        const selected = selectionRef.current;
        if (selected && selected.instance === instance) {
          growToward(instance, selected.x, selected.y);
        }
        const callback = onChangeRef.current;
        if (callback) {
          const serialized = serializeSheets(sheetRefsRef.current, instance.parent.worksheets);
          lastEmittedRef.current = serialized;
          callback(serialized);
        }
      },
    });
    instancesRef.current = instances;
    dimensionsRef.current = worksheets.map(worksheet => ({
      rows: worksheet.minDimensions[1],
      cols: worksheet.minDimensions[0],
    }));

    // Keep growing when the person scrolls to the end of the rendered grid, so
    // there is always another row below and another column to the right.
    const scroller = root.querySelector<HTMLElement>(".jss_content");
    const onScroll = () => {
      const instance = activeInstanceRef.current ?? instancesRef.current[0];
      if (!instance || !scroller || growing) return;
      const nearBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - SCROLL_THRESHOLD;
      const nearRight = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - SCROLL_THRESHOLD;
      expand(instance, nearBottom ? GROW_ROWS : 0, nearRight ? GROW_COLUMNS : 0);
    };
    scroller?.addEventListener("scroll", onScroll, { passive: true });

    addSheetRef.current = () => {
      const instance = activeInstanceRef.current ?? instancesRef.current[0];
      if (!instance || growing) return;
      const used = new Set(sheetRefsRef.current.map(sheet => sheet.name));
      let number = sheetRefsRef.current.length + 1;
      while (used.has(`Hoja ${number}`)) number += 1;
      const name = `Hoja ${number}`;
      const sheet: Sheet = { id: `sheet-${Date.now().toString(36)}-${number}`, name, cells: {} };
      sheetRefsRef.current = [...sheetRefsRef.current, sheet];
      instance.createWorksheet({
        minDimensions: [INITIAL_COLUMNS, INITIAL_ROWS],
        worksheetName: name,
      });
      const all = instance.parent.worksheets;
      instancesRef.current = all;
      dimensionsRef.current = [
        ...dimensionsRef.current,
        { rows: INITIAL_ROWS, cols: INITIAL_COLUMNS },
      ];
      const callback = onChangeRef.current;
      if (callback) callback(serializeSheets(sheetRefsRef.current, all));
      all[all.length - 1]?.updateSelectionFromCoords(0, 0);
    };

    // Used by the "all sheets" (≡) menu to jump to another worksheet.
    selectSheetRef.current = (index: number) => {
      const target = instancesRef.current[index];
      if (!target || growing) return;
      target.openWorksheet(index);
      activeInstanceRef.current = target;
      target.updateSelectionFromCoords(0, 0);
    };

    // Put our formula bar immediately below Jspreadsheet's toolbar, inside the
    // library-owned root, so the visual order is toolbar → formula → grid → tabs.
    const slot = document.createElement("div");
    slot.style.order = "2";
    const toolbar = root.querySelector<HTMLElement>(".jss_toolbar");
    if (toolbar?.nextSibling) toolbar.parentNode?.insertBefore(slot, toolbar.nextSibling);
    else root.append(slot);
    setFormulaSlot(slot);

    // The tab strip lives in the fixed footer (outside the scrolling content).
    // Our "+" and "≡" buttons go into a slot at the LEFT of the library tabs,
    // matching the reference layout; the scroll arrows stay at the right.
    const headersContainer = root.querySelector<HTMLElement>(".jtabs-headers-container");
    const headers = root.querySelector<HTMLElement>(".jtabs-headers");
    const tabSlot = document.createElement("span");
    tabSlot.className = "sheet-editor__tabs-slot";
    if (headersContainer && headers) headersContainer.insertBefore(tabSlot, headers);
    else headersContainer?.append(tabSlot);
    setTabsSlot(tabSlot);

    return () => {
      addSheetRef.current = () => undefined;
      selectSheetRef.current = () => undefined;
      scroller?.removeEventListener("scroll", onScroll);
      selectionRef.current = null;
      activeInstanceRef.current = null;
      instancesRef.current = [];
      dimensionsRef.current = [];
      slot.remove();
      tabSlot.remove();
      // Jspreadsheet mutates the root element with a `spreadsheet` property at
      // runtime; its typings do not model that on the element passed to jspreadsheet().
      jspreadsheet.destroy(root as unknown as Parameters<typeof jspreadsheet.destroy>[0]);
    };
  }, [sheets, effectiveContent]);

  // Close the "all sheets" menu on Escape or when clicking outside of it.
  useEffect(() => {
    if (!sheetMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && tabsSlot?.contains(target)) return;
      setSheetMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSheetMenu(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [sheetMenu, tabsSlot]);

  const openSheetMenu = () => {
    const all = instancesRef.current;
    const active = activeInstanceRef.current ? all.indexOf(activeInstanceRef.current) : 0;
    setSheetMenu({
      items: sheetRefsRef.current.map((sheet, index) => ({ index, name: sheet.name })),
      active: active >= 0 ? active : 0,
    });
  };

  const commitFormula = () => {
    const selected = selectionRef.current;
    if (!selected) return;
    selected.instance.setValueFromCoords(selected.x, selected.y, formula);
  };

  const commitName = () => {
    const next = displayName.trim();
    if (!next) {
      setDisplayName(resolvedTitle);
      return;
    }
    if (next !== resolvedTitle) onTitleChange?.(next);
  };

  if (sheets.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground" role="status">La hoja no tiene celdas.</div>;
  }

  return <div className="sheet-editor" data-testid="jspreadsheet-view">
    <div className="sheet-editor__titlebar">
      <img className="sheet-editor__icon" src={resolveExtensionIconSrc("/sheet-icon.png")} alt="" aria-hidden="true" />
      <input
        className="sheet-editor__name"
        data-testid="sheet-file-name"
        aria-label="Nombre del archivo"
        value={displayName}
        style={{ width: `${Math.max(12, displayName.length + 1)}ch` }}
        onChange={(event) => setDisplayName(event.target.value)}
        onBlur={commitName}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitName();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            setDisplayName(resolvedTitle);
            event.currentTarget.blur();
          }
        }}
      />
    </div>
    <div className="sheet-editor__menubar" aria-hidden="true">
      <span>Archivo</span><span>Editar</span><span>Ver</span><span>Insertar</span>
      <span>Formato</span><span>Datos</span><span>Herramientas</span>
    </div>
    <div className="sheet-editor__grid"><div ref={rootRef} /></div>
    {formulaSlot ? createPortal(
      <div className="sheet-editor__formula">
        <span className="sheet-editor__formula-ref">{activeCell}</span>
        <span className="sheet-editor__formula-fx" aria-hidden="true">fx</span>
        <input
          className="sheet-editor__formula-input"
          data-testid="sheet-formula-input"
          aria-label={`Valor de ${activeCell}`}
          value={formula}
          onChange={(event) => setFormula(event.target.value)}
          onBlur={commitFormula}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitFormula();
              event.currentTarget.blur();
            }
          }}
        />
      </div>,
      formulaSlot,
    ) : null}
    {tabsSlot ? createPortal(
      <>
        <button
          type="button"
          className="sheet-editor__add-sheet"
          data-testid="sheet-add-tab"
          aria-label="Nueva hoja"
          title="Nueva hoja"
          onClick={() => {
            setSheetMenu(null);
            addSheetRef.current();
          }}
        >+</button>
        <button
          type="button"
          className="sheet-editor__tabs-menu-btn"
          data-testid="sheet-tabs-menu"
          aria-label="Todas las hojas"
          aria-expanded={sheetMenu !== null}
          title="Todas las hojas"
          onClick={() => (sheetMenu ? setSheetMenu(null) : openSheetMenu())}
        >≡</button>
        {sheetMenu ? (
          <div className="sheet-editor__tabs-menu" role="menu" aria-label="Hojas">
            {sheetMenu.items.map((item) => (
              <button
                key={item.index}
                type="button"
                role="menuitem"
                className={item.index === sheetMenu.active ? "is-active" : undefined}
                onClick={() => {
                  setSheetMenu(null);
                  selectSheetRef.current(item.index);
                }}
              >{item.name}</button>
            ))}
          </div>
        ) : null}
      </>,
      tabsSlot,
    ) : null}
  </div>;
}

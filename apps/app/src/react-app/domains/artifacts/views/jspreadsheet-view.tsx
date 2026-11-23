/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { createPortal } from "react-dom";
import jspreadsheet, { type WorksheetInstance } from "jspreadsheet-ce";

import "jspreadsheet-ce/dist/jspreadsheet.css";
import "jsuites/dist/jsuites.css";
import "./jspreadsheet-icons.css";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { parseSheets, type Sheet } from "./sheet-view";
import { resolveExtensionIconSrc } from "../../../design-system/extension-icon-src";

interface JspreadsheetViewProps {
  content: string;
  title?: string;
  onTitleChange?: (title: string) => void;
  onChange?: (content: string) => void;
}

const DEFAULT_TITLE = "Hoja de cálculo";

/** Starting size. There is no fixed ceiling: the grid keeps this many blank
 *  rows below and columns to the right of the last row/column reached, whether
 *  by selection or by scrolling, like a familiar spreadsheet. */
const INITIAL_COLUMNS = 26;
const INITIAL_ROWS = 60;
const SPARE_ROWS = 20;
const SPARE_COLUMNS = 8;
const SCROLL_THRESHOLD = 120;
const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.5];
const DEFAULT_ZOOM_INDEX = 2;

type MenuEntry =
  | { label: string; action: () => void; shortcut?: string; separator?: false }
  | { separator: true };

type SheetActions = {
  save: () => void;
  newSheet: () => void;
  renameSheet: () => void;
  downloadCsv: () => void;
  undo: () => void;
  redo: () => void;
  cut: () => void;
  copy: () => void;
  paste: () => void | Promise<void>;
  deleteRow: () => void;
  deleteColumn: () => void;
  search: () => void;
  selectAll: () => void;
  goToCell: () => void;
  toggleGridLines: () => void;
  toggleFormulaBar: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  insertRowsBefore: () => void;
  insertRowsAfter: () => void;
  insertColumnsBefore: () => void;
  insertColumnsAfter: () => void;
  toggleBold: () => void;
  toggleItalic: () => void;
  toggleUnderline: () => void;
  alignLeft: () => void;
  alignCenter: () => void;
  alignRight: () => void;
  clearFormat: () => void;
  sortAscending: () => void;
  sortDescending: () => void;
  clearFilters: () => void;
  clearSearch: () => void;
  copyCsv: () => void | Promise<void>;
  downloadJson: () => void;
};

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

/** The selected range, expressed as the coordinates jspreadsheet expects plus
 *  the cell names its style API needs. Falls back to A1 before the first click. */
function selectionOn(instance: WorksheetInstance): { x: number; y: number; cells: string[] } {
  const range = instance.getSelection?.();
  if (range && range.length >= 2) {
    const [x1, y1, x2 = x1, y2 = y1] = range;
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);
    const cells: string[] = [];
    for (let row = top; row <= bottom; row += 1) {
      for (let col = left; col <= right; col += 1) cells.push(`${columnLabel(col)}${row + 1}`);
    }
    return { x: x1, y: y1, cells };
  }
  return { x: 0, y: 0, cells: ["A1"] };
}

/** Cell reference under the pointer while a formula is being built in the bar. */
function referenceAt(event: MouseEvent): string | null {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return null;
  const cell = target.closest<HTMLElement>("td[data-x][data-y]");
  if (!cell) return null;
  const x = Number(cell.getAttribute("data-x"));
  const y = Number(cell.getAttribute("data-y"));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return `${columnLabel(x)}${y + 1}`;
}

/** Extend a formula with a clicked reference. `=` + B3 + C3 becomes `=B3+C3`,
 *  while an operator or `(` already typed is left to separate the arguments. */
function appendReference(formula: string, reference: string): string {
  const current = formula.trimEnd();
  const last = current.slice(-1);
  const needsOperator = last.length > 0 && /[A-Za-z0-9_)"]/.test(last);
  return `${current}${needsOperator ? "+" : ""}${reference}`;
}

function csvFromData(data: unknown[][]): string {
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return data.map(row => row.map(escape).join(",")).join("\r\n");
}

function safeFileName(name: string): string {
  return name.replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-|-$/g, "") || "hoja";
}

function downloadText(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
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
  // The last reached size travels with the artifact. Otherwise changing session
  // (or any other remount) rebuilds Jspreadsheet from the cells alone and the
  // grid appears to shrink back to 60 rows / column Z.
  const colCount = Math.max(maxCol + 1, INITIAL_COLUMNS, sheet.cols ?? 0);
  const rowCount = Math.max(maxRow + 1, INITIAL_ROWS, sheet.rows ?? 0);
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
function serializeSheets(
  sheets: Sheet[],
  instances: WorksheetInstance[],
  dimensions: Array<{ rows: number; cols: number }>,
): string {
  const next = sheets.map((sheet, index) => {
    const instance = instances[index];
    const size = dimensions[index] ?? { rows: INITIAL_ROWS, cols: INITIAL_COLUMNS };
    const cells: Record<string, { value: string; formula?: string; format?: string }> = {};
    // Number formats set by the agent's sheet tools are part of the artifact;
    // Jspreadsheet does not render them, but dropping them on every UI save
    // would silently undo the agent's work.
    const formats = new Map(Object.entries(sheet.cells ?? {}).map(([ref, cell]) => [ref.toUpperCase(), cell.format]));
    // `processed: true` returns the rendered result ("20"). We need the raw cell
    // value ("=B3*C3") or a saved formula comes back as a dead number on reload.
    const data = instance?.getData(false, false) ?? [];
    data.forEach((row, rowIndex) => {
      row.forEach((raw, colIndex) => {
        const value = raw === null || raw === undefined ? "" : String(raw);
        if (!value) return;
        const ref = `${columnLabel(colIndex)}${rowIndex + 1}`;
        const format = formats.get(ref);
        if (value.startsWith("=")) cells[ref] = { value: "", formula: value, ...(format ? { format } : {}) };
        else cells[ref] = { value, ...(format ? { format } : {}) };
      });
    });
    return { ...sheet, cells, rows: size.rows, cols: size.cols };
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
  const emitRef = useRef<() => void>(() => undefined);
  const actionsRef = useRef<SheetActions | null>(null);
  const syncFormulaRef = useRef<(instance: WorksheetInstance, x: number, y: number) => void>(() => undefined);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const formulaInputRef = useRef<HTMLInputElement | null>(null);
  // Single source of truth for "grid clicks insert references". Focus alone was
  // not enough: after Enter the input could still be considered focused, so the
  // next click was swallowed instead of selecting another cell.
  const formulaModeRef = useRef(false);
  const formulaOriginalRef = useRef("");
  const finishFormulaRef = useRef<(commit: boolean) => void>(() => undefined);

  const [activeCell, setActiveCell] = useState("A1");
  const [formula, setFormula] = useState("");
  const [formulaSlot, setFormulaSlot] = useState<HTMLElement | null>(null);
  const [tabsSlot, setTabsSlot] = useState<HTMLElement | null>(null);
  const [sheetTabs, setSheetTabs] = useState<Array<{ index: number; name: string; active: boolean }>>([]);
  const [showGridLines, setShowGridLines] = useState(true);
  const [showFormulaBar, setShowFormulaBar] = useState(true);
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [promptKind, setPromptKind] = useState<"search" | "goto" | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const [notice, setNotice] = useState("");
  const noticeTimerRef = useRef<number | null>(null);

  const resolvedTitle = title ?? DEFAULT_TITLE;
  const [displayName, setDisplayName] = useState(resolvedTitle);
  const displayNameRef = useRef(displayName);
  displayNameRef.current = displayName;
  useEffect(() => setDisplayName(resolvedTitle), [resolvedTitle]);

  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
  }, []);

  const currentInstance = () => activeInstanceRef.current ?? instancesRef.current[0];

  const showNotice = (message: string) => {
    setNotice(message);
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice("");
      noticeTimerRef.current = null;
    }, 2500);
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root || sheets.length === 0) return;
    appliedContentRef.current = effectiveContent;
    sheetRefsRef.current = sheets;

    const emit = (instances: WorksheetInstance[] = instancesRef.current) => {
      const callback = onChangeRef.current;
      if (!callback) return;
      const serialized = serializeSheets(sheetRefsRef.current, instances, dimensionsRef.current);
      lastEmittedRef.current = serialized;
      callback(serialized);
    };
    emitRef.current = emit;

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
      // Persist the new size immediately. A remount (change of session, reload)
      // reads the artifact JSON, not the live Jspreadsheet instance, so without
      // this the grown rows/columns are lost.
      emit();
    };

    const growToward = (instance: WorksheetInstance, x: number, y: number) => {
      const index = instancesRef.current.indexOf(instance);
      const dimensions = dimensionsRef.current[index >= 0 ? index : 0];
      if (!dimensions || growing) return;
      // Add only what is missing to keep the buffer, so growth is continuous
      // instead of jumping in big batches that look like a fixed end (110/Z).
      expand(
        instance,
        Math.max(0, y + SPARE_ROWS + 1 - dimensions.rows),
        Math.max(0, x + SPARE_COLUMNS + 1 - dimensions.cols),
      );
    };

    const syncFormula = (instance: WorksheetInstance, x: number, y: number) => {
      selectionRef.current = { instance, x, y };
      activeInstanceRef.current = instance;
      setActiveCell(`${columnLabel(x)}${y + 1}`);
      const value = instance.getValueFromCoords(x, y, false);
      setFormula(value === null || value === undefined ? "" : String(value));
    };
    syncFormulaRef.current = syncFormula;

    const adjustDimensions = (instance: WorksheetInstance, rows: number, cols: number) => {
      const index = instancesRef.current.indexOf(instance);
      const dimensions = dimensionsRef.current[index >= 0 ? index : 0];
      if (!dimensions) return;
      dimensions.rows = Math.max(1, dimensions.rows + rows);
      dimensions.cols = Math.max(1, dimensions.cols + cols);
    };

    const withSelection = (
      action: (instance: WorksheetInstance, x: number, y: number, cells: string[]) => void,
    ) => {
      const instance = currentInstance();
      if (!instance) return;
      const { x, y, cells } = selectionOn(instance);
      action(instance, x, y, cells);
      emit();
    };

    const setCellStyle = (
      properties: Array<[string, string]>,
      toggle?: { key: string; on: string; off: string },
    ) => {
      withSelection((instance, _x, _y, cells) => {
        let toggleValue = "";
        if (toggle) {
          const current = instance.getStyle(cells[0], toggle.key);
          toggleValue = String(current).trim() === toggle.on ? toggle.off : toggle.on;
        }
        const styles: Record<string, string[]> = {};
        for (const cell of cells) {
          styles[cell] = properties.map(([key, value]) => `${key}: ${toggle && key === toggle.key ? toggleValue : value}`);
        }
        instance.setStyle(styles);
      });
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
        emit(instance.parent.worksheets);
      },
    });
    instancesRef.current = instances;
    dimensionsRef.current = worksheets.map(worksheet => ({
      rows: worksheet.minDimensions[1],
      cols: worksheet.minDimensions[0],
    }));

    // In our layout the library's `.jss_content` never scrolls: vertical scrolling
    // belongs to our grid wrapper and horizontal scrolling to `.jtabs-content`.
    // Listening on the wrong element is what made the sheet look like it ended
    // after the first jump (110 rows / column Z).
    const gridScroller = root.closest<HTMLElement>(".sheet-editor__grid");
    const horizontalScroller = root.querySelector<HTMLElement>(".jtabs-content");
    let lastScrollGrow = 0;
    const onScroll = () => {
      const now = Date.now();
      if (now - lastScrollGrow < 80 || growing) return;
      const instance = activeInstanceRef.current ?? instancesRef.current[0];
      if (!instance) return;
      const nearBottom = gridScroller && gridScroller.scrollHeight > gridScroller.clientHeight
        ? gridScroller.scrollTop + gridScroller.clientHeight >= gridScroller.scrollHeight - SCROLL_THRESHOLD
        : false;
      const nearRight = horizontalScroller && horizontalScroller.scrollWidth > horizontalScroller.clientWidth
        ? horizontalScroller.scrollLeft + horizontalScroller.clientWidth >= horizontalScroller.scrollWidth - SCROLL_THRESHOLD
        : false;
      if (!nearBottom && !nearRight) return;
      lastScrollGrow = now;
      const dimensions = dimensionsRef.current[instancesRef.current.indexOf(instance)];
      growToward(
        instance,
        nearRight ? (dimensions?.cols ?? 1) - 1 : (selectionRef.current?.x ?? 0),
        nearBottom ? (dimensions?.rows ?? 1) - 1 : (selectionRef.current?.y ?? 0),
      );
    };
    gridScroller?.addEventListener("scroll", onScroll, { passive: true });
    horizontalScroller?.addEventListener("scroll", onScroll, { passive: true });

    // Typing `=` over a selected cell hands the formula to our bar. That keeps a
    // single editing path: Jspreadsheet's own editor loses its input when the
    // artifact is saved and rebuilt, and it cannot extend a formula by clicking.
    const onGridKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "=" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, [contenteditable=true]")) return;
      const instance = currentInstance();
      if (!instance) return;
      const { x, y } = selectionOn(instance);
      selectionRef.current = { instance, x, y };
      setActiveCell(`${columnLabel(x)}${y + 1}`);
      setShowFormulaBar(true);
      const original = instance.getValueFromCoords(x, y, false);
      formulaOriginalRef.current = original === null || original === undefined ? "" : String(original);
      formulaModeRef.current = true;
      setFormula("=");
      event.preventDefault();
      event.stopPropagation();
      window.setTimeout(() => formulaInputRef.current?.focus(), 0);
    };

    // While the bar holds a formula under construction, a click on the grid must
    // add that cell's reference instead of moving the anchor to another cell.
    const onGridMouseDown = (event: MouseEvent) => {
      if (!formulaModeRef.current) return;
      const reference = referenceAt(event);
      if (!reference) return;
      event.preventDefault();
      event.stopPropagation();
      setFormula(current => appendReference(current, reference));
      formulaInputRef.current?.focus();
    };

    // The artifact panel handles Escape in its own capture phase, above this
    // component. Intercept first: Escape should cancel the formula, not close
    // the sheet (which would also discard the cell being edited).
    const onFormulaEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !formulaModeRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      finishFormulaRef.current(false);
    };
    window.addEventListener("keydown", onFormulaEscape, true);

    root.addEventListener("keydown", onGridKeyDown, true);
    root.addEventListener("mousedown", onGridMouseDown, true);

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
      emit(all);
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

    actionsRef.current = {
      save: () => emit(),
      newSheet: () => addSheetRef.current(),
      renameSheet: () => {
        // Base UI returns focus to the trigger when the menu closes. Deferring
        // one tick lets the name field win that race.
        window.setTimeout(() => {
          nameInputRef.current?.focus();
          nameInputRef.current?.select();
        }, 0);
      },
      downloadCsv: () => {
        const instance = currentInstance();
        if (!instance) return;
        downloadText(
          `${safeFileName(displayNameRef.current)}.csv`,
          csvFromData(instance.getData(false, true)),
          "text/csv;charset=utf-8",
        );
      },
      undo: () => {
        currentInstance()?.undo();
        emit();
      },
      redo: () => {
        currentInstance()?.redo();
        emit();
      },
      cut: () => withSelection(instance => { instance.copy(true); }),
      copy: () => withSelection(instance => { instance.copy(false); }),
      paste: async () => {
        if (!navigator.clipboard?.readText) {
          showNotice("Portapapeles no disponible");
          return;
        }
        try {
          const text = await navigator.clipboard.readText();
          if (!text) return;
          withSelection((instance, x, y) => { instance.paste(x, y, text); });
        } catch {
          showNotice("No se pudo pegar");
        }
      },
      deleteRow: () => withSelection((instance, _x, y) => {
        instance.deleteRow(y, 1);
        adjustDimensions(instance, -1, 0);
      }),
      deleteColumn: () => withSelection((instance, x) => {
        instance.deleteColumn(x, 1);
        adjustDimensions(instance, 0, -1);
      }),
      search: () => {
        setPromptValue("");
        setPromptKind("search");
      },
      selectAll: () => withSelection(instance => { instance.selectAll(); }),
      goToCell: () => {
        setPromptValue("");
        setPromptKind("goto");
      },
      toggleGridLines: () => setShowGridLines(value => !value),
      toggleFormulaBar: () => setShowFormulaBar(value => !value),
      zoomIn: () => setZoomIndex(index => Math.min(ZOOM_STEPS.length - 1, index + 1)),
      zoomOut: () => setZoomIndex(index => Math.max(0, index - 1)),
      zoomReset: () => setZoomIndex(DEFAULT_ZOOM_INDEX),
      insertRowsBefore: () => withSelection((instance, _x, y) => {
        instance.insertRow(1, y, 1);
        adjustDimensions(instance, 1, 0);
      }),
      insertRowsAfter: () => withSelection((instance, _x, y) => {
        instance.insertRow(1, y, 0);
        adjustDimensions(instance, 1, 0);
      }),
      insertColumnsBefore: () => withSelection((instance, x) => {
        instance.insertColumn(1, x, true);
        adjustDimensions(instance, 0, 1);
      }),
      insertColumnsAfter: () => withSelection((instance, x) => {
        instance.insertColumn(1, x, false);
        adjustDimensions(instance, 0, 1);
      }),
      toggleBold: () => setCellStyle([["font-weight", "bold"]], { key: "font-weight", on: "bold", off: "normal" }),
      toggleItalic: () => setCellStyle([["font-style", "italic"]], { key: "font-style", on: "italic", off: "normal" }),
      toggleUnderline: () => setCellStyle(
        [["text-decoration", "underline"]],
        { key: "text-decoration", on: "underline", off: "none" },
      ),
      alignLeft: () => setCellStyle([["text-align", "left"]]),
      alignCenter: () => setCellStyle([["text-align", "center"]]),
      alignRight: () => setCellStyle([["text-align", "right"]]),
      clearFormat: () => withSelection((instance, _x, _y, cells) => {
        const styles: Record<string, boolean> = {};
        for (const cell of cells) styles[cell] = true;
        instance.resetStyle(styles);
      }),
      sortAscending: () => withSelection(instance => { instance.orderBy(selectionOn(instance).x, 0); }),
      sortDescending: () => withSelection(instance => { instance.orderBy(selectionOn(instance).x, 1); }),
      clearFilters: () => withSelection(instance => { instance.resetFilters(); }),
      clearSearch: () => withSelection(instance => { instance.resetSearch(); }),
      copyCsv: async () => {
        const instance = currentInstance();
        if (!instance) return;
        const csv = csvFromData(instance.getData(false, true));
        if (!navigator.clipboard?.writeText) {
          showNotice("Portapapeles no disponible");
          return;
        }
        try {
          await navigator.clipboard.writeText(csv);
          showNotice("CSV copiado al portapapeles");
        } catch {
          showNotice("No se pudo copiar");
        }
      },
      downloadJson: () => downloadText(
        `${safeFileName(displayNameRef.current)}.json`,
        serializeSheets(sheetRefsRef.current, instancesRef.current, dimensionsRef.current),
        "application/json",
      ),
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
      actionsRef.current = null;
      emitRef.current = () => undefined;
      syncFormulaRef.current = () => undefined;
      addSheetRef.current = () => undefined;
      selectSheetRef.current = () => undefined;
      gridScroller?.removeEventListener("scroll", onScroll);
      horizontalScroller?.removeEventListener("scroll", onScroll);
      selectionRef.current = null;
      activeInstanceRef.current = null;
      instancesRef.current = [];
      dimensionsRef.current = [];
      slot.remove();
      tabSlot.remove();
      // Jspreadsheet mutates the root element with a `spreadsheet` property at
      // runtime; its typings do not model that on the element passed to jspreadsheet().
      window.removeEventListener("keydown", onFormulaEscape, true);
      root.removeEventListener("keydown", onGridKeyDown, true);
      root.removeEventListener("mousedown", onGridMouseDown, true);
      jspreadsheet.destroy(root as unknown as Parameters<typeof jspreadsheet.destroy>[0]);
      // CE destroys the instance but leaves its generated markup behind. If the
      // same host is reused (HMR, change of session), a second grid is appended
      // under the first one and the sheet looks like it starts again after the
      // last row. Remove the stale DOM so every mount starts from a clean root.
      root.replaceChildren();
    };
  }, [sheets, effectiveContent]);

  if (sheets.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground" role="status">La hoja no tiene celdas.</div>;
  }

  const zoomStyle: CSSProperties & { "--sheet-zoom"?: string } = {
    "--sheet-zoom": String(ZOOM_STEPS[zoomIndex]),
  };
  const act = (name: keyof SheetActions) => () => { void actionsRef.current?.[name](); };
  const menus: Array<{ label: string; items: MenuEntry[]; note?: string }> = [
    {
      label: "Archivo",
      items: [
        { label: "Nueva hoja", action: act("newSheet") },
        { label: "Renombrar hoja", action: act("renameSheet") },
        { separator: true },
        { label: "Guardar ahora", action: act("save"), shortcut: "⌘S" },
        { label: "Descargar CSV", action: act("downloadCsv") },
      ],
    },
    {
      label: "Editar",
      items: [
        { label: "Deshacer", action: act("undo"), shortcut: "⌘Z" },
        { label: "Rehacer", action: act("redo"), shortcut: "⇧⌘Z" },
        { separator: true },
        { label: "Cortar", action: act("cut"), shortcut: "⌘X" },
        { label: "Copiar", action: act("copy"), shortcut: "⌘C" },
        { label: "Pegar", action: act("paste"), shortcut: "⌘V" },
        { label: "Buscar…", action: act("search"), shortcut: "⌘F" },
        { separator: true },
        { label: "Eliminar fila", action: act("deleteRow") },
        { label: "Eliminar columna", action: act("deleteColumn") },
      ],
    },
    {
      label: "Ver",
      items: [
        { label: "Ir a celda…", action: act("goToCell"), shortcut: "⌘G" },
        { separator: true },
        { label: showGridLines ? "Ocultar cuadrícula" : "Mostrar cuadrícula", action: act("toggleGridLines") },
        { label: showFormulaBar ? "Ocultar barra de fórmulas" : "Mostrar barra de fórmulas", action: act("toggleFormulaBar") },
        { separator: true },
        { label: "Agrandar", action: act("zoomIn") },
        { label: "Reducir", action: act("zoomOut") },
        { label: "Tamaño real", action: act("zoomReset") },
      ],
    },
    {
      label: "Insertar",
      items: [
        { label: "Filas arriba", action: act("insertRowsBefore") },
        { label: "Filas abajo", action: act("insertRowsAfter") },
        { separator: true },
        { label: "Columnas a la izquierda", action: act("insertColumnsBefore") },
        { label: "Columnas a la derecha", action: act("insertColumnsAfter") },
      ],
    },
    {
      label: "Formato",
      items: [
        { label: "Negrita", action: act("toggleBold"), shortcut: "⌘B" },
        { label: "Cursiva", action: act("toggleItalic"), shortcut: "⌘I" },
        { label: "Subrayado", action: act("toggleUnderline"), shortcut: "⌘U" },
        { separator: true },
        { label: "Alinear a la izquierda", action: act("alignLeft") },
        { label: "Centrar", action: act("alignCenter") },
        { label: "Alinear a la derecha", action: act("alignRight") },
        { separator: true },
        { label: "Limpiar formato", action: act("clearFormat") },
      ],
    },
    {
      label: "Datos",
      items: [
        { label: "Ordenar ascendente", action: act("sortAscending") },
        { label: "Ordenar descendente", action: act("sortDescending") },
        { separator: true },
        { label: "Quitar filtros", action: act("clearFilters") },
        { label: "Borrar búsqueda", action: act("clearSearch") },
      ],
    },
    {
      label: "Herramientas",
      note: "Atajos: ⌘Z deshacer · ⌘C copiar · ⌘V pegar · ⌘F buscar",
      items: [
        { label: "Copiar CSV al portapapeles", action: act("copyCsv") },
        { label: "Descargar JSON", action: act("downloadJson") },
      ],
    },
  ];

  const openSheetTabs = (open: boolean) => {
    if (!open) return;
    const all = instancesRef.current;
    const active = activeInstanceRef.current ? all.indexOf(activeInstanceRef.current) : 0;
    setSheetTabs(sheetRefsRef.current.map((sheet, index) => ({
      index,
      name: sheet.name,
      active: index === (active >= 0 ? active : 0),
    })));
  };

  const submitPrompt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const instance = currentInstance();
    if (instance && promptKind) {
      if (promptKind === "search") {
        instance.search(promptValue);
      } else {
        const { col, row } = cellCoords(promptValue.trim().toUpperCase());
        instance.updateSelectionFromCoords(col, row);
        syncFormulaRef.current(instance, col, row);
      }
    }
    setPromptKind(null);
    setPromptValue("");
  };

  /** Leave formula-building mode exactly once, either writing the bar or
   *  restoring the original cell value. Clearing the mode FIRST is what lets the
   *  next click select another cell instead of appending another reference. */
  const finishFormula = (commit: boolean) => {
    if (!formulaModeRef.current) return;
    formulaModeRef.current = false;
    const selected = selectionRef.current;
    if (commit && selected) {
      selected.instance.setValueFromCoords(selected.x, selected.y, formula);
      // Clicks were intercepted while building, so jspreadsheet never moved its
      // selection. Reassert the anchor to close any pending editor state; the
      // following click then behaves like an ordinary selection.
      selected.instance.updateSelectionFromCoords?.(selected.x, selected.y);
    } else if (!commit) {
      setFormula(formulaOriginalRef.current);
    }
    const input = formulaInputRef.current;
    if (input && document.activeElement === input) input.blur();
  };
  finishFormulaRef.current = finishFormula;

  const commitName = () => {
    const next = displayName.trim();
    if (!next) {
      setDisplayName(resolvedTitle);
      return;
    }
    if (next !== resolvedTitle) onTitleChange?.(next);
  };

  return <div className="sheet-editor" data-testid="jspreadsheet-view">
    <div className="sheet-editor__titlebar">
      <img className="sheet-editor__icon" src={resolveExtensionIconSrc("/sheet-icon.png")} alt="" aria-hidden="true" />
      <input
        ref={nameInputRef}
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
    <div className="sheet-editor__menubar" role="menubar" aria-label="Menús de la hoja">
      {menus.map(menu => (
        <DropdownMenu key={menu.label}>
          <DropdownMenuTrigger className="sheet-editor__menu-trigger" aria-label={menu.label}>
            {menu.label}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom">
            {menu.note ? <DropdownMenuGroup><DropdownMenuLabel>{menu.note}</DropdownMenuLabel></DropdownMenuGroup> : null}
            {menu.items.map((item, index) => item.separator
              ? <DropdownMenuSeparator key={`separator-${index}`} />
              : <DropdownMenuItem
                  key={item.label}
                  role="menuitem"
                  data-testid={`sheet-menu-${menu.label}-${item.label}`}
                  onClick={item.action}
                >
                  <span>{item.label}</span>
                  {item.shortcut ? <DropdownMenuShortcut>{item.shortcut}</DropdownMenuShortcut> : null}
                </DropdownMenuItem>,
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ))}
      {promptKind ? (
        <form className="sheet-editor__prompt" onSubmit={submitPrompt}>
          <input
            autoFocus
            data-testid="sheet-menu-prompt"
            aria-label={promptKind === "search" ? "Texto a buscar" : "Celda destino"}
            placeholder={promptKind === "search" ? "Buscar en la hoja…" : "Celda (A1)"}
            value={promptValue}
            onChange={(event) => setPromptValue(event.target.value)}
          />
          <button type="submit">Aplicar</button>
          <button
            type="button"
            aria-label="Cancelar"
            onClick={() => { setPromptKind(null); setPromptValue(""); }}
          >×</button>
        </form>
      ) : null}
      {notice ? <span className="sheet-editor__notice" role="status">{notice}</span> : null}
    </div>
    <div className={`sheet-editor__grid${showGridLines ? "" : " sheet-editor__grid--no-lines"}`}>
      <div ref={rootRef} style={zoomStyle} />
    </div>
    {formulaSlot && showFormulaBar ? createPortal(
      <div className="sheet-editor__formula">
        <span className="sheet-editor__formula-ref">{activeCell}</span>
        <span className="sheet-editor__formula-fx" aria-hidden="true">fx</span>
        <input
          ref={formulaInputRef}
          className="sheet-editor__formula-input"
          data-testid="sheet-formula-input"
          aria-label={`Valor de ${activeCell}`}
          value={formula}
          onChange={(event) => setFormula(event.target.value)}
          onBlur={() => finishFormula(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              finishFormula(true);
            }
            // Escape is handled by `onFormulaEscape` in window capture, before
            // the artifact panel's own Escape handler can close the sheet.
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
          onClick={() => addSheetRef.current()}
        >+</button>
        <DropdownMenu onOpenChange={openSheetTabs}>
          <DropdownMenuTrigger
            className="sheet-editor__tabs-menu-btn"
            data-testid="sheet-tabs-menu"
            aria-label="Todas las hojas"
            title="Todas las hojas"
          >≡</DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top">
            {sheetTabs.map(item => (
              <DropdownMenuItem
                key={item.index}
                role="menuitem"
                data-active={item.active ? "true" : undefined}
                onClick={() => selectSheetRef.current(item.index)}
              >{item.name}</DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </>,
      tabsSlot,
    ) : null}
  </div>;
}

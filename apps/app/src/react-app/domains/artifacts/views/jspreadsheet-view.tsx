/** @jsxImportSource react */
import { useEffect, useMemo, useRef } from "react";
import jspreadsheet, { type WorksheetInstance } from "jspreadsheet-ce";

import "jspreadsheet-ce/dist/jspreadsheet.css";
import "jsuites/dist/jsuites.css";

import { parseSheets, type Sheet } from "./sheet-view";

interface JspreadsheetViewProps {
  content: string;
  onChange?: (content: string) => void;
}

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
  const colCount = Math.max(1, Math.min(maxCol + 1, 200));
  const rowCount = Math.max(1, Math.min(maxRow + 1, 2000));
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

/** Excel-like spreadsheet editor for sheet artifacts, powered by Jspreadsheet CE (MIT). */
export function JspreadsheetView({ content, onChange }: JspreadsheetViewProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sheets = useMemo(() => parseSheets(content), [content]);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const root = rootRef.current;
    if (!root || sheets.length === 0) return;

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
      onchange: () => {
        const callback = onChangeRef.current;
        if (callback) callback(serializeSheets(sheets, instances));
      },
    });

    return () => {
      // Jspreadsheet mutates the root element with a `spreadsheet` property at
      // runtime; its typings do not model that on the element passed to jspreadsheet().
      jspreadsheet.destroy(root as unknown as Parameters<typeof jspreadsheet.destroy>[0]);
    };
  }, [sheets]);

  if (sheets.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground" role="status">La hoja no tiene celdas.</div>;
  }

  return <div className="h-full min-h-0 overflow-auto p-2" data-testid="jspreadsheet-view"><div ref={rootRef} /></div>;
}

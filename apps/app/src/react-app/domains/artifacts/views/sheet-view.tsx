/** @jsxImportSource react */
import { useMemo, useState } from "react";

interface SheetViewProps { content: string }

export interface Cell { value: string; formula?: string; format?: string }
export interface Sheet { id: string; name: string; cells: Record<string, Cell> }

/** Parse "A1 producto" / "B1 =SUM(A2:A4)" lines into an Excel-like cell map. */
export function parseCellLines(content: string): Sheet | null {
  const cells: Record<string, Cell> = {};
  const linePattern = /^\s*([A-Za-z]{1,3}\d{1,7})\s+([\s\S]*)$/;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const match = linePattern.exec(line);
    if (!match) return null;
    const ref = match[1].toUpperCase();
    let value = match[2].trim();
    const formula = value.startsWith("=") ? value : undefined;
    if (formula) value = "";
    cells[ref] = { value, ...(formula ? { formula } : {}) };
  }
  if (Object.keys(cells).length === 0) return null;
  return { id: "sheet1", name: "Sheet1", cells };
}

export function parseSheets(content: string): Sheet[] {
  try {
    const parsed = JSON.parse(content) as { sheets?: Sheet[] };
    if (Array.isArray(parsed?.sheets) && parsed.sheets.length > 0) {
      return parsed.sheets.map(sheet => sheet.name === "Datos" ? { ...sheet, name: "Hoja1" } : sheet);
    }
  } catch {
    // Fall through to the plain "A1 value" cell-line format.
  }
  const fallback = parseCellLines(content);
  return fallback ? [fallback] : [];
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

/** Renderer for the sheet artifact: real tabs + an Excel-like grid with fx bar. */
export function SheetView({ content }: SheetViewProps) {
  const sheets = useMemo(() => parseSheets(content), [content]);
  const [activeIndex, setActiveIndex] = useState(0);

  if (sheets.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground" role="status">La hoja no tiene celdas.</div>;
  }

  const safeIndex = Math.min(activeIndex, sheets.length - 1);
  const activeSheet = sheets[safeIndex];
  const entries = Object.entries(activeSheet.cells ?? {});

  let maxCol = 0;
  let maxRow = 0;
  for (const [ref] of entries) {
    const { col, row } = cellCoords(ref);
    maxCol = Math.max(maxCol, col);
    maxRow = Math.max(maxRow, row);
  }
  const colCount = Math.min(maxCol + 1, 200);
  const rowCount = Math.min(maxRow + 1, 2000);
  const cellMap = new Map(entries.map(([ref, cell]) => [ref.toUpperCase(), cell]));

  return (
    <div className="grid gap-3 p-4" data-testid="sheet-view">
      <div role="tablist" className="flex gap-1 border-b pb-1" data-testid="sheet-tabs">
        {sheets.map((sheet, index) => (
          <button
            key={sheet.id}
            role="tab"
            aria-selected={index === safeIndex}
            data-testid={`tab-${sheet.id}`}
            className={`rounded-t-md px-3 py-1 text-xs ${index === safeIndex ? "bg-muted font-semibold" : "text-muted-foreground hover:bg-muted/50"}`}
            onClick={() => setActiveIndex(index)}
          >
            {sheet.name}
          </button>
        ))}
      </div>
      <section className="overflow-auto rounded-lg border" data-testid={`sheet-${activeSheet.id}`}>
        <table className="border-collapse text-xs" data-testid={`grid-${activeSheet.id}`}>
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 w-10 border-b border-r bg-muted px-2 py-1 text-center font-mono font-normal text-muted-foreground" />
              {Array.from({ length: colCount }, (_, c) => (
                <th key={c} className="sticky top-0 z-10 min-w-24 border-b border-r bg-muted px-2 py-1 text-center font-mono font-normal text-muted-foreground">
                  {columnLabel(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowCount }, (_, r) => (
              <tr key={r}>
                <th className="sticky left-0 z-10 w-10 border-b border-r bg-muted px-2 py-1 text-center font-mono font-normal text-muted-foreground">
                  {r + 1}
                </th>
                {Array.from({ length: colCount }, (_, c) => {
                  const ref = `${columnLabel(c)}${r + 1}`;
                  const cell = cellMap.get(ref);
                  return (
                    <td key={ref} className="min-w-24 border-b border-r px-2 py-1 align-top text-foreground" data-cell={ref}>
                      {cell?.formula ? <span className="font-mono text-sky-600">fx: {cell.formula}</span> : (cell?.value ?? "")}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

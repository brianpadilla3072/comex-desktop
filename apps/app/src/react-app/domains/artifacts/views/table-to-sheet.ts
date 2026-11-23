/** Convierte filas JSON (salida `table` del mini-Studio) al formato que espera SheetView.
 *  Vive en el front para que los artefactos `data` creados antes del fix del servidor
 *  también se puedan abrir, sin depender de un reinicio del proceso. */

export interface SheetCell { value: string }
export interface SheetTab { id: string; name: string; cells: Record<string, SheetCell> }

function columnLabel(index: number): string {
  let label = "";
  let n = index;
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

/** Devuelve contenido de hoja si `content` es un array de filas; null en caso contrario. */
export function tableRowsToSheetContent(content: string): string | null {
  let rows: unknown;
  try { rows = JSON.parse(content); } catch { return null; }
  if (!Array.isArray(rows)) return null;
  const objects = rows.filter(row => typeof row === "object" && row !== null) as Array<Record<string, unknown>>;
  const keys = objects.length ? Object.keys(objects[0]) : [];
  const cells: Record<string, SheetCell> = {};
  keys.forEach((key, column) => { cells[`${columnLabel(column)}1`] = { value: key }; });
  objects.forEach((row, rowIndex) => {
    keys.forEach((key, column) => {
      const value = row[key];
      cells[`${columnLabel(column)}${rowIndex + 2}`] = { value: value === null || value === undefined ? "" : String(value) };
    });
  });
  return JSON.stringify({ sheets: [{ id: "sheet-1", name: "Hoja1", cells }] });
}

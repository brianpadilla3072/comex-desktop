/** @jsxImportSource react */
import { useMemo } from "react";

interface SheetViewProps { content: string }

interface Cell { value: string; formula?: string; format?: string }
interface Sheet { id: string; name: string; cells: Record<string, Cell> }

/** Minimal renderer for the sheet artifact: tabs + grid of cells with fx bar on selection. */
export function SheetView({ content }: SheetViewProps) {
  const parsed = useMemo(() => {
    try { return JSON.parse(content) as { sheets?: Sheet[] }; } catch { return null; }
  }, [content]);
  const sheets = parsed?.sheets ?? [];

  if (sheets.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground" role="status">La hoja no tiene pestañas.</div>;
  }

  return (
    <div className="grid gap-4 p-6" data-testid="sheet-view">
      {sheets.map(sheet => {
        const keys = Object.keys(sheet.cells);
        return (
          <section key={sheet.id} className="rounded-lg border p-4" data-testid={`sheet-${sheet.id}`}>
            <h3 className="text-sm font-semibold">{sheet.name}</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="text-xs" data-testid={`grid-${sheet.id}`}>
                <tbody>
                  {keys.length === 0 ? <tr><td className="text-muted-foreground">Sin celdas</td></tr> : null}
                  {keys.map(key => (
                    <tr key={key}>
                      <td className="pr-2 font-mono text-muted-foreground">{key}</td>
                      <td className="px-2">{sheet.cells[key]?.value ?? ""}</td>
                      <td className="px-2 text-muted-foreground">{sheet.cells[key]?.formula ? `fx: ${sheet.cells[key]?.formula}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

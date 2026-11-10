import { z } from "zod";

/** Snapshot diffs (backlog F2): a periodic refresh is only a *story* if it says what changed.
 *  Pure functions over two parsed snapshots — the scheduler's runner will call this after each
 *  dataset run and the panel/UI renders the summary. Never mutates; never queries. */

const rowSchema = z.record(z.string(), z.unknown());
const rowsSchema = z.array(rowSchema);

export type SnapshotDiff = {
  kind: "rows" | "scalar" | "shape";
  added: number;
  removed: number;
  changed: number;
  /** Rows that appeared/disappeared/changed values, capped so evidence files stay small. */
  sample: Array<{ change: "added" | "removed" | "changed"; key: string; before?: unknown; after?: unknown }>;
  summary: string;
};

/** Find a stable identity for each row: the first field whose values are unique, else whole-row JSON. */
function keyRows(rows: Array<Record<string, unknown>>): { keyOf: (row: Record<string, unknown>) => string; label: string } | null {
  for (const field of Object.keys(rows[0] ?? {})) {
    const values = new Set(rows.map(row => JSON.stringify(row[field])));
    if (values.size === rows.length && rows.every(row => typeof row[field] === "string" || typeof row[field] === "number")) {
      return { keyOf: row => `${field}=${String(row[field])}`, label: field };
    }
  }
  return null;
}

const scalarOf = (value: unknown): number | string | null =>
  typeof value === "number" || typeof value === "string" ? value : typeof value === "object" && value !== null && !Array.isArray(value)
    ? (() => { const numbers = Object.values(value).filter(entry => typeof entry === "number" || typeof entry === "string"); return numbers.length === 1 ? String(numbers[0]) : null; })()
    : null;

/** Diff two parsed snapshots. Row arrays compare by identity; single-number/string payloads
 *  compare directly; anything else degrades honestly to "shape" (structure changed, no claim). */
/** The first rows array a payload carries — a search snapshot wraps its rows in `results`, and
 *  comparing the envelope instead of those rows reported "shape changed" every time. */
function rowsOf(value: unknown): Array<Record<string, unknown>> | null {
  const direct = rowsSchema.safeParse(value);
  if (direct.success && direct.data.length > 0) return direct.data;
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const entry of Object.values(value)) {
      const nested = rowsOf(entry);
      if (nested) return nested;
    }
  }
  return null;
}

export function diffSnapshots(before: unknown, after: unknown): SnapshotDiff {
  const beforeRows = rowsOf(before);
  const afterRows = rowsOf(after);
  if (beforeRows && afterRows) {
    const key = keyRows(beforeRows.length ? beforeRows : afterRows);
    const beforeMap = new Map((beforeRows ?? []).map(row => [(key ? key.keyOf(row) : JSON.stringify(row)), row]));
    const afterMap = new Map((afterRows ?? []).map(row => [(key ? key.keyOf(row) : JSON.stringify(row)), row]));
    const sample: SnapshotDiff["sample"] = [];
    let added = 0, removed = 0, changed = 0;
    for (const [rowKey, row] of afterMap) {
      const previous = beforeMap.get(rowKey);
      if (previous === undefined) { added++; if (sample.length < 20) sample.push({ change: "added", key: rowKey, after: row }); }
      else if (JSON.stringify(previous) !== JSON.stringify(row)) { changed++; if (sample.length < 20) sample.push({ change: "changed", key: rowKey, before: previous, after: row }); }
    }
    for (const [rowKey, row] of beforeMap) {
      if (!afterMap.has(rowKey)) { removed++; if (sample.length < 20) sample.push({ change: "removed", key: rowKey, before: row }); }
    }
    const parts = [added ? `+${added} nuevo${added === 1 ? "" : "s"}` : "", removed ? `−${removed} perdido${removed === 1 ? "" : "s"}` : "", changed ? `${changed} modificado${changed === 1 ? "" : "s"}` : ""].filter(Boolean);
    return { kind: "rows", added, removed, changed, sample, summary: parts.length ? parts.join(", ") : "sin cambios" };
  }
  const beforeScalar = scalarOf(before), afterScalar = scalarOf(after);
  if (beforeScalar !== null && afterScalar !== null) {
    const equal = String(beforeScalar) === String(afterScalar);
    return {
      kind: "scalar", added: 0, removed: 0, changed: equal ? 0 : 1,
      sample: equal ? [] : [{ change: "changed", key: "valor", before: beforeScalar, after: afterScalar }],
      summary: equal ? "sin cambios" : `${beforeScalar} → ${afterScalar}`,
    };
  }
  return { kind: "shape", added: 0, removed: 0, changed: JSON.stringify(before ?? null) === JSON.stringify(after ?? null) ? 0 : 1, sample: [], summary: "estructura distinta — sin comparación por filas" };
}

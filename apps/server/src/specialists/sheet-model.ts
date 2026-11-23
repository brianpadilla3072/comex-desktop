import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "../errors.js";

/** Canonical model of a sheet artifact. This module is pure: no I/O, no DOM, no
 *  eval. The agent-facing tools and the UI editor both speak this same
 *  `{ sheets: [{ id, name, cells, rows?, cols? }] }` JSON. Formulas are kept raw
 *  (`{ value: "", formula: "=B3*C3" }`) so a save never freezes a computed result. */

export const MAX_COLUMN = 2000;
export const MAX_ROW = 100_000;
export const MAX_READ_CELLS = 400;
export const MAX_WRITE_CELLS = 2000;
const MAX_SHEETS = 50;

const cellFormatSchema = z.enum(["number", "currency", "percent", "date", "text"]);
export type CellFormat = z.infer<typeof cellFormatSchema>;

export const cellSchema = z.object({
  value: z.string().max(20_000),
  formula: z.string().max(20_000).optional(),
  format: cellFormatSchema.optional(),
});
export type SheetCell = z.infer<typeof cellSchema>;

export const sheetSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  cells: z.record(z.string(), cellSchema),
  rows: z.number().int().min(1).max(MAX_ROW).optional(),
  cols: z.number().int().min(1).max(MAX_COLUMN).optional(),
});
export type Sheet = z.infer<typeof sheetSchema>;

export const sheetDocumentSchema = z.object({ sheets: z.array(sheetSchema).min(1).max(MAX_SHEETS) });
export type SheetDocument = z.infer<typeof sheetDocumentSchema>;

const invalid = (code: string, message: string) => new ApiError(422, code, message);

export function parseSheetDocument(content: string): SheetDocument {
  let raw: unknown;
  try { raw = JSON.parse(content); }
  catch { throw invalid("invalid_sheet", "El artefacto no contiene JSON válido; no es una hoja de cálculo."); }
  const result = sheetDocumentSchema.safeParse(raw);
  if (!result.success) throw invalid("invalid_sheet", "El artefacto no sigue el formato { sheets: [{ id, name, cells }] } de una hoja de cálculo.");
  return result.data;
}

export function serializeSheetDocument(document: SheetDocument): string {
  return JSON.stringify(document);
}

export interface Ref { col: number; row: number }

export function columnLabel(index: number): string {
  if (!Number.isInteger(index) || index < 0) throw invalid("invalid_sheet_ref", "La columna debe ser un índice positivo.");
  let label = "";
  let value = index;
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}

export function columnIndex(label: string): number {
  const letters = label.trim().toUpperCase();
  if (!/^[A-Z]{1,4}$/.test(letters)) throw invalid("invalid_sheet_ref", `La columna ${label} no es válida (usa A, B, C…).`);
  let value = 0;
  for (const letter of letters) value = value * 26 + (letter.charCodeAt(0) - 64);
  return value - 1;
}

export function parseRef(ref: string): Ref {
  const match = /^([A-Z]{1,4})([1-9]\d{0,6})$/.exec(ref.trim().toUpperCase());
  if (!match) throw invalid("invalid_sheet_ref", `La referencia ${ref} no es válida; usa por ejemplo B3.`);
  const result = { col: columnIndex(match[1] as string), row: Number(match[2] as string) };
  if (result.col >= MAX_COLUMN || result.row > MAX_ROW) throw invalid("invalid_sheet_ref", `La referencia ${ref} está fuera del rango permitido (${columnLabel(MAX_COLUMN - 1)}${MAX_ROW}).`);
  return result;
}

export function formatRef(ref: Ref): string {
  return `${columnLabel(ref.col)}${ref.row}`;
}

export interface RefRange { first: Ref; last: Ref }

export function parseRange(range: string): RefRange {
  const parts = range.trim().toUpperCase().split(":");
  if (parts.length > 2 || parts.length === 0) throw invalid("invalid_sheet_range", `El rango ${range} no es válido; usa por ejemplo B2:D8.`);
  const first = parseRef(parts[0] as string);
  const last = parseRef(parts[1] ?? parts[0] as string);
  return {
    first: { col: Math.min(first.col, last.col), row: Math.min(first.row, last.row) },
    last: { col: Math.max(first.col, last.col), row: Math.max(first.row, last.row) },
  };
}

export function rangeRefs(range: RefRange, limit = 50_000): string[] {
  const refs: string[] = [];
  for (let row = range.first.row; row <= range.last.row; row++) {
    for (let col = range.first.col; col <= range.last.col; col++) {
      if (refs.length >= limit) throw invalid("sheet_range_too_big", "El rango es demasiado grande; achicalo o usá export por hoja completa.");
      refs.push(formatRef({ col, row }));
    }
  }
  return refs;
}

function selectSheet(document: SheetDocument, name?: string): { index: number; sheet: Sheet } {
  const index = name ? document.sheets.findIndex(sheet => sheet.name.toLowerCase() === name.trim().toLowerCase() || sheet.id === name.trim()) : 0;
  if (index < 0) throw invalid("sheet_not_found", `No existe la hoja «${name}». Usá specialist_sheet_read sin hoja para ver los nombres.`);
  return { index: index, sheet: document.sheets[index] as Sheet };
}

function ensureCapacity(sheet: Sheet, ref: Ref) {
  sheet.rows = Math.max(sheet.rows ?? 1, ref.row);
  sheet.cols = Math.max(sheet.cols ?? 1, ref.col + 1);
}

/** Cell value used by read/export. Computed values come from the formula evaluator. */
export type CellValue = number | string | boolean | null | CellValue[];

export interface ComputedCell { value: CellValue; error?: string }

/** ---------- Small, safe formula evaluator (no eval, no Function, no dynamic code) ---------- */

type Token =
  | { kind: "number"; text: string }
  | { kind: "string"; text: string }
  | { kind: "name"; text: string }
  | { kind: "op"; text: string }
  | { kind: "punct"; text: string };

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let rest = expression.trim();
  while (rest) {
    const match = /^("(?:""|[^"])*"|'(?:''|[^'])*'!\$?[A-Za-z]{1,4}\$?\d+|\$?[A-Za-z]{1,4}\$?\d+|[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|<>|!=|<=|>=|[+\-*/^&=<>!,():;])/.exec(rest);
    if (!match) throw invalid("invalid_formula", `No se puede interpretar «${rest.slice(0, 24)}» dentro de la fórmula.`);
    const text = match[0] as string;
    rest = rest.slice(text.length).trimStart();
    if (/^\d/.test(text)) tokens.push({ kind: "number", text });
    else if (text.startsWith('"')) tokens.push({ kind: "string", text: text.slice(1, -1).replace(/""/g, '"') });
    else if (/^[+\-*/^&=<>!,():;]$/.test(text) || ["<>", "!=", "<=", ">="].includes(text)) tokens.push({ kind: "op", text });
    else tokens.push({ kind: "name", text });
  }
  return tokens;
}

type Ast =
  | { kind: "literal"; value: CellValue }
  | { kind: "cell"; sheet?: string; ref: string }
  | { kind: "range"; sheet?: string; from: string; to: string }
  | { kind: "unary"; op: string; value: Ast }
  | { kind: "binary"; op: string; left: Ast; right: Ast }
  | { kind: "call"; name: string; args: Ast[] };

class Parser {
  private position = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): Ast {
    const ast = this.expression(0);
    if (this.position < this.tokens.length) throw invalid("invalid_formula", "La fórmula tiene texto sobrante.");
    return ast;
  }

  private peek(): Token | undefined { return this.tokens[this.position]; }

  private eat(text: string): boolean {
    if (this.peek()?.text !== text) return false;
    this.position++;
    return true;
  }

  private precedence(op: string): number {
    if (op === "=" || op === "<>" || op === "!=" || op === "<" || op === "<=" || op === ">" || op === ">=") return 1;
    if (op === "&") return 2;
    if (op === "+" || op === "-") return 3;
    if (op === "*" || op === "/") return 4;
    if (op === "^") return 5;
    return -1;
  }

  private expression(minimum: number): Ast {
    let left = this.primary();
    while (true) {
      const token = this.peek();
      if (!token || token.kind !== "op") break;
      const precedence = this.precedence(token.text);
      if (precedence < minimum) break;
      this.position++;
      const right = this.expression(token.text === "^" ? precedence : precedence + 1);
      left = { kind: "binary", op: token.text, left: left, right: right };
    }
    return left;
  }

  private primary(): Ast {
    const token = this.peek();
    if (!token) throw invalid("invalid_formula", "La fórmula está incompleta.");
    if (this.eat("(")) {
      const value = this.expression(0);
      if (!this.eat(")")) throw invalid("invalid_formula", "Falta un paréntesis de cierre.");
      return value;
    }
    if (this.eat("-")) return { kind: "unary", op: "-", value: this.expression(6) };
    if (this.eat("+")) return { kind: "unary", op: "+", value: this.expression(6) };
    if (token.kind === "number") { this.position++; return { kind: "literal", value: Number(token.text) }; }
    if (token.kind === "string") { this.position++; return { kind: "literal", value: token.text }; }
    if (token.kind !== "name") throw invalid("invalid_formula", `No se esperaba «${token.text}» en la fórmula.`);
    this.position++;
    if (token.text.toUpperCase() === "TRUE") return { kind: "literal", value: true };
    if (token.text.toUpperCase() === "FALSE") return { kind: "literal", value: false };

    // `Hoja2!A1` is tokenized as name, `!`, name; quoted names arrive whole.
    if (this.eat("!")) {
      const reference = this.peek();
      if (!reference || reference.kind !== "name" || !/^\$?[A-Za-z]{1,4}\$?\d+$/.test(reference.text)) throw invalid("invalid_formula", "Después de ! esperaba una celda, por ejemplo Hoja2!A1.");
      this.position++;
      return this.finishRef(reference.text.replace(/\$/g, ""), token.text);
    }
    // A quoted sheet name is tokenized together with its cell reference.
    if (token.text.startsWith("'")) {
      const bang = token.text.indexOf("'!");
      const sheet = token.text.slice(1, bang).replace(/''/g, "'");
      const ref = token.text.slice(bang + 2).replace(/\$/g, "");
      return this.finishRef(ref, sheet);
    }
    if (/^\$?[A-Za-z]{1,4}\$?\d+$/.test(token.text)) return this.finishRef(token.text.replace(/\$/g, ""), undefined);

    if (!this.eat("(")) throw invalid("invalid_formula", `«${token.text}» no es una función ni una celda conocida.`);
    const args: Ast[] = [];
    if (!this.eat(")")) {
      do { args.push(this.expression(0)); } while (this.eat(",") || this.eat(";"));
      if (!this.eat(")")) throw invalid("invalid_formula", `Falta el cierre de la función ${token.text}.`);
    }
    return { kind: "call", name: token.text.toUpperCase(), args: args };
  }

  private finishRef(ref: string, sheet?: string): Ast {
    if (!this.eat(":")) return { kind: "cell", ref: ref.toUpperCase(), sheet: sheet };
    const second = this.peek();
    if (!second || second.kind !== "name" || !/^\$?[A-Za-z]{1,4}\$?\d+$/.test(second.text)) throw invalid("invalid_formula", "El rango necesita dos celdas, por ejemplo A1:B4.");
    this.position++;
    return { kind: "range", from: ref.toUpperCase(), to: second.text.replace(/\$/g, "").toUpperCase(), sheet: sheet };
  }
}

const FORMULA_ERROR = /^#(?:REF|VALUE|DIV\/0|NAME|CYCLE|ERROR|N\/A)/;

function numeric(value: CellValue): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;
    const number = Number(text.replace(/^\$/, ""));
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function flatten(values: Array<CellValue | CellValue[]>): CellValue[] {
  return values.flatMap(value => Array.isArray(value) ? value : [value]);
}

function callFunction(name: string, args: Array<CellValue | CellValue[]>): CellValue {
  const flat = flatten(args);
  const numbers = flat.map(numeric).filter((value): value is number => value !== null);
  switch (name) {
    case "SUM": return numbers.reduce((sum, value) => sum + value, 0);
    case "PRODUCT": return numbers.reduce((product, value) => product * value, 1);
    case "AVERAGE": return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : "#DIV/0!";
    case "MIN": return numbers.length ? Math.min(...numbers) : 0;
    case "MAX": return numbers.length ? Math.max(...numbers) : 0;
    case "COUNT": return numbers.length;
    case "COUNTA": return flat.filter(value => value !== null && value !== "").length;
    case "ABS": return numeric(flat[0] ?? null) === null ? "#VALUE!" : Math.abs(numeric(flat[0] ?? null) as number);
    case "ROUND": {
      const value = numeric(flat[0] ?? null);
      const digits = numeric(flat[1] ?? 0) ?? 0;
      return value === null ? "#VALUE!" : Number(value.toFixed(Math.max(0, Math.min(10, digits))));
    }
    case "LEN": return String(flat[0] ?? "").length;
    case "CONCAT": return flat.map(value => value === null ? "" : String(value)).join("");
    case "IF": return flat[0] ? flat[1] ?? null : flat[2] ?? null;
    default: return "#NAME?";
  }
}

export interface Evaluation { sheets: Record<string, Record<string, ComputedCell>> }

/** Evaluate all formulas once, with cycle detection. Unsupported functions and
 *  broken references resolve to an explicit `#…` marker instead of a guess. */
export function evaluateDocument(document: SheetDocument): Evaluation {
  const cache: Record<string, Record<string, ComputedCell>> = {};
  const visiting = new Set<string>();
  const byName = new Map(document.sheets.map(sheet => [sheet.name.toLowerCase(), sheet]));

  const cell = (sheetName: string, ref: string): ComputedCell => {
    const key = `${sheetName.toLowerCase()}!${ref}`;
    const cached = cache[sheetName]?.[ref];
    if (cached) return cached;
    if (visiting.has(key)) return { value: null, error: "#CYCLE!" };
    visiting.add(key);
    try {
      const sheet = byName.get(sheetName.toLowerCase());
      const raw = sheet?.cells[ref];
      let result: ComputedCell;
      if (!raw) result = { value: null };
      else if (raw.formula) {
        try {
          const ast = new Parser(tokenize(raw.formula.replace(/^=/, ""))).parse();
          result = compute(ast, sheetName);
          if (typeof result.value === "string" && FORMULA_ERROR.test(result.value)) result = { value: null, error: result.value };
        } catch {
          result = { value: null, error: "#ERROR!" };
        }
      } else result = { value: raw.value };
      (cache[sheetName] ??= {})[ref] = result;
      return result;
    } finally { visiting.delete(key); }
  };

  const compute = (ast: Ast, sheetName: string): ComputedCell => {
    switch (ast.kind) {
      case "literal": return { value: ast.value };
      case "cell": {
        parseRef(ast.ref);
        return cell(ast.sheet ?? sheetName, ast.ref);
      }
      case "range": {
        const range = parseRange(`${ast.from}:${ast.to}`);
        const values: CellValue[] = rangeRefs(range, 20_000).map(ref => cell(ast.sheet ?? sheetName, ref).value);
        return { value: values };
      }
      case "unary": {
        const value = numeric(compute(ast.value, sheetName).value);
        return { value: value === null ? "#VALUE!" : ast.op === "-" ? -value : value };
      }
      case "binary": {
        const left = compute(ast.left, sheetName).value;
        const right = compute(ast.right, sheetName).value;
        if (ast.op === "=") return { value: compare(left, right, "eq") };
        if (ast.op === "<>" || ast.op === "!=") return { value: !compare(left, right, "eq") };
        if (ast.op === "<") return { value: compare(left, right, "lt") };
        if (ast.op === "<=") return { value: compare(left, right, "le") };
        if (ast.op === ">") return { value: !compare(left, right, "le") };
        if (ast.op === ">=") return { value: !compare(left, right, "lt") };
        if (ast.op === "&") return { value: `${left === null ? "" : String(left)}${right === null ? "" : String(right)}` };
        const a = numeric(left);
        const b = numeric(right);
        if (a === null || b === null) return { value: "#VALUE!" };
        if (ast.op === "+") return { value: a + b };
        if (ast.op === "-") return { value: a - b };
        if (ast.op === "*") return { value: a * b };
        if (ast.op === "/") return b === 0 ? { value: "#DIV/0!" } : { value: a / b };
        return { value: a ** b };
      }
      case "call": {
        const args = ast.args.map(argument => compute(argument, sheetName).value);
        return { value: callFunction(ast.name, args) };
      }
    }
  };

  const compare = (left: CellValue, right: CellValue, mode: "eq" | "lt" | "le"): boolean => {
    const a = numeric(left);
    const b = numeric(right);
    if (a !== null && b !== null) return mode === "eq" ? a === b : mode === "lt" ? a < b : a <= b;
    const textA = left === null ? "" : String(left);
    const textB = right === null ? "" : String(right);
    return mode === "eq" ? textA === textB : mode === "lt" ? textA < textB : textA <= textB;
  };

  for (const sheet of document.sheets) for (const ref of Object.keys(sheet.cells)) cell(sheet.name, ref);
  return { sheets: cache };
}

/** ---------- Operations. All return a new document; none mutates the input. ---------- */

export interface OperationResult { document: SheetDocument; changed: number; notes?: string[] }

function copy(document: SheetDocument): SheetDocument {
  return {
    sheets: document.sheets.map(sheet => ({
      ...sheet,
      cells: Object.fromEntries(Object.entries(sheet.cells).map(([ref, cell]) => [ref, { ...cell }])),
    })),
  };
}

export function readSheet(document: SheetDocument, options: {
  sheet?: string; range?: string; computed?: boolean; limit?: number;
}): { sheet: string; rows: number; cols: number; cells: Array<{ ref: string; value: string; formula?: string; computed?: CellValue; error?: string; format?: CellFormat }>; truncated: boolean } {
  const selected = selectSheet(document, options.sheet);
  const refs = options.range
    ? rangeRefs(parseRange(options.range))
    : Object.keys(selected.sheet.cells).sort((a, b) => {
      const left = parseRef(a);
      const right = parseRef(b);
      return left.row - right.row || left.col - right.col;
    });
  const limit = Math.min(Math.max(options.limit ?? MAX_READ_CELLS, 1), MAX_READ_CELLS);
  const evaluation = options.computed === false ? null : evaluateDocument(document);
  const cells = refs.slice(0, limit).flatMap(ref => {
    const source = selected.sheet.cells[ref];
    if (!source) return [];
    const result = evaluation?.sheets[selected.sheet.name]?.[ref];
    return [{
      ref: ref,
      value: source.value,
      ...(source.formula ? { formula: source.formula } : {}),
      ...(source.format ? { format: source.format } : {}),
      ...(result && source.formula ? { computed: result.value, ...(result.error ? { error: result.error } : {}) } : {}),
    }];
  });
  return {
    sheet: selected.sheet.name,
    rows: selected.sheet.rows ?? 1,
    cols: selected.sheet.cols ?? 1,
    cells: cells,
    truncated: refs.length > limit,
  };
}

export function writeCells(document: SheetDocument, options: {
  sheet?: string; start?: string; cells?: Record<string, string>;
  updates?: Array<{ cell: string; value?: string; formula?: string; format?: string }>;
}): OperationResult {
  const selected = selectSheet(document, options.sheet);
  const next = copy(document);
  const target = next.sheets[selected.index] as Sheet;
  const items: Array<{ cell: string; value?: string; formula?: string; format?: string }> = [];
  const offset = options.start ? parseRef(options.start) : null;
  for (const [ref, value] of Object.entries(options.cells ?? {})) {
    const coordinate = parseRef(ref);
    items.push({
      cell: offset ? formatRef({ col: offset.col + coordinate.col, row: offset.row + coordinate.row - 1 }) : ref.toUpperCase(),
      value: value,
    });
  }
  for (const item of options.updates ?? []) items.push(item);
  if (!items.length) throw invalid("sheet_no_cells", "No hay celdas para escribir.");
  if (items.length > MAX_WRITE_CELLS) throw invalid("sheet_too_many_cells", `Como máximo ${MAX_WRITE_CELLS} celdas por llamada.`);
  for (const item of items) {
    const ref = parseRef(item.cell);
    const formula = item.formula ?? (item.value?.startsWith("=") ? item.value : undefined);
    const format = item.format ? cellFormatSchema.safeParse(item.format) : null;
    if (format && !format.success) throw invalid("invalid_sheet_format", `El formato ${item.format} no es válido; usá number, currency, percent, date o text.`);
    const cell: SheetCell = {
      value: formula ? "" : item.value ?? "",
      ...(formula ? { formula: formula } : {}),
      ...(format?.success ? { format: format.data } : {}),
    };
    target.cells[formatRef(ref)] = cell;
    ensureCapacity(target, ref);
  }
  return { document: next, changed: items.length };
}

export function clearCells(document: SheetDocument, options: { sheet?: string; range?: string; cells?: string[] }): OperationResult {
  const selected = selectSheet(document, options.sheet);
  const next = copy(document);
  const target = next.sheets[selected.index] as Sheet;
  const refs = options.range ? rangeRefs(parseRange(options.range)) : (options.cells ?? []).map(ref => formatRef(parseRef(ref)));
  if (!refs.length) throw invalid("sheet_no_cells", "Indicá un rango o una lista de celdas para limpiar.");
  let changed = 0;
  for (const ref of refs) if (delete target.cells[ref]) changed++;
  return { document: next, changed: changed };
}

function shiftFormula(formula: string, axis: "row" | "column", at: number, count: number, remove: boolean): string {
  let changed = "";
  for (const part of formula.split(/("(?:""|[^"])*")/g)) {
    if (part.startsWith('"')) { changed += part; continue; }
    changed += part.replace(/(\$?)([A-Za-z]{1,4})(\$?)([1-9]\d{0,6})/g, (match, dollarCol: string, letters: string, dollarRow: string, digits: string, offset: number) => {
      const before = part[offset - 1] ?? "";
      const after = part[offset + match.length] ?? "";
      if (/[A-Za-z0-9_$.!]/.test(before) || /[A-Za-z0-9_]/.test(after)) return match;
      const starts = axis === "row" ? Number(digits) : columnIndex(letters);
      // The removed interval must be anchored at the requested position, not
      // at each reference: using `starts + count - 1` marked every later
      // column reference as deleted and turned it into #REF!.
      const ends = axis === "row" ? starts : at + count - 1;
      if (remove) {
        if (starts >= at && starts <= ends) return "#REF!";
        return starts > ends ? (axis === "row" ? `${dollarCol}${letters}${dollarRow}${Number(digits) - count}` : `${dollarCol}${columnLabel(starts - count)}${dollarRow}${digits}`) : match;
      }
      if (starts < at) return match;
      return axis === "row"
        ? `${dollarCol}${letters}${dollarRow}${Number(digits) + count}`
        : `${dollarCol}${columnLabel(starts + count)}${dollarRow}${digits}`;
    });
  }
  return changed;
}

export function shiftCells(document: SheetDocument, options: {
  sheet?: string; axis: "row" | "column"; at: number; count?: number; remove?: boolean;
}): OperationResult {
  const axis = options.axis;
  if (axis !== "row" && axis !== "column") throw invalid("invalid_sheet_axis", "El eje debe ser row o column.");
  const at = Math.max(1, Math.floor(options.at));
  const count = Math.min(Math.max(Math.floor(options.count ?? 1), 1), 1000);
  const remove = options.remove === true;
  const selected = selectSheet(document, options.sheet);
  const next = copy(document);
  const target = next.sheets[selected.index] as Sheet;
  // `at` is public and 1-based on both axes, but parseRef().col is zero-based
  // (A = 0) while row is already 1-based. Normalize once so cell positions and
  // formula references use the same origin; otherwise "delete column 2" drops C.
  const origin = axis === "row" ? at : at - 1;
  const originalRows = target.rows ?? 1;
  const originalCols = target.cols ?? 1;
  const cells: Record<string, SheetCell> = {};
  let changed = 0;
  for (const [ref, cell] of Object.entries(target.cells)) {
    const coordinate = parseRef(ref);
    const position = axis === "row" ? coordinate.row : coordinate.col;
    if (remove && position >= origin && position < origin + count) { changed++; continue; }
    const moved = remove && position >= origin + count
      ? position - count
      : !remove && position >= origin
        ? position + count
        : position;
    const destination = axis === "row"
      ? { col: coordinate.col, row: moved }
      : { col: moved, row: coordinate.row };
    if (destination.col >= MAX_COLUMN || destination.row > MAX_ROW) { changed++; continue; }
    cells[formatRef(destination)] = {
      ...cell,
      ...(cell.formula ? { formula: shiftFormula(cell.formula, axis, origin, count, remove) } : {}),
    };
    if (destination.col !== coordinate.col || destination.row !== coordinate.row || cell.formula) changed++;
  }
  target.cells = cells;
  const usedRows = Math.max(0, ...Object.keys(cells).map(ref => parseRef(ref).row));
  const usedCols = Math.max(0, ...Object.keys(cells).map(ref => parseRef(ref).col + 1));
  // Capacity is recomputed from the original size, not from `target.rows/cols`
  // after a move: ensureCapacity used to grow them inside the loop and then the
  // +count here grew them again, leaving a phantom empty row/column.
  const nextRows = axis === "row" ? (remove ? originalRows - count : originalRows + count) : originalRows;
  const nextCols = axis === "column" ? (remove ? originalCols - count : originalCols + count) : originalCols;
  target.rows = Math.max(1, usedRows, nextRows);
  target.cols = Math.max(1, usedCols, nextCols);
  return { document: next, changed: changed, notes: remove ? ["Las fórmulas que apuntaban a celdas borradas quedaron como #REF!; revisalas."] : undefined };
}

export function manageSheet(document: SheetDocument, options: { action: "add" | "rename" | "remove"; sheet?: string; name?: string }): OperationResult {
  const next = copy(document);
  if (options.action === "add") {
    const name = options.name?.trim() || `Hoja${next.sheets.length + 1}`;
    if (next.sheets.some(sheet => sheet.name.toLowerCase() === name.toLowerCase())) throw invalid("sheet_exists", `Ya existe la hoja «${name}».`);
    next.sheets.push({ id: `sheet-${randomUUID().slice(0, 8)}`, name: name, cells: {} });
    return { document: next, changed: 1 };
  }
  const selected = selectSheet(next, options.sheet);
  if (options.action === "rename") {
    const name = options.name?.trim();
    if (!name) throw invalid("sheet_name_required", "Indicá el nombre nuevo de la hoja.");
    if (next.sheets.some((sheet, index) => index !== selected.index && sheet.name.toLowerCase() === name.toLowerCase())) throw invalid("sheet_exists", `Ya existe la hoja «${name}».`);
    (next.sheets[selected.index] as Sheet).name = name;
    return { document: next, changed: 1, notes: ["Las fórmulas que citan esta hoja por nombre pueden necesitar ajuste."] };
  }
  if (next.sheets.length < 2) throw invalid("sheet_last_one", "No se puede borrar la única hoja del artefacto.");
  next.sheets.splice(selected.index, 1);
  return { document: next, changed: 1, notes: ["Las fórmulas que citaban la hoja borrada quedaron como #NAME?; revisalas."] };
}

export function sortCells(document: SheetDocument, options: {
  sheet?: string; range: string; column?: string; descending?: boolean;
}): OperationResult {
  const selected = selectSheet(document, options.sheet);
  const next = copy(document);
  const target = next.sheets[selected.index] as Sheet;
  const range = parseRange(options.range);
  const keyColumn = options.column ? columnIndex(options.column) : range.first.col;
  if (keyColumn < range.first.col || keyColumn > range.last.col) throw invalid("invalid_sheet_range", "La columna de ordenación debe estar dentro del rango.");
  const evaluation = evaluateDocument(document);
  const rows: number[] = [];
  for (let row = range.first.row; row <= range.last.row; row++) rows.push(row);
  const keyFor = (row: number) => {
    const ref = formatRef({ col: keyColumn, row: row });
    const result = evaluation.sheets[target.name]?.[ref];
    return result?.value ?? null;
  };
  // Spreadsheet columns are often text ("Producto", "zona"). Sorting only by
  // numeric() left every text key as null and silently did nothing. Keep
  // numbers first, then text (case-insensitive), then blanks.
  const sortKey = (value: CellValue | null) => {
    const number = value === null ? null : numeric(value);
    if (number !== null) return { kind: 0, number: number, text: "" };
    if (value === null || value === "") return { kind: 2, number: 0, text: "" };
    return { kind: 1, number: 0, text: String(value).toLocaleLowerCase() };
  };
  rows.sort((left, right) => {
    const a = sortKey(keyFor(left));
    const b = sortKey(keyFor(right));
    const comparison = a.kind !== b.kind
      ? a.kind - b.kind
      : a.kind === 0
        ? a.number - b.number
        : a.kind === 1
          ? a.text.localeCompare(b.text)
          : 0;
    return options.descending ? -comparison : comparison;
  });
  const refs = rangeRefs(range);
  const block = refs.map(ref => target.cells[ref] ? { ref: ref, cell: { ...(target.cells[ref] as SheetCell) } } : null);
  const width = range.last.col - range.first.col + 1;
  let changed = 0;
  rows.forEach((sourceRow, position) => {
    for (let column = 0; column < width; column++) {
      const from = block[(sourceRow - range.first.row) * width + column];
      const destination = formatRef({ col: range.first.col + column, row: range.first.row + position });
      if (from) target.cells[destination] = { ...from.cell };
      else delete target.cells[destination];
      if (from?.ref !== destination) changed++;
    }
  });
  return { document: next, changed: changed, notes: ["Ordenar mueve el contenido, no reescribe referencias dentro de fórmulas; revisalas si el rango las contiene."] };
}

export function findCells(document: SheetDocument, options: {
  query: string; sheet?: string; regex?: boolean; limit?: number;
}): Array<{ sheet: string; ref: string; value: string; formula?: string }> {
  if (!options.query) throw invalid("sheet_query_required", "Indicá qué querés buscar.");
  let matcher: (text: string) => boolean;
  if (options.regex) {
    try { const expression = new RegExp(options.query, "i"); matcher = text => expression.test(text); }
    catch { throw invalid("invalid_regex", "La expresión regular no es válida."); }
  } else {
    const needle = options.query.toLowerCase();
    matcher = text => text.toLowerCase().includes(needle);
  }
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const result: Array<{ sheet: string; ref: string; value: string; formula?: string }> = [];
  for (const sheet of document.sheets) {
    if (options.sheet && sheet.name.toLowerCase() !== options.sheet.trim().toLowerCase()) continue;
    for (const [ref, cell] of Object.entries(sheet.cells)) {
      if (!matcher(`${cell.value} ${cell.formula ?? ""}`)) continue;
      result.push({ sheet: sheet.name, ref: ref, value: cell.value, ...(cell.formula ? { formula: cell.formula } : {}) });
      if (result.length >= limit) return result;
    }
  }
  return result;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index] as string;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && !field) quoted = true;
    else if (char === "," || char === ";" || char === "\t") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (char !== "\r") field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function escapeCsv(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function importRows(document: SheetDocument, options: {
  sheet?: string; csv?: string; rows?: string[][]; start?: string;
}): OperationResult {
  const rows = options.rows ?? (options.csv !== undefined ? parseCsv(options.csv) : []);
  if (!rows.length) throw invalid("sheet_no_rows", "No hay filas para importar; pasá rows o csv.");
  const start = options.start ? parseRef(options.start) : { col: 0, row: 1 };
  const updates = rows.flatMap((row, rowIndex) => row.map((value, colIndex) => ({
    cell: formatRef({ col: start.col + colIndex, row: start.row + rowIndex }), value: value,
  })));
  if (updates.length > MAX_WRITE_CELLS) throw invalid("sheet_too_many_cells", `Como máximo ${MAX_WRITE_CELLS} celdas por importación.`);
  return writeCells(document, { sheet: options.sheet, updates: updates });
}

export function exportSheet(document: SheetDocument, options: {
  sheet?: string; range?: string; computed?: boolean;
}): { sheet: string; csv: string; cells: number } {
  const selected = selectSheet(document, options.sheet);
  const range = options.range ? parseRange(options.range) : {
    first: { col: 0, row: 1 },
    last: {
      col: Math.max((selected.sheet.cols ?? 1) - 1, ...Object.keys(selected.sheet.cells).map(ref => parseRef(ref).col)),
      row: Math.max(selected.sheet.rows ?? 1, ...Object.keys(selected.sheet.cells).map(ref => parseRef(ref).row)),
    },
  };
  if ((range.last.col - range.first.col + 1) * (range.last.row - range.first.row + 1) > 50_000) throw invalid("sheet_range_too_big", "El rango a exportar es demasiado grande.");
  const evaluation = options.computed === false ? null : evaluateDocument(document);
  const lines: string[] = [];
  for (let row = range.first.row; row <= range.last.row; row++) {
    const values: string[] = [];
    for (let col = range.first.col; col <= range.last.col; col++) {
      const ref = formatRef({ col: col, row: row });
      const cell = selected.sheet.cells[ref];
      const result = evaluation?.sheets[selected.sheet.name]?.[ref];
      const raw = cell?.formula && options.computed !== false
        ? result ? result.error ?? (result.value === null ? "" : String(result.value)) : ""
        : cell?.formula ?? cell?.value ?? "";
      values.push(escapeCsv(raw));
    }
    lines.push(values.join(","));
  }
  return { sheet: selected.sheet.name, csv: lines.join("\n"), cells: lines.length };
}

export function applyFormat(document: SheetDocument, options: {
  sheet?: string; range?: string; cells?: string[]; format: CellFormat | "";
}): OperationResult {
  const selected = selectSheet(document, options.sheet);
  const next = copy(document);
  const target = next.sheets[selected.index] as Sheet;
  const refs = options.range ? rangeRefs(parseRange(options.range)) : (options.cells ?? []).map(ref => formatRef(parseRef(ref)));
  if (!refs.length) throw invalid("sheet_no_cells", "Indicá un rango o una lista de celdas para formatear.");
  const format = options.format === "" ? undefined : cellFormatSchema.parse(options.format);
  let changed = 0;
  for (const ref of refs) {
    const existing = target.cells[ref];
    if (!existing && !format) continue;
    const cell: SheetCell = existing ?? { value: "" };
    if (format) cell.format = format;
    else delete cell.format;
    target.cells[ref] = cell;
    // A formatted cell outside the current grid must still grow it, or the UI
    // (which sizes jspreadsheet from rows/cols) would never render it.
    ensureCapacity(target, parseRef(ref));
    changed++;
  }
  return { document: next, changed: changed };
}

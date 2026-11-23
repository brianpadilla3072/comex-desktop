import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyFormat, clearCells, columnIndex, columnLabel, evaluateDocument, exportSheet, findCells,
  formatRef, importRows, manageSheet, parseRange, parseRef, readSheet, serializeSheetDocument,
  shiftCells, sortCells, writeCells,
  type SheetDocument,
} from "../src/specialists/sheet-model.js";

function doc(cells: Record<string, { value: string; formula?: string; format?: string }> = {}): SheetDocument {
  return { sheets: [{ id: "sheet-1", name: "Hoja1", cells: cells }] };
}

test("sheet refs and ranges round-trip across A..ZZ and clamp to the allowed grid", () => {
  assert.equal(columnLabel(0), "A");
  assert.equal(columnLabel(25), "Z");
  assert.equal(columnLabel(26), "AA");
  assert.equal(columnLabel(701), "ZZ");
  assert.equal(columnIndex("aa"), 26);
  assert.deepEqual(parseRef(" b3 "), { col: 1, row: 3 });
  assert.equal(formatRef({ col: 27, row: 9 }), "AB9");
  const range = parseRange("d2:b8");
  assert.deepEqual(range, { first: { col: 1, row: 2 }, last: { col: 3, row: 8 } });
  assert.throws(() => parseRef("A0"), /no es válida/);
  assert.throws(() => parseRef("1A"), /no es válida/);
  assert.throws(() => parseRange("A1:B2:C3"), /no es válido/);
});

test("writeCells accepts both cells and updates (public `cell` shape) and detects formula strings", () => {
  const result = writeCells(doc(), {
    cells: { A1: "10", B1: "20", C1: "=A1+B1" },
    updates: [{ cell: "D1", formula: "=SUM(A1:B1)" }, { cell: "E1", value: "hola", format: "text" }],
  });
  assert.equal(result.changed, 5);
  const cells = result.document.sheets[0]!.cells;
  assert.equal(cells.C1!.formula, "=A1+B1");
  assert.equal(cells.C1!.value, "");
  assert.equal(cells.D1!.formula, "=SUM(A1:B1)");
  assert.equal(cells.E1!.format, "text");
  assert.equal(result.document.sheets[0]!.cols, 5);
  assert.throws(() => writeCells(doc(), { updates: [{ cell: "A1", format: "nope" }] }), /formato/);
});

test("writeCells with a start anchor writes relative cells without mutating the input", () => {
  const original = doc();
  const result = writeCells(original, { start: "C5", cells: { A1: "x", B2: "y" } });
  assert.deepEqual(Object.keys(original.sheets[0]!.cells), []);
  assert.equal(result.document.sheets[0]!.cells.D6!.value, "y");
  assert.equal(result.document.sheets[0]!.cells.C5!.value, "x");
});

test("the evaluator computes references, ranges, operators and functions, without eval", () => {
  const document = doc({
    A1: { value: "2" }, A2: { value: "3" }, A3: { value: "4" },
    B1: { value: "", formula: "=SUM(A1:A3)" },
    B2: { value: "", formula: "=A1*2+1" },
    B3: { value: "", formula: '=IF(B1>8,"alto","bajo")' },
    B4: { value: "", formula: "=1/0" },
    B5: { value: "", formula: "=NOEXISTE(A1)" },
  });
  const computed = evaluateDocument(document).sheets.Hoja1!;
  assert.equal(computed.B1!.value, 9);
  assert.equal(computed.B2!.value, 5);
  assert.equal(computed.B3!.value, "alto");
  assert.equal(computed.B4!.error, "#DIV/0!");
  assert.equal(computed.B5!.error, "#NAME?");
  assert.equal(readSheet(document, { range: "B1:B5" }).cells[0]!.computed, 9);
});

test("circular references resolve to #CYCLE! instead of hanging", () => {
  const computed = evaluateDocument(doc({
    A1: { value: "", formula: "=B1" },
    B1: { value: "", formula: "=A1" },
  })).sheets.Hoja1!;
  assert.equal(computed.A1!.error, "#CYCLE!");
  assert.equal(computed.B1!.error, "#CYCLE!");
});

test("cross-sheet references and quoted sheet names resolve", () => {
  const document: SheetDocument = {
    sheets: [
      { id: "s1", name: "Hoja1", cells: {
        A1: { value: "", formula: "=Hoja2!B2" },
        A2: { value: "", formula: "='Datos 2026'!B2" },
      } },
      { id: "s2", name: "Hoja2", cells: { B2: { value: "7" } } },
      { id: "s3", name: "Datos 2026", cells: { B2: { value: "9" }, C2: { value: "", formula: "='Datos 2026'!B2*2" } } },
    ],
  };
  const computed = evaluateDocument(document);
  assert.equal(computed.sheets.Hoja1!.A1!.value, "7");
  assert.equal(computed.sheets.Hoja1!.A2!.value, "9");
  assert.equal(computed.sheets["Datos 2026"]!.C2!.value, 18);
});

test("insert shifts cells and formulas; delete produces #REF! for removed references", () => {
  const inserted = shiftCells(doc({
    A2: { value: "10" },
    C2: { value: "", formula: "=A2*2" },
  }), { axis: "row", at: 2, count: 1 });
  assert.equal(inserted.document.sheets[0]!.cells.A3!.value, "10");
  assert.equal(inserted.document.sheets[0]!.cells.C3!.formula, "=A3*2");

  const deleted = shiftCells(doc({
    A1: { value: "1" }, A2: { value: "2" }, B1: { value: "", formula: "=A2" },
  }), { axis: "row", at: 2, remove: true });
  assert.equal(deleted.document.sheets[0]!.cells.A2, undefined);
  assert.equal(deleted.document.sheets[0]!.cells.B1!.formula, "=#REF!");
  assert.match(deleted.notes!.join(" "), /#REF!/);
});

test("clear, format, tabs, sort and find operate on the canonical document", () => {
  let document = writeCells(doc(), { cells: { A1: "z", A2: "a", B1: "10", B2: "2" } }).document;
  document = clearCells(document, { range: "B1:B2" }).document;
  assert.deepEqual(Object.keys(document.sheets[0]!.cells), ["A1", "A2"]);

  document = applyFormat(document, { range: "A1:A2", format: "currency" }).document;
  assert.equal(document.sheets[0]!.cells.A1!.format, "currency");
  document = applyFormat(document, { cells: ["A1"], format: "" }).document;
  assert.equal(document.sheets[0]!.cells.A1!.format, undefined);

  document = manageSheet(document, { action: "add", name: "Datos" }).document;
  assert.equal(document.sheets.length, 2);
  assert.throws(() => manageSheet(document, { action: "add", name: "datos" }), /Ya existe/);
  assert.throws(() => manageSheet(doc(), { action: "remove", sheet: "Hoja1" }), /única hoja/);

  const found = findCells(document, { query: "A" });
  assert.ok(found.every(entry => entry.sheet === "Hoja1" || entry.sheet === "Datos"));
  assert.throws(() => findCells(document, { query: "[" , regex: true }), /expresión regular/);

  const sorted = sortCells(doc({ A1: { value: "3" }, A2: { value: "1" }, B1: { value: "x" }, B2: { value: "y" } }), { range: "A1:B2", column: "A" });
  assert.equal(sorted.document.sheets[0]!.cells.A1!.value, "1");
  assert.equal(sorted.document.sheets[0]!.cells.B2!.value, "x");
});

test("CSV import/export round-trips values and formulas, with raw and computed modes", () => {
  const imported = importRows(doc(), {
    csv: 'producto,precio\n"Soja, AAA",10\nTrigo,=A2&" B"',
    start: "A1",
  });
  assert.equal(imported.document.sheets[0]!.cells.A2!.value, "Soja, AAA");
  assert.equal(imported.document.sheets[0]!.cells.B3!.formula, '=A2&" B"');
  const raw = exportSheet(imported.document, { computed: false });
  assert.match(raw.csv, /"Soja, AAA",10/);
  assert.match(raw.csv, /=A2&"" B""/);
  const computed = exportSheet(imported.document, { computed: true });
  assert.match(computed.csv, /Soja, AAA B/);
  const again = importRows(doc(), { rows: [["a", "b"], ["c", "d"]], start: "B2" }).document;
  assert.equal(again.sheets[0]!.cells.C3!.value, "d");
});

test("column insert/delete uses 1-based `at` for cells and formula references", () => {
  const inserted = shiftCells(doc({
    A1: { value: "1" }, B1: { value: "2" }, C1: { value: "3" },
    A2: { value: "", formula: "=A1+B1" },
  }), { axis: "column", at: 1 });
  const insertedCells = inserted.document.sheets[0]!.cells;
  assert.equal(insertedCells.A1, undefined);
  assert.equal(insertedCells.B1!.value, "1");
  assert.equal(insertedCells.C1!.value, "2");
  assert.equal(insertedCells.D1!.value, "3");
  assert.equal(insertedCells.B2!.formula, "=B1+C1");
  assert.equal(inserted.document.sheets[0]!.cols, 4);

  const deleted = shiftCells(doc({
    A1: { value: "A" }, B1: { value: "B" }, C1: { value: "C" },
    A2: { value: "", formula: "=A1+B1" },
  }), { axis: "column", at: 2, remove: true });
  const deletedCells = deleted.document.sheets[0]!.cells;
  assert.equal(deletedCells.A1!.value, "A");
  assert.equal(deletedCells.B1!.value, "C");
  assert.equal(deletedCells.C1, undefined);
  assert.equal(deletedCells.A2!.formula, "=A1+#REF!");
  assert.equal(deleted.document.sheets[0]!.cols, 2);

  // Removing a column BEFORE the referenced ones shifts them left; only the
  // removed interval becomes #REF!.
  const shifted = shiftCells(doc({
    A1: { value: "x" }, B1: { value: "1" }, C1: { value: "2" },
    B2: { value: "", formula: "=B1+C1" },
  }), { axis: "column", at: 1, remove: true });
  assert.equal(shifted.document.sheets[0]!.cells.A2!.formula, "=A1+B1");
});

test("inserting rows or columns grows the grid once, without a phantom trailing row/column", () => {
  const rows = shiftCells(doc({ A9: { value: "ultima" } }), { axis: "row", at: 1 }).document.sheets[0]!;
  assert.equal(rows.cols, 1);
  assert.equal(rows.rows, 10);
  const columns = shiftCells(doc({ D1: { value: "ultima" } }), { axis: "column", at: 1 }).document.sheets[0]!;
  assert.equal(columns.rows, 1);
  assert.equal(columns.cols, 5);
});

test("sorting by a text column actually reorders rows", () => {
  const sorted = sortCells(doc({
    A1: { value: "clave" }, B1: { value: "valor" },
    A2: { value: "z" }, B2: { value: "1" },
    A3: { value: "a" }, B3: { value: "2" },
    A4: { value: "m" }, B4: { value: "3" },
  }), { range: "A1:B4", column: "A" });
  const cells = sorted.document.sheets[0]!.cells;
  assert.equal(cells.A1!.value, "a");
  assert.equal(cells.B1!.value, "2");
  assert.equal(cells.A2!.value, "clave");
  assert.equal(cells.A3!.value, "m");
  assert.equal(cells.A4!.value, "z");
});

test("formatting an out-of-grid cell grows capacity so the UI can render it", () => {
  const formatted = applyFormat(doc({ A1: { value: "x" } }), { cells: ["Z99"], format: "currency" }).document.sheets[0]!;
  assert.equal(formatted.cols, 26);
  assert.equal(formatted.rows, 99);
  assert.equal(formatted.cells.Z99!.format, "currency");
});

test("documents serialize to the { sheets: [...] } contract the UI parses", () => {
  const content = serializeSheetDocument(doc({ A1: { value: "hola" } }));
  const parsed = JSON.parse(content);
  assert.equal(parsed.sheets[0].name, "Hoja1");
  assert.equal(parsed.sheets[0].cells.A1.value, "hola");
});

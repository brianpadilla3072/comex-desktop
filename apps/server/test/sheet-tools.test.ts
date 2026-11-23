import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readArtifact, writeArtifact } from "../src/specialists/artifacts.js";
import { runSheetTool } from "../src/specialists/sheet-tools.js";

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "sheet-tools-"));
  await mkdir(join(root, "proyecto"), { recursive: true });
  return root;
}

async function newSheet(root: string, title = "Presupuesto") {
  const created = await runSheetTool(root, "specialist_sheet_create", {
    title: title, sheetName: "Hoja1", rows: [["producto", "cantidad", "precio"], ["Soja", "2", "10"]],
  }) as { artifactId: string };
  return created.artifactId;
}

test("sheet tools create, list, read and export a real artifact", async () => {
  const root = await workspace();
  try {
    const id = await newSheet(root);
    const list = await runSheetTool(root, "specialist_sheet_list", {}) as { sheets: Array<{ id: string }> };
    assert.equal(list.sheets.length, 1);
    assert.equal(list.sheets[0]!.id, id);

    const read = await runSheetTool(root, "specialist_sheet_read", { artifactId: id, range: "A1:C2" }) as {
      sheet: string; cells: Array<{ ref: string; value: string }>;
    };
    assert.equal(read.sheet, "Hoja1");
    assert.equal(read.cells[0]!.value, "producto");
    assert.equal(read.cells.at(-1)!.value, "10");

    const exported = await runSheetTool(root, "specialist_sheet_export", { artifactId: id, computed: false }) as { csv: string };
    assert.match(exported.csv, /producto,cantidad,precio/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("write, insert, clear, find, format and tabs are atomic versioned saves", async () => {
  const root = await workspace();
  try {
    const id = await newSheet(root);
    const written = await runSheetTool(root, "specialist_sheet_write", {
      artifactId: id, cells: { B3: "20", D3: "=B3*C3" }, updates: [{ cell: "C3", value: "3", format: "currency" }],
    }) as { changed: number; version: string };
    assert.equal(written.changed, 3);

    const read = await runSheetTool(root, "specialist_sheet_read", { artifactId: id, range: "D3" }) as {
      cells: Array<{ computed: number; formula: string }>;
    };
    assert.equal(read.cells[0]!.formula, "=B3*C3");
    assert.equal(read.cells[0]!.computed, 60);

    const inserted = await runSheetTool(root, "specialist_sheet_insert", { artifactId: id, axis: "row", at: 2 }) as { changed: number };
    assert.ok(inserted.changed > 0);
    const shifted = await runSheetTool(root, "specialist_sheet_read", { artifactId: id, range: "D4" }) as {
      cells: Array<{ formula: string }>;
    };
    assert.equal(shifted.cells[0]!.formula, "=B4*C4");

    const found = await runSheetTool(root, "specialist_sheet_find", { artifactId: id, query: "Soja" }) as { total: number };
    assert.equal(found.total, 1);

    await runSheetTool(root, "specialist_sheet_format", { artifactId: id, range: "A1:C1", format: "text" });
    await runSheetTool(root, "specialist_sheet_tabs", { artifactId: id, action: "add", name: "Datos" });
    const withTab = await runSheetTool(root, "specialist_sheet_read", { artifactId: id }) as {
      sheets?: unknown; sheet: string;
    };
    assert.equal(withTab.sheet, "Hoja1");

    await runSheetTool(root, "specialist_sheet_clear", { artifactId: id, range: "A1:A2" });
    const stored = await readArtifact(root, id);
    assert.ok(stored.meta.versions.length >= 6, `versions: ${stored.meta.versions.length}`);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("versions list and revert restore a previous state without dropping later versions", async () => {
  const root = await workspace();
  try {
    const id = await newSheet(root);
    const versions = await runSheetTool(root, "specialist_sheet_versions", { artifactId: id, action: "list" }) as {
      versions: Array<{ id: string }>;
    };
    assert.equal(versions.versions.length, 1);
    const first = versions.versions[0]!.id;

    await runSheetTool(root, "specialist_sheet_write", { artifactId: id, cells: { Z9: "temporal" } });
    await runSheetTool(root, "specialist_sheet_versions", { artifactId: id, action: "revert", versionId: first });
    const read = await runSheetTool(root, "specialist_sheet_read", { artifactId: id, range: "Z9" }) as { cells: unknown[] };
    assert.equal(read.cells.length, 0);
    const after = await readArtifact(root, id);
    // Reverting rewrites the working copy; it does not create a new version.
    assert.equal(after.meta.versions.length, 2);
    await assert.rejects(
      runSheetTool(root, "specialist_sheet_versions", { artifactId: id, action: "revert" }),
      /versionId/,
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("sheet tools reject non-sheet artifacts and malformed input with explicit errors", async () => {
  const root = await workspace();
  try {
    const created = await writeArtifact(root, {
      type: "doc", title: "Informe", content: "# Informe\n\nTexto.",
      metadata: { workspaceId: "ws_local", schemaVersion: 1 },
    });
    await assert.rejects(
      runSheetTool(root, "specialist_sheet_read", { artifactId: created.meta.id }),
      /no es una hoja de cálculo/,
    );
    await assert.rejects(
      runSheetTool(root, "specialist_sheet_read", { artifactId: "art-inexistente" }),
      /no existe/,
    );
    await assert.rejects(
      runSheetTool(root, "specialist_sheet_write", { artifactId: "art-x", cells: { A1: "x" }, extra: 1 }),
      /no existe/,
    );
    const sheet = await newSheet(root, "Otra hoja");
    await assert.rejects(
      runSheetTool(root, "specialist_sheet_write", { artifactId: sheet, cells: { "1A": "x" } }),
      /no es válida/,
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

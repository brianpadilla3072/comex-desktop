import { z } from "zod";
import { ApiError } from "../errors.js";
import { workspaceIdForPath } from "../workspaces.js";
import { listArtifacts, mutateArtifactContent, readArtifact, revertArtifact, writeArtifact } from "./artifacts.js";
import {
  applyFormat, clearCells, exportSheet, findCells, importRows, manageSheet, parseSheetDocument,
  readSheet, serializeSheetDocument, shiftCells, sortCells, writeCells,
  type SheetDocument, type OperationResult,
} from "./sheet-model.js";

/** Agent-facing tools for the native sheet artifact. Same family, token and
 *  loopback bridge as the rest of `specialist_*`; every write is one atomic,
 *  versioned artifact save so the UI's debounced save cannot clobber it. */

const artifactId = z.string().min(1).max(120).describe("id del artefacto hoja (art-…), visible en specialist_sheet_list");
const sheetName = z.string().min(1).max(120).describe("Nombre o id de la pestaña; si se omite se usa la primera").optional();
const range = z.string().min(1).max(60).describe("Rango en A1, por ejemplo B2:D20").optional();
const cellList = z.array(z.string().min(1).max(20)).min(1).max(2000).describe("Lista de referencias A1").optional();
const formatValue = z.enum(["number", "currency", "percent", "date", "text", ""]);

export const sheetReadSchema = z.object({
  artifactId: artifactId,
  sheet: sheetName,
  range: range,
  computed: z.boolean().default(true).describe("Si incluye el resultado calculado de las fórmulas"),
  limit: z.number().int().min(1).max(400).default(200).describe("Máximo de celdas devueltas (1..400)"),
});
export const sheetCreateSchema = z.object({
  title: z.string().trim().min(1).max(200).describe("Título legible de la hoja nueva"),
  sheetName: z.string().trim().min(1).max(120).default("Hoja1"),
  rows: z.array(z.array(z.string())).max(2000).describe("Filas de texto; una celda que empieza con = se guarda como fórmula").optional(),
  csv: z.string().max(30_000).describe("Contenido CSV separado por coma, punto y coma o tabulador (hasta 30.000 caracteres por llamada)").optional(),
});
export const sheetWriteSchema = z.object({
  artifactId: artifactId,
  sheet: sheetName,
  start: z.string().min(1).max(20).describe("Celda ancla cuando cells usa posiciones relativas A1, B1…").optional(),
  cells: z.record(z.string().min(1).max(20), z.string().max(20_000)).describe("Mapa { B3: '20', D3: '=B3*C3' }").optional(),
  updates: z.array(z.object({
    cell: z.string().min(1).max(20).describe("Referencia A1"),
    value: z.string().max(20_000).describe("Valor o fórmula (si empieza con =)").optional(),
    formula: z.string().max(20_000).describe("Fórmula cruda, por ejemplo =SUM(A1:A5)").optional(),
    format: formatValue.optional(),
  })).max(2000).describe("Actualizaciones explícitas, opcionales junto a cells").optional(),
});
export const sheetClearSchema = z.object({ artifactId: artifactId, sheet: sheetName, range: range, cells: cellList });
export const sheetAxisSchema = z.object({
  artifactId: artifactId,
  sheet: sheetName,
  axis: z.enum(["row", "column"]).describe("row = fila, column = columna"),
  at: z.number().int().min(1).max(100_000).describe("Posición 1-based donde insertar o borrar"),
  count: z.number().int().min(1).max(1000).default(1),
});
export const sheetTabsSchema = z.object({
  artifactId: artifactId,
  action: z.enum(["add", "rename", "remove"]),
  sheet: z.string().min(1).max(120).describe("Pestaña a renombrar o borrar (no hace falta para add)").optional(),
  name: z.string().trim().min(1).max(120).describe("Nombre nuevo (add/rename)").optional(),
});
export const sheetSortSchema = z.object({
  artifactId: artifactId,
  sheet: sheetName,
  range: z.string().min(1).max(60).describe("Rango a ordenar, por ejemplo A1:D40"),
  column: z.string().min(1).max(4).describe("Letra de la columna dentro del rango; por defecto la primera").optional(),
  descending: z.boolean().default(false),
});
export const sheetFindSchema = z.object({
  artifactId: artifactId,
  sheet: sheetName,
  query: z.string().min(1).max(300).describe("Texto a buscar (o regex si regex=true)"),
  regex: z.boolean().default(false),
  limit: z.number().int().min(1).max(500).default(100),
});
export const sheetExportSchema = z.object({
  artifactId: artifactId,
  sheet: sheetName,
  range: range,
  computed: z.boolean().default(true),
});
export const sheetImportSchema = z.object({
  artifactId: artifactId,
  sheet: sheetName,
  start: z.string().min(1).max(20).describe("Celda donde empieza la importación; por defecto A1").optional(),
  rows: z.array(z.array(z.string())).max(2000).describe("Filas de texto; una celda que empieza con = se guarda como fórmula").optional(),
  csv: z.string().max(30_000).describe("Contenido CSV separado por coma, punto y coma o tabulador (hasta 30.000 caracteres por llamada)").optional(),
});
export const sheetFormatSchema = z.object({
  artifactId: artifactId,
  sheet: sheetName,
  range: range,
  cells: cellList,
  format: formatValue.describe("number, currency, percent, date, text o '' para quitar el formato"),
});
export const sheetVersionsSchema = z.object({
  artifactId: artifactId,
  action: z.enum(["list", "revert"]),
  versionId: z.string().min(1).max(40).describe("id de la versión a recuperar, visible con action=list").optional(),
});
export const sheetListSchema = z.object({});

export const SHEET_TOOL_NAMES = [
  "specialist_sheet_list", "specialist_sheet_create", "specialist_sheet_read", "specialist_sheet_write",
  "specialist_sheet_clear", "specialist_sheet_insert", "specialist_sheet_delete", "specialist_sheet_tabs",
  "specialist_sheet_sort", "specialist_sheet_find", "specialist_sheet_export", "specialist_sheet_import",
  "specialist_sheet_format", "specialist_sheet_versions",
] as const;
export type SheetToolName = typeof SHEET_TOOL_NAMES[number];

export const SHEET_TOOL_SCHEMAS = {
  specialist_sheet_list: sheetListSchema,
  specialist_sheet_create: sheetCreateSchema,
  specialist_sheet_read: sheetReadSchema,
  specialist_sheet_write: sheetWriteSchema,
  specialist_sheet_clear: sheetClearSchema,
  specialist_sheet_insert: sheetAxisSchema,
  specialist_sheet_delete: sheetAxisSchema,
  specialist_sheet_tabs: sheetTabsSchema,
  specialist_sheet_sort: sheetSortSchema,
  specialist_sheet_find: sheetFindSchema,
  specialist_sheet_export: sheetExportSchema,
  specialist_sheet_import: sheetImportSchema,
  specialist_sheet_format: sheetFormatSchema,
  specialist_sheet_versions: sheetVersionsSchema,
} satisfies Record<SheetToolName, z.ZodType>;

type SheetInput = Record<string, unknown>;

function requireSheetMeta(meta: { type: string }) {
  if (meta.type !== "sheet") throw new ApiError(422, "not_a_sheet", "Ese artefacto no es una hoja de cálculo; usá specialist_sheet_list para encontrar una.");
}

async function changeSheet(
  directory: string,
  id: string,
  label: string,
  change: (document: SheetDocument) => OperationResult,
): Promise<{ artifactId: string; changed: number; version: string; notes?: string[]; result: SheetDocument }> {
  let details: OperationResult | null = null;
  const saved = await mutateArtifactContent(directory, id, (content, meta) => {
    requireSheetMeta(meta);
    details = change(parseSheetDocument(content));
    return serializeSheetDocument(details.document);
  }, label);
  const applied = details as OperationResult | null;
  if (!applied) throw new ApiError(409, "sheet_not_changed", "La hoja no cambió; revisá el rango o las celdas indicadas.");
  return {
    artifactId: id,
    changed: applied.changed,
    version: saved.meta.versions.at(-1)?.id ?? "",
    ...(applied.notes ? { notes: applied.notes } : {}),
    result: applied.document,
  };
}

function summarize(document: SheetDocument) {
  return {
    sheets: document.sheets.map(sheet => ({ id: sheet.id, name: sheet.name, cells: Object.keys(sheet.cells).length, rows: sheet.rows ?? 1, cols: sheet.cols ?? 1 })),
  };
}

export async function runSheetTool(directory: string, name: SheetToolName, rawInput: SheetInput) {
  const schema = SHEET_TOOL_SCHEMAS[name];
  const input = schema.parse(rawInput) as Record<string, unknown>;
  const id = typeof input.artifactId === "string" ? input.artifactId : "";

  switch (name) {
    case "specialist_sheet_list": {
      const sheets = (await listArtifacts(directory)).filter(artifact => artifact.type === "sheet").map(artifact => ({
        id: artifact.id,
        title: artifact.title,
        version: artifact.versions.at(-1)?.id ?? "",
        updatedAt: artifact.updatedAt,
        workspaceId: artifact.metadata.workspaceId,
      }));
      return { sheets: sheets, note: sheets.length ? "Usá specialist_sheet_read con un id para ver pestañas y celdas." : "Todavía no hay hojas; podés crear una con specialist_sheet_create o generar una salida table con specialist_output_generate." };
    }
    case "specialist_sheet_create": {
      const title = input.title as string;
      const sheetName = input.sheetName as string;
      const blank: SheetDocument = { sheets: [{ id: "sheet-1", name: sheetName, cells: {} }] };
      const rows = input.rows as string[][] | undefined;
      const csv = input.csv as string | undefined;
      const document = rows || csv !== undefined ? importRows(blank, { rows: rows, csv: csv }).document : blank;
      const created = await writeArtifact(directory, {
        type: "sheet",
        title: title,
        content: serializeSheetDocument(document),
        metadata: { workspaceId: workspaceIdForPath(directory), schemaVersion: 1 },
        label: "Creada por el agente",
      });
      return { artifactId: created.meta.id, version: created.meta.versions.at(-1)?.id ?? "", ...summarize(document), note: "La hoja ya existe en Artefactos; la app la abre al generar una salida table." };
    }
    case "specialist_sheet_read": {
      const artifact = await readArtifact(directory, id);
      requireSheetMeta(artifact.meta);
      if (artifact.truncated) throw new ApiError(422, "sheet_too_big", "La hoja supera el límite de lectura; usá specialist_sheet_export con un rango.");
      const document = parseSheetDocument(artifact.content);
      return {
        artifactId: id,
        version: artifact.meta.versions.at(-1)?.id ?? "",
        ...readSheet(document, { sheet: input.sheet as string | undefined, range: input.range as string | undefined, computed: input.computed as boolean, limit: input.limit as number }),
      };
    }
    case "specialist_sheet_write": {
      const saved = await changeSheet(directory, id, "Escritura del agente", document => writeCells(document, {
        sheet: input.sheet as string | undefined,
        start: input.start as string | undefined,
        cells: input.cells as Record<string, string> | undefined,
        updates: input.updates as Array<{ cell: string; value?: string; formula?: string; format?: string }> | undefined,
      }));
      return { ...saved, ...summarize(saved.result) };
    }
    case "specialist_sheet_clear": {
      const saved = await changeSheet(directory, id, "Limpieza del agente", document => clearCells(document, {
        sheet: input.sheet as string | undefined,
        range: input.range as string | undefined,
        cells: input.cells as string[] | undefined,
      }));
      return { ...saved, ...summarize(saved.result) };
    }
    case "specialist_sheet_insert":
    case "specialist_sheet_delete": {
      const removing = name === "specialist_sheet_delete";
      const saved = await changeSheet(directory, id, removing ? "Borrado del agente" : "Inserción del agente", document => shiftCells(document, {
        sheet: input.sheet as string | undefined,
        axis: input.axis as "row" | "column",
        at: input.at as number,
        count: input.count as number,
        remove: removing,
      }));
      return { ...saved, ...summarize(saved.result) };
    }
    case "specialist_sheet_tabs": {
      const saved = await changeSheet(directory, id, "Pestañas del agente", document => manageSheet(document, {
        action: input.action as "add" | "rename" | "remove",
        sheet: input.sheet as string | undefined,
        name: input.name as string | undefined,
      }));
      return { ...saved, ...summarize(saved.result) };
    }
    case "specialist_sheet_sort": {
      const saved = await changeSheet(directory, id, "Orden del agente", document => sortCells(document, {
        sheet: input.sheet as string | undefined,
        range: input.range as string,
        column: input.column as string | undefined,
        descending: input.descending as boolean,
      }));
      return { ...saved, ...summarize(saved.result) };
    }
    case "specialist_sheet_find": {
      const artifact = await readArtifact(directory, id);
      requireSheetMeta(artifact.meta);
      const matches = findCells(parseSheetDocument(artifact.content), {
        query: input.query as string,
        sheet: input.sheet as string | undefined,
        regex: input.regex as boolean,
        limit: input.limit as number,
      });
      return { artifactId: id, total: matches.length, matches: matches };
    }
    case "specialist_sheet_export": {
      const artifact = await readArtifact(directory, id);
      requireSheetMeta(artifact.meta);
      const exported = exportSheet(parseSheetDocument(artifact.content), {
        sheet: input.sheet as string | undefined,
        range: input.range as string | undefined,
        computed: input.computed as boolean,
      });
      return { artifactId: id, ...exported, note: "Si querés un archivo .csv, guardá este texto con tu herramienta de archivos." };
    }
    case "specialist_sheet_import": {
      const saved = await changeSheet(directory, id, "Importación del agente", document => importRows(document, {
        sheet: input.sheet as string | undefined,
        start: input.start as string | undefined,
        rows: input.rows as string[][] | undefined,
        csv: input.csv as string | undefined,
      }));
      return { ...saved, ...summarize(saved.result) };
    }
    case "specialist_sheet_format": {
      const saved = await changeSheet(directory, id, "Formato del agente", document => applyFormat(document, {
        sheet: input.sheet as string | undefined,
        range: input.range as string | undefined,
        cells: input.cells as string[] | undefined,
        format: input.format as "" | "number" | "currency" | "percent" | "date" | "text",
      }));
      return { ...saved, ...summarize(saved.result), note: "El formato viaja con la celda; el editor actual muestra el valor, no aplica máscaras visuales." };
    }
    case "specialist_sheet_versions": {
      const action = input.action as "list" | "revert";
      const versionId = input.versionId;
      if (action === "revert" && (typeof versionId !== "string" || !versionId)) throw new ApiError(422, "sheet_version_required", "Indicá versionId con action=revert.");
      const artifact = await readArtifact(directory, id);
      requireSheetMeta(artifact.meta);
      if (action === "list") return {
        artifactId: id,
        versions: artifact.meta.versions.map(version => ({ id: version.id, createdAt: version.createdAt, label: version.label ?? "", author: version.author })),
      };
      const reverted = await revertArtifact(directory, id, versionId as string);
      return { artifactId: id, version: reverted.versions.at(-1)?.id ?? "", note: "El contenido volvió a esa versión; no se borraron las posteriores." };
    }
  }
}

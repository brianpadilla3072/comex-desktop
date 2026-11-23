import { ApiError } from "../errors.js";

/** Pure helpers for the native document artifact. No I/O, no lock: the caller
 *  owns the atomic artifact save, same discipline as the sheet model. */

export type DocFormat = "md" | "mdx";
export type DocWriteMode = "replace" | "append" | "prepend" | "before" | "after";

export type DocHeading = {
  level: number;
  text: string;
  line: number;
  anchor: string;
};

export type DocMatch = { line: number; text: string };

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

function anchorFor(text: string) {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 120) || "seccion";
}

/** Headings with 1-based line numbers, for the viewer outline and doc_read. */
export function docOutline(content: string): DocHeading[] {
  const headings: DocHeading[] = [];
  content.split(/\r?\n/).forEach((line, index) => {
    const match = HEADING.exec(line.trim());
    if (!match) return;
    const text = match[2].trim();
    headings.push({ level: match[1].length, text, line: index + 1, anchor: anchorFor(text) });
  });
  return headings;
}

/** Literal or regex search that returns whole lines with their line numbers. */
export function docFind(content: string, query: string, regex: boolean, limit: number): DocMatch[] {
  let matcher: (line: string) => boolean;
  if (regex) {
    let expression: RegExp;
    try { expression = new RegExp(query, "i"); }
    catch (error) { throw new ApiError(422, "invalid_regex", `Expresión regular inválida: ${error instanceof Error ? error.message : String(error)}`); }
    matcher = line => expression.test(line);
  } else {
    const needle = query.toLocaleLowerCase();
    matcher = line => line.toLocaleLowerCase().includes(needle);
  }
  const matches: DocMatch[] = [];
  content.split(/\r?\n/).forEach((line, index) => {
    if (matches.length >= limit || !matcher(line)) return;
    matches.push({ line: index + 1, text: line });
  });
  return matches;
}

function findHeading(content: string, wanted: string): { index: number; level: number } {
  const lines = content.split(/\r?\n/);
  const needle = wanted.trim().toLocaleLowerCase();
  const index = lines.findIndex(line => {
    const match = HEADING.exec(line.trim());
    if (!match) return false;
    const text = match[2].trim().toLocaleLowerCase();
    return text === needle || text.includes(needle);
  });
  if (index < 0) throw new ApiError(404, "doc_heading_not_found", `No hay un título que coincida con "${wanted}". Usá specialist_doc_read con outline=true para ver los títulos.`);
  return { index, level: HEADING.exec(lines[index].trim())![1].length };
}

/** Insert/replace text relative to a heading or the whole document. Returns
 *  null when the result equals the original, so callers skip empty versions. */
export function docWrite(content: string, mode: DocWriteMode, heading: string | undefined, addition: string): string | null {
  const block = addition.replace(/\s+$/, "");
  if (!block) throw new ApiError(422, "doc_content_required", "El contenido a escribir no puede estar vacío.");
  const lines = content.split(/\r?\n/);
  if (mode === "replace") return block === content ? null : block;
  if (mode === "append") return `${content.replace(/\s+$/, "")}\n\n${block}\n`;
  if (mode === "prepend") return `${block}\n\n${content.replace(/^\s+/, "")}`;

  const found = findHeading(content, heading ?? "");
  let insertAt: number;
  if (mode === "before") {
    insertAt = found.index;
  } else {
    insertAt = found.index + 1;
    while (insertAt < lines.length) {
      const match = HEADING.exec(lines[insertAt].trim());
      if (match && match[1].length <= found.level) break;
      insertAt += 1;
    }
  }
  lines.splice(insertAt, 0, block, "");
  const result = lines.join("\n").replace(/\n{3,}/g, "\n\n");
  return result === content ? null : result;
}

/** Friendly format label stored in metadata so the viewer knows how to render. */
export function formatForContent(content: string, requested: DocFormat | undefined): DocFormat {
  if (requested) return requested;
  return /^import\s|^export\s|<[A-Z][A-Za-z0-9.]*[\s/>]/m.test(content) ? "mdx" : "md";
}

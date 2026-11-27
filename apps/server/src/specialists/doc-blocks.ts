import { ApiError } from "../errors.js";

/** Pure Markdown block operations for the native document artifact. The canonical content stays
 *  Markdown/MDX; block ids are positional (`b1`, `b2`, …) and always come from a fresh listing. */

export type DocBlockType = "heading" | "paragraph" | "list" | "table" | "code" | "image" | "quote" | "hr" | "unknown";

export type DocBlock = {
  id: string;
  type: DocBlockType;
  startLine: number;
  endLine: number;
  text: string;
  level?: number;
};

export type DocBlockAction = "list" | "insert" | "update" | "move" | "duplicate" | "delete";
export type DocBlockPosition = "start" | "end" | "before" | "after";

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const LIST = /^\s*(?:[-+*]|\d+[.)])\s+/;
const QUOTE = /^\s*>\s?/;
const IMAGE = /^\s*!\[[^\]]*\]\([^)]+\)\s*$/;
const HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;

function specialStart(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  return HEADING.test(line.trim()) || FENCE.test(line) || LIST.test(line) || QUOTE.test(line)
    || IMAGE.test(line) || HR.test(line) || (line.includes("|") && TABLE_SEPARATOR.test((lines[index + 1] ?? "").trim()));
}

export function docBlocks(content: string): DocBlock[] {
  const lines = content.split(/\r?\n/);
  const blocks: DocBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    if (!lines[index]!.trim()) { index += 1; continue; }
    const start = index;
    const line = lines[index]!;
    let type: DocBlockType = "paragraph";
    let level: number | undefined;
    const heading = HEADING.exec(line.trim());
    const fence = FENCE.exec(line);
    if (heading) {
      type = "heading";
      level = heading[1]!.length;
      index += 1;
    } else if (fence) {
      type = "code";
      index += 1;
      while (index < lines.length && !new RegExp(`^\\s*${fence[1] === "```" ? "```" : "~~~"}\\s*$`).test(lines[index]!)) index += 1;
      if (index < lines.length) index += 1;
    } else if (IMAGE.test(line)) {
      type = "image";
      index += 1;
    } else if (HR.test(line)) {
      type = "hr";
      index += 1;
    } else if (line.includes("|") && TABLE_SEPARATOR.test((lines[index + 1] ?? "").trim())) {
      type = "table";
      index += 2;
      while (index < lines.length && lines[index]!.trim() && lines[index]!.includes("|")) index += 1;
    } else if (LIST.test(line)) {
      type = "list";
      index += 1;
      while (index < lines.length && LIST.test(lines[index]!)) index += 1;
    } else if (QUOTE.test(line)) {
      type = "quote";
      index += 1;
      while (index < lines.length && QUOTE.test(lines[index]!)) index += 1;
    } else {
      index += 1;
      while (index < lines.length && lines[index]!.trim() && !specialStart(lines, index)) index += 1;
    }
    blocks.push({
      id: `b${blocks.length + 1}`,
      type,
      startLine: start + 1,
      endLine: index,
      text: lines.slice(start, index).join("\n"),
      ...(level ? { level } : {}),
    });
  }
  return blocks;
}

function blockOf(content: string, id: string): DocBlock {
  const block = docBlocks(content).find(entry => entry.id === id);
  if (!block) throw new ApiError(404, "doc_block_not_found", `No existe el bloque ${id}. Volvé a listar los bloques antes de editar.`);
  return block;
}

function replaceLines(content: string, startLine: number, endLine: number, replacement: string[]): string {
  const lines = content.split(/\r?\n/);
  lines.splice(startLine - 1, endLine - startLine + 1, ...replacement);
  return lines.join("\n");
}

function insertLines(content: string, atLine: number, block: string): string {
  const lines = content.split(/\r?\n/);
  const addition = block.split(/\r?\n/);
  const index = Math.max(0, Math.min(lines.length, atLine - 1));
  if (index > 0 && lines[index - 1]?.trim()) addition.unshift("");
  if (index < lines.length && lines[index]?.trim()) addition.push("");
  lines.splice(index, 0, ...addition);
  return lines.join("\n");
}

function coerceType(text: string, type: DocBlockType | undefined, level: number | undefined): string {
  if (!type) return text;
  const clean = text.trim();
  if (type === "heading") return `${"#".repeat(Math.max(1, Math.min(6, level ?? 1)))} ${clean.replace(/^#{1,6}\s+/, "")}`;
  if (type === "list") return clean.split(/\r?\n/).map(line => line.replace(/^\s*(?:[-+*]|\d+[.)])\s+/, "").replace(/^/, "- ")).join("\n");
  if (type === "quote") return clean.split(/\r?\n/).map(line => line.replace(/^>\s?/, "").replace(/^/, "> ")).join("\n");
  if (type === "code") return clean.startsWith("```") || clean.startsWith("~~~") ? clean : `\`\`\`\n${clean}\n\`\`\``;
  if (type === "image" && !IMAGE.test(clean)) throw new ApiError(422, "invalid_doc_block", "Un bloque imagen necesita Markdown ![]().");
  if (type === "hr") return "---";
  return clean.replace(/^#{1,6}\s+/, "").replace(/^>\s?/, "").replace(/^[-+*]\s+/, "");
}

export type DocBlockInput = {
  action: DocBlockAction;
  blockId?: string;
  position?: DocBlockPosition;
  targetBlockId?: string;
  content?: string;
  type?: DocBlockType;
  level?: number;
};

export function applyDocBlockOperation(content: string, input: DocBlockInput): { content: string; blocks: DocBlock[] } {
  if (input.action === "list") return { content, blocks: docBlocks(content) };
  if (input.action === "insert") {
    const text = coerceType(input.content ?? "", input.type, input.level);
    if (!text.trim()) throw new ApiError(422, "doc_content_required", "Indicá el contenido del bloque nuevo.");
    if (input.position === "before" || input.position === "after") {
      const target = blockOf(content, input.targetBlockId ?? "");
      const at = input.position === "before" ? target.startLine : target.endLine + 1;
      const next = insertLines(content, at, text);
      return { content: next, blocks: docBlocks(next) };
    }
    const at = input.position === "end" ? content.split(/\r?\n/).length + 1 : 1;
    const next = insertLines(content, at, text);
    return { content: next, blocks: docBlocks(next) };
  }

  const source = blockOf(content, input.blockId ?? "");
  if (input.action === "update") {
    const preservedType = input.type ?? (["heading", "list", "quote", "code", "image", "hr"].includes(source.type) ? source.type : undefined);
    const text = coerceType(input.content ?? source.text, preservedType, input.level ?? source.level);
    if (!text.trim()) throw new ApiError(422, "doc_content_required", "El bloque actualizado no puede estar vacío; usá delete para borrarlo.");
    const next = replaceLines(content, source.startLine, source.endLine, text.split(/\r?\n/));
    return { content: next, blocks: docBlocks(next) };
  }
  if (input.action === "duplicate") {
    const next = insertLines(content, source.endLine + 1, source.text);
    return { content: next, blocks: docBlocks(next) };
  }
  if (input.action === "delete") {
    const next = replaceLines(content, source.startLine, source.endLine, []);
    return { content: next, blocks: docBlocks(next) };
  }

  const target = input.targetBlockId ? blockOf(content, input.targetBlockId) : null;
  let at: number;
  if (input.position === "start") at = 1;
  else if (input.position === "end") at = content.split(/\r?\n/).length + 1;
  else {
    if (!target) throw new ApiError(422, "doc_block_target_required", "Para mover indicá targetBlockId y position before/after.");
    const removed = source.endLine - source.startLine + 1;
    const targetStart = target.startLine > source.endLine ? target.startLine - removed : target.startLine;
    const targetEnd = target.endLine > source.endLine ? target.endLine - removed : target.endLine;
    at = input.position === "after" ? targetEnd + 1 : targetStart;
  }
  const without = replaceLines(content, source.startLine, source.endLine, []);
  const next = insertLines(without, at, source.text);
  return { content: next, blocks: docBlocks(next) };
}

export type DocTextStyle = "bold" | "italic" | "strike" | "code" | "link" | "clear";

export function formatDocSelection(content: string, query: string, style: DocTextStyle, url?: string, all = false): { content: string; replaced: number } {
  if (!query) throw new ApiError(422, "doc_selection_required", "Indicá el texto exacto que querés formatear.");
  let replaced = 0;
  const wrap = (text: string) => {
    if (style === "bold") return `**${text}**`;
    if (style === "italic") return `*${text}*`;
    if (style === "strike") return `~~${text}~~`;
    if (style === "code") return `\`${text}\``;
    if (style === "link") {
      if (!url || !/^https?:\/\//i.test(url)) throw new ApiError(422, "doc_link_url_required", "El enlace necesita una URL http/https.");
      return `[${text}](${url})`;
    }
    return text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/(\*\*|~~|`)(.*?)\1/g, "$2").replace(/(^|\s)\*([^*]+)\*/g, "$1$2");
  };
  const next = all ? content.split(query).join(wrap(query)) : (() => {
    const index = content.indexOf(query);
    if (index < 0) return content;
    replaced = 1;
    return content.slice(0, index) + wrap(query) + content.slice(index + query.length);
  })();
  if (all) replaced = content.split(query).length - 1;
  if (!replaced) throw new ApiError(404, "doc_selection_not_found", "Ese texto no aparece en el documento. Usá specialist_doc_find para localizarlo.");
  return { content: next, replaced };
}

/** Convert any mini-Studio output into a document-shaped Markdown source. */
export function outputToMarkdown(kind: "mindmap" | "report" | "flashcards" | "quiz" | "table", content: string): string {
  if (kind === "report" || kind === "mindmap") return content;
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw new ApiError(422, "invalid_output", "La salida no tiene JSON válido para importarla."); }
  if (kind === "table" && Array.isArray(value)) {
    const rows = value.filter(row => row && typeof row === "object") as Array<Record<string, unknown>>;
    const keys = rows.length ? Object.keys(rows[0]!) : [];
    if (!keys.length) return "# Tabla\n\nLa salida no tiene columnas.";
    const cell = (entry: unknown) => String(entry ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
    return ["# Tabla", "", `| ${keys.join(" | ")} |`, `| ${keys.map(() => "---").join(" | ")} |`, ...rows.map(row => `| ${keys.map(key => cell(row[key])).join(" | ")} |`)].join("\n");
  }
  if (kind === "flashcards" && Array.isArray(value)) {
    return ["# Flashcards", "", ...value.flatMap((entry, index) => {
      const card = entry as { front?: unknown; back?: unknown };
      return [`## ${index + 1}. ${String(card.front ?? "Tarjeta")}`, "", String(card.back ?? ""), ""];
    })].join("\n");
  }
  if (kind === "quiz" && Array.isArray(value)) {
    return ["# Cuestionario", "", ...value.flatMap((entry, index) => {
      const question = entry as { question?: unknown; options?: unknown[]; answer?: unknown };
      const options = Array.isArray(question.options) ? question.options : [];
      return [`## ${index + 1}. ${String(question.question ?? "Pregunta")}`, "", ...options.map((option, optionIndex) => `- ${optionIndex === question.answer ? "✅" : ""} ${String(option)}`), ""];
    })].join("\n");
  }
  throw new ApiError(422, "invalid_output", "Ese tipo de salida no se puede convertir en documento.");
}

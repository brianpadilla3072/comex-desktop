/**
 * Applies an in-place text edit to a page's source HTML (Editar mode).
 *
 * The edit is made on the file as stored, never on the live frame document: the frame may carry
 * rewritten asset URLs, the picker's outline styles and `contenteditable`, none of which belong on
 * disk. The new text is spliced into the source so every other byte stays as it was; the splice is
 * then checked by re-parsing it. If the check fails, the whole document is re-serialized instead.
 *
 * The person's text is always text: it is escaped, never parsed as HTML, so typing or pasting
 * `<script>` or `<img onerror>` stores the characters, not markup.
 */

export interface DesignTextEdit {
  selector: string;
  tag: string;
  /** Text the element had when editing started (from the frame). */
  before: string;
  /** New text from the frame. */
  text: string;
}

export type DesignTextEditResult =
  | { ok: true; html: string; method: "splice" | "serialize" }
  | { ok: false; reason: "not_found" | "changed" | "not_text" | "too_long" };

export const DESIGN_EDIT_TEXT_LIMIT = 10_000;

/** Elements whose content is not markup, or not text a person edits in place. */
const RAW_TEXT_TAGS = new Set(["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript", "plaintext", "template"]);

/** One line of plain text: no control characters, no line breaks. */
export function sanitizeEditText(value: string): string {
  return value
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

export function escapeHtmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const collapse = (value: string) => value.replace(/\s+/g, " ").trim();
const leadingSpace = (value: string) => /^[ \t\n\r\f]*/.exec(value)?.[0] ?? "";
const trailingSpace = (value: string) => /[ \t\n\r\f]*$/.exec(value)?.[0] ?? "";

function doctypeOf(source: string): string {
  return /^\uFEFF?\s*<!doctype[^>]*>/i.exec(source)?.[0] ?? "";
}

function serialize(doc: Document, source: string): string {
  const doctype = doctypeOf(source);
  const html = doc.documentElement.outerHTML;
  return doctype ? `${doctype}\n${html}` : html;
}

/** End of a start tag that begins at `from` (the "<"), honoring quoted attribute values. */
function startTagEnd(source: string, from: number): number {
  let quote = "";
  for (let index = from + 1; index < source.length; index += 1) {
    const char = source.charAt(index);
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === "\"" || char === "'") {
      quote = char;
    } else if (char === ">") {
      return index + 1;
    }
  }
  return -1;
}

/**
 * Start tags of `tag` in source order, skipping comments, declarations, end tags and the
 * content of raw-text elements. Each entry is [start of "<", end of the start tag].
 */
function startTagsOf(source: string, tag: string): Array<[number, number]> {
  const found: Array<[number, number]> = [];
  const lower = source.toLowerCase();
  let index = 0;
  while (index < source.length) {
    const open = lower.indexOf("<", index);
    if (open < 0) break;
    if (lower.startsWith("<!--", open)) {
      const close = lower.indexOf("-->", open + 4);
      index = close < 0 ? source.length : close + 3;
      continue;
    }
    if (lower.startsWith("<!", open) || lower.startsWith("<?", open) || lower.startsWith("</", open)) {
      const close = lower.indexOf(">", open + 1);
      index = close < 0 ? source.length : close + 1;
      continue;
    }
    const name = /^[a-z][a-z0-9-]*/.exec(lower.slice(open + 1, open + 80))?.[0];
    if (!name) {
      index = open + 1;
      continue;
    }
    const end = startTagEnd(source, open);
    if (end < 0) break;
    if (name === tag) found.push([open, end]);
    index = end;
    if (RAW_TEXT_TAGS.has(name)) {
      const close = lower.indexOf(`</${name}`, end);
      index = close < 0 ? source.length : close;
    }
  }
  return found;
}

function splice(source: string, doc: Document, element: Element, tag: string, text: string): string | null {
  const domIndex = Array.from(doc.getElementsByTagName(tag)).indexOf(element);
  const tags = startTagsOf(source, tag);
  if (domIndex < 0 || tags.length !== doc.getElementsByTagName(tag).length) return null;
  const entry = tags[domIndex];
  if (!entry) return null;
  const innerStart = entry[1];
  // The element has no child elements, so its content ends at the next end tag of the same name.
  const innerEnd = source.toLowerCase().indexOf(`</${tag}`, innerStart);
  if (innerEnd < 0) return null;
  const inner = source.slice(innerStart, innerEnd);
  return source.slice(0, innerStart) + leadingSpace(inner) + escapeHtmlText(text) + trailingSpace(inner) + source.slice(innerEnd);
}

function locate(doc: Document, selector: string): Element | null {
  try {
    const found = doc.querySelectorAll(selector);
    return found.length === 1 ? found[0] ?? null : null;
  } catch {
    return null;
  }
}

export function applyTextEdit(source: string, edit: DesignTextEdit): DesignTextEditResult {
  const text = sanitizeEditText(edit.text).trim();
  if (text.length > DESIGN_EDIT_TEXT_LIMIT) return { ok: false, reason: "too_long" };
  const tag = edit.tag.toLowerCase();
  const doc = new DOMParser().parseFromString(source, "text/html");
  const element = locate(doc, edit.selector);
  if (!element || element.localName !== tag) return { ok: false, reason: "not_found" };
  if (element.children.length > 0 || RAW_TEXT_TAGS.has(tag)) return { ok: false, reason: "not_text" };
  if (collapse(element.textContent ?? "") !== collapse(edit.before)) return { ok: false, reason: "changed" };

  const original = element.textContent ?? "";
  // Keep the indentation around the text the way the file had it.
  element.textContent = leadingSpace(original) + text + trailingSpace(original);
  const expected = serialize(doc, source);

  const spliced = splice(source, doc, element, tag, text);
  if (spliced !== null) {
    const check = new DOMParser().parseFromString(spliced, "text/html");
    if (serialize(check, source) === expected) return { ok: true, html: spliced, method: "splice" };
  }
  return { ok: true, html: expected, method: "serialize" };
}

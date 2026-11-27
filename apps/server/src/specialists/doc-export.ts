import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import TurndownService from "turndown";
import { marked } from "marked";
import PDFKit from "pdfkit";
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx";
import { ApiError } from "../errors.js";

export type DocExportFormat = "md" | "mdx" | "html" | "docx" | "pdf";

const MIME: Record<DocExportFormat, string> = {
  md: "text/markdown; charset=utf-8",
  mdx: "text/markdown; charset=utf-8",
  html: "text/html; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function inlineText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
}

export function docHtml(title: string, content: string): string {
  const renderer = new marked.Renderer();
  renderer.html = ({ text }) => escapeHtml(text);
  const body = marked.parse(content, { async: false, renderer });
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1e293b;--muted:#64748b;--border:#cbd5e1;--accent:#2563eb}
@media(prefers-color-scheme:dark){:root{--bg:#0f172a;--fg:#e2e8f0;--muted:#94a3b8;--border:#334155;--accent:#60a5fa}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.65 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:76ch;margin:0 auto;padding:40px 24px 80px}h1,h2,h3{line-height:1.25;letter-spacing:-.02em}h1{font-size:28px}h2{font-size:21px;margin-top:2em}h3{font-size:17px}
p,ul,ol,blockquote,pre,table{margin:1em 0}blockquote{border-left:3px solid var(--border);padding-left:1em;color:var(--muted)}
pre{overflow:auto;padding:14px;border:1px solid var(--border);border-radius:8px;background:color-mix(in srgb,var(--fg) 5%,transparent)}
code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.92em}a{color:var(--accent)}table{width:100%;border-collapse:collapse}th,td{border:1px solid var(--border);padding:7px 9px;text-align:left}img{max-width:100%;height:auto}hr{border:0;border-top:1px solid var(--border)}
</style></head><body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;
}

function docHeading(level: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  if (level <= 1) return HeadingLevel.TITLE;
  if (level === 2) return HeadingLevel.HEADING_1;
  if (level === 3) return HeadingLevel.HEADING_2;
  if (level === 4) return HeadingLevel.HEADING_3;
  return HeadingLevel.HEADING_4;
}

export async function docDocx(title: string, content: string): Promise<Buffer> {
  const children: Array<Paragraph | Table> = [];
  for (const token of marked.lexer(content)) {
    if (token.type === "heading") children.push(new Paragraph({ text: inlineText(token.text), heading: docHeading(token.depth) }));
    else if (token.type === "paragraph") children.push(new Paragraph({ text: inlineText(token.text) }));
    else if (token.type === "list") {
      for (const item of token.items) children.push(new Paragraph({ text: inlineText(item.text), bullet: { level: 0 } }));
    } else if (token.type === "code") children.push(new Paragraph({ text: token.text, style: "Code" }));
    else if (token.type === "blockquote") children.push(new Paragraph({ children: [new TextRun({ text: inlineText(token.text), italics: true })], indent: { left: 360 } }));
    else if (token.type === "table") {
      children.push(new Table({
        rows: [token.header, ...token.rows].map((row, rowIndex) => new TableRow({
          children: row.map((cell: { text: string }) => new TableCell({
            children: [new Paragraph({ text: inlineText(cell.text), ...(rowIndex === 0 ? { bold: true } : {}) })],
          })),
        })),
      }));
    } else if (token.type === "hr") children.push(new Paragraph({ text: "" }));
  }
  if (children.length === 0) children.push(new Paragraph({ text: "Documento vacío." }));
  const document = new Document({ sections: [{ properties: {}, children }] });
  return Packer.toBuffer(document);
}

export async function docPdf(title: string, content: string): Promise<Buffer> {
  const document = new PDFKit({ size: "A4", margin: 48 });
  const chunks: Buffer[] = [];
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolvePromise, reject) => {
    document.on("end", () => resolvePromise());
    document.on("error", reject);
  });
  document.font("Helvetica").fontSize(20).text(title);
  document.moveDown();
  for (const token of marked.lexer(content)) {
    if (token.type === "heading") {
      document.font("Helvetica-Bold").fontSize(Math.max(12, 19 - token.depth)).text(inlineText(token.text));
      document.moveDown(0.5);
    } else if (token.type === "paragraph") {
      document.font("Helvetica").fontSize(10).text(inlineText(token.text), { lineGap: 3 });
      document.moveDown(0.6);
    } else if (token.type === "list") {
      document.font("Helvetica").fontSize(10);
      for (const item of token.items) document.text(`• ${inlineText(item.text)}`, { indent: 12 });
      document.moveDown(0.6);
    } else if (token.type === "code") {
      document.font("Courier").fontSize(8).text(token.text, { indent: 12 });
      document.moveDown(0.6);
    } else if (token.type === "blockquote") {
      document.font("Helvetica-Oblique").fontSize(9).text(inlineText(token.text), { indent: 18 });
      document.moveDown(0.6);
    } else if (token.type === "table") {
      document.font("Helvetica").fontSize(8);
      for (const [index, row] of [token.header, ...token.rows].entries()) {
        document.font(index === 0 ? "Helvetica-Bold" : "Helvetica");
        document.text(row.map((cell: { text: string }) => inlineText(cell.text)).join(" | "));
      }
      document.moveDown(0.6);
    } else if (token.type === "hr") {
      document.moveDown();
      document.moveTo(48, document.y).lineTo(547, document.y).stroke();
      document.moveDown();
    }
    if (document.y > 760) document.addPage();
  }
  document.end();
  await done;
  return Buffer.concat(chunks);
}

export async function exportDoc(directory: string, title: string, content: string, format: DocExportFormat): Promise<{ bytes: Buffer; mime: string; extension: string }> {
  if (format === "md" || format === "mdx") return { bytes: Buffer.from(content, "utf8"), mime: MIME[format], extension: format };
  if (format === "html") return { bytes: Buffer.from(docHtml(title, content), "utf8"), mime: MIME.html, extension: "html" };
  if (format === "docx") return { bytes: await docDocx(title, content), mime: MIME.docx, extension: "docx" };
  return { bytes: await docPdf(title, content), mime: MIME.pdf, extension: "pdf" };
}

export function safeDocFileName(title: string, extension: string): string {
  const stem = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "documento";
  return `${stem}.${extension}`;
}

/** Save an export inside the project. Symlinks cannot redirect the write outside the workspace. */
export async function saveDocExport(directory: string, path: string, bytes: Buffer): Promise<string> {
  const relativePath = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!relativePath || relativePath.startsWith("/") || relativePath.includes("..") || relativePath.startsWith(".opencode/")) {
    throw new ApiError(422, "invalid_doc_export_path", "La ruta de exportación debe ser relativa al proyecto, sin .. ni .opencode/.");
  }
  const root = await realpath(resolve(directory));
  const target = resolve(root, relativePath);
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new ApiError(422, "invalid_doc_export_path", "La ruta de exportación sale del proyecto.");
  await mkdir(dirname(target), { recursive: true });
  const realParent = await realpath(dirname(target));
  const parentRel = relative(root, realParent);
  if (parentRel.startsWith("..") || isAbsolute(parentRel)) throw new ApiError(422, "invalid_doc_export_path", "La ruta de exportación sale del proyecto por un enlace simbólico.");
  await writeFile(target, bytes, { mode: 0o600 });
  return relativePath;
}

export async function readDocImportFile(directory: string, path: string): Promise<{ content: string; format: "md" | "mdx" }> {
  const relativePath = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!relativePath || relativePath.startsWith("/") || relativePath.includes("..") || relativePath.startsWith(".opencode/")) {
    throw new ApiError(422, "invalid_doc_import_path", "La ruta de importación debe ser relativa al proyecto, sin .. ni .opencode/.");
  }
  const root = await realpath(resolve(directory));
  const target = resolve(root, relativePath);
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new ApiError(422, "invalid_doc_import_path", "La ruta de importación sale del proyecto.");
  const realTarget = await realpath(target).catch(() => null);
  if (!realTarget) throw new ApiError(404, "doc_import_not_found", "Ese archivo no existe en el proyecto.");
  const realRel = relative(root, realTarget);
  if (realRel.startsWith("..") || isAbsolute(realRel)) throw new ApiError(422, "invalid_doc_import_path", "La ruta de importación sale del proyecto por un enlace simbólico.");
  const extension = (realTarget.split(".").pop() ?? "").toLowerCase();
  if (!["md", "mdx", "txt", "html", "htm"].includes(extension)) throw new ApiError(422, "invalid_doc_import_format", "Importá un archivo .md, .mdx, .txt o .html; Word/PDF requieren convertirlo antes.");
  const raw = await readFile(realTarget, "utf8");
  if (Buffer.byteLength(raw) > 300 * 1024) throw new ApiError(422, "doc_import_too_big", "El archivo supera 300 KB.");
  if (extension === "html" || extension === "htm") {
    const markdown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" }).turndown(raw);
    return { content: markdown, format: "md" };
  }
  return { content: raw, format: extension === "mdx" ? "mdx" : "md" };
}

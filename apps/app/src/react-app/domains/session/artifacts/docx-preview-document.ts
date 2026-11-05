import DOMPurify from "dompurify";
import { listZipEntries, readZipEntryData, readZipTextEntry, zipEntryMap } from "@openwork/workbook";

export const DOCX_PREVIEW_CSP = "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

/** Validate actual inflated sizes before handing any bytes to the renderer.
 * Word HTML fragments and external relationships never become active content. */
export async function docxPreviewDocument(data: ArrayBuffer): Promise<{ html: string; pageWidth: number }> {
  const bytes = new Uint8Array(data);
  const entries = listZipEntries(bytes);
  const map = zipEntryMap(entries);
  if (!map.has("word/document.xml") || entries.some(entry => /vbaProject|^_xmlsignatures\//i.test(entry.name))) {
    throw new Error("El archivo no es un DOCX compatible o contiene macros o firmas.");
  }
  for (const entry of entries) {
    if (/\.(xml|rels)$/i.test(entry.name)) await readZipTextEntry(bytes, map, entry.name);
    else await readZipEntryData(bytes, entry);
  }
  const { renderAsync } = await import("docx-preview");
  const body = document.createElement("div");
  const styles = document.createElement("div");
  await renderAsync(data, body, styles, {
    useBase64URL: true,
    renderAltChunks: false,
    renderComments: false,
    ignoreLastRenderedPageBreak: false,
    breakPages: true,
    ignoreFonts: true,
  });
  for (const anchor of body.querySelectorAll("a")) anchor.removeAttribute("href");
  const firstPage = body.querySelector<HTMLElement>("section.docx");
  const width = firstPage?.style.width ?? "595.3pt";
  const factors: Record<string, number> = { pt: 96 / 72, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, px: 1 };
  const unit = width.match(/[a-z]+$/i)?.[0] ?? "pt";
  const pageWidth = Number.parseFloat(width) * (factors[unit] ?? 1) + 32;
  const content = DOMPurify.sanitize(styles.innerHTML + body.innerHTML, {
    ADD_TAGS: ["style"],
    FORCE_BODY: true,
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "link", "meta", "base"],
    FORBID_ATTR: ["srcset"],
  });
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${DOCX_PREVIEW_CSP}"><style>html{color-scheme:light}body{margin:0;background:#e8e8e8;color:#242424} .docx-wrapper{background:transparent!important;padding:16px!important}section.docx{background:#fff!important;color:#242424;box-shadow:0 1px 6px #0002!important;margin-bottom:16px!important}</style></head><body>${content}</body></html>`;
  return { html, pageWidth: Number.isFinite(pageWidth) && pageWidth > 0 ? pageWidth : 826 };
}

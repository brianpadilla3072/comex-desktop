import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { zipSync, type Zippable } from "fflate";
import { DESIGN_LIMITS, type DesignManifest } from "@openwork/types/designs";
import { ApiError } from "../errors.js";
import { designDir, designFiles, readManifest } from "./store.js";

/**
 * "Exportar HTML": the design folder as a zip, under one top folder named after the design, plus
 * an `index.html` that lists the pages. Pages keep their relative references, so the export opens
 * offline in any browser. Hidden files and links are left out.
 */

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char] ?? char);

export function htmlIndex(manifest: DesignManifest): string {
  const items = manifest.pages.map(page => `<li><a href="${escapeHtml(encodeURI(page.file))}">${escapeHtml(page.title || page.id)}</a></li>`).join("\n");
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>${escapeHtml(manifest.title)}</title>
<style>body{font-family:system-ui,sans-serif;margin:48px;color:#111827}li{margin:8px 0}a{color:#1d4ed8}</style></head>
<body>
<h1>${escapeHtml(manifest.title)}</h1>
<ol>
${items}
</ol>
</body>
</html>
`;
}

export async function designHtmlArchive(projectRoot: string, designId: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; fileName: string }> {
  const manifest = await readManifest(projectRoot, designId);
  const dir = await designDir(projectRoot, designId);
  const entries: Zippable = {};
  let total = 0;
  for (const file of await designFiles(dir)) {
    const info = await lstat(join(dir, file)).catch(() => null);
    if (!info?.isFile()) continue;
    total += info.size;
    if (total > DESIGN_LIMITS.designBytes) throw new ApiError(413, "design_capacity_bytes", "El diseño supera el espacio permitido para exportarlo.");
    entries[`${manifest.id}/${file}`] = new Uint8Array(await readFile(join(dir, file)));
  }
  if (!entries[`${manifest.id}/index.html`]) entries[`${manifest.id}/index.html`] = new TextEncoder().encode(htmlIndex(manifest));
  return { bytes: zipSync(entries, { level: 6 }), fileName: `${manifest.id}.zip` };
}

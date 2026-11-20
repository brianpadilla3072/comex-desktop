import { designRelativePathSchema } from "@openwork/types/designs";

/**
 * Turns a page document of a design into one self-contained HTML string for the exports:
 * the shared stylesheet and every asset the page references inside the design folder are
 * inlined (`<style>` and `data:` URLs), and a strict Content-Security-Policy is added so the
 * exported document can never reach the network. References that leave the design folder or
 * point to missing files are left as they are (and the CSP blocks them).
 */

export const EXPORT_CSP = "default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data:; style-src 'unsafe-inline' data:; script-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", avif: "image/avif",
  ico: "image/x-icon", css: "text/css", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", mp4: "video/mp4", webm: "video/webm",
};

export function mimeForPath(path: string): string | null {
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? null;
}

/** Resolves `reference` against the folder of `fromFile`; null when it is not a file inside the design. */
export function resolveDesignReference(fromFile: string, reference: string): string | null {
  const value = reference.trim().replace(/[?#].*$/, "");
  if (!value || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//") || value.startsWith("/")) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return null; }
  const parts = fromFile.split("/").slice(0, -1);
  for (const segment of decoded.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (!parts.length) return null;
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  const resolved = parts.join("/");
  return designRelativePathSchema.safeParse(resolved).success ? resolved : null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return btoa(binary);
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

export type DesignFileReader = (path: string) => Promise<Blob>;

const URL_PATTERN = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
const ATTRIBUTE_PATTERN = /(\s)(src|poster|xlink:href|href)\s*=\s*(["'])([^"']*)\3/gi;
const STYLESHEET_PATTERN = /<link\b[^>]*>/gi;
const INLINEABLE_HREF = /\.(png|jpe?g|gif|webp|svg|avif|woff2?|ttf|otf)$/i;

async function replaceAsync(text: string, pattern: RegExp, replace: (match: RegExpExecArray) => Promise<string>): Promise<string> {
  const matches: RegExpExecArray[] = [];
  pattern.lastIndex = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    matches.push(match);
    if (match[0] === "") pattern.lastIndex++;
  }
  const replacements = await Promise.all(matches.map(replace));
  let result = "";
  let cursor = 0;
  matches.forEach((match, index) => {
    result += text.slice(cursor, match.index) + replacements[index];
    cursor = match.index + match[0].length;
  });
  return result + text.slice(cursor);
}

function escapeStyleText(css: string): string {
  return css.replace(/<\/style/gi, "<\\/style");
}

export function withExportCsp(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${EXPORT_CSP}">`;
  const head = /<head\b[^>]*>/i.exec(html);
  if (head) return `${html.slice(0, head.index + head[0].length)}${meta}${html.slice(head.index + head[0].length)}`;
  const htmlTag = /<html\b[^>]*>/i.exec(html);
  if (htmlTag) return `${html.slice(0, htmlTag.index + htmlTag[0].length)}<head>${meta}</head>${html.slice(htmlTag.index + htmlTag[0].length)}`;
  return `<!doctype html><html><head>${meta}</head><body>${html}</body></html>`;
}

/** Inlines assets of `html` (the document at `pageFile`) and adds the export CSP. */
export async function selfContainedPageHtml(html: string, pageFile: string, readFile: DesignFileReader): Promise<string> {
  const cache = new Map<string, Promise<string | null>>();
  const dataUrl = (path: string) => {
    let pending = cache.get(path);
    if (!pending) {
      const mime = mimeForPath(path);
      pending = mime
        ? readFile(path).then(async blob => `data:${mime};base64,${await blobToBase64(blob)}`, () => null)
        : Promise.resolve(null);
      cache.set(path, pending);
    }
    return pending;
  };
  const inlineCssUrls = (css: string, cssFile: string) => replaceAsync(css, URL_PATTERN, async match => {
    const resolved = resolveDesignReference(cssFile, match[2]);
    const inlined = resolved ? await dataUrl(resolved) : null;
    return inlined ? `url("${inlined}")` : match[0];
  });

  let output = await replaceAsync(html, STYLESHEET_PATTERN, async match => {
    const tag = match[0];
    if (!/\brel\s*=\s*["']?stylesheet/i.test(tag)) return tag;
    const href = /\bhref\s*=\s*(["'])([^"']*)\1/i.exec(tag)?.[2];
    const resolved = href ? resolveDesignReference(pageFile, href) : null;
    if (!resolved) return tag;
    try {
      const css = await (await readFile(resolved)).text();
      return `<style data-ow-inlined="${resolved}">${escapeStyleText(await inlineCssUrls(css, resolved))}</style>`;
    } catch {
      return "";
    }
  });
  output = await replaceAsync(output, ATTRIBUTE_PATTERN, async match => {
    const [whole, space, name, quote, value] = match;
    if (name.toLowerCase() === "href" && !INLINEABLE_HREF.test(value.replace(/[?#].*$/, ""))) return whole;
    const resolved = resolveDesignReference(pageFile, value);
    const inlined = resolved ? await dataUrl(resolved) : null;
    return inlined ? `${space}${name}=${quote}${inlined}${quote}` : whole;
  });
  output = await inlineCssUrls(output, pageFile);
  return withExportCsp(output);
}

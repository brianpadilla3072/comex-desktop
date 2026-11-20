import { resolveDesignReference } from "@/app/lib/designs";

/**
 * Turn one page document of a design into something a sandboxed iframe can show with no network:
 * every relative reference (`../assets/logo.svg`, `../styles.css`, `url(../assets/bg.png)`) is
 * read from the design folder through the server and replaced by a blob URL (images) or a data
 * URL (fonts, as the policy only allows embedded fonts); linked stylesheets are inlined;
 * anything absolute (http, //cdn, file:) is dropped; event handler attributes are removed; and
 * the same Content-Security-Policy the server sends is added as the first <meta> of <head>.
 */

export const DESIGN_FRAME_CSP = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:";

/** Reads one file of the design folder (a path relative to it). */
export type DesignFileReader = (path: string) => Promise<Blob>;

/**
 * Only head-level elements that change how the document loads are removed. The body keeps its
 * structure exactly as in the source file (the comment/edit picker matches selectors against it):
 * scripts, frames and objects stay but are inert (no `allow-scripts`, and the policy blocks
 * every frame, object and script source).
 */
const REMOVED = "base, meta[http-equiv]";
const URL_ATTRIBUTES = ["src", "href", "xlink:href", "poster", "data", "background"];
const CSS_URL = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;
const CSS_IMPORT = /@import\s+[^;]+;?/gi;
const FONT = /\.(woff2?|ttf|otf|eot)$/i;

const isEmbedded = (value: string) => /^(data|blob):/i.test(value.trim());

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

export type BuiltFrame = { html: string; urls: string[] };

export async function buildFrameDocument(html: string, pageFile: string, read: DesignFileReader, makeUrl: (blob: Blob) => string = blob => URL.createObjectURL(blob)): Promise<BuiltFrame> {
  const urls: string[] = [];
  const cache = new Map<string, Promise<string | null>>();

  /** A design path as a URL the frame may load, or null when it cannot be read. */
  const asset = (path: string): Promise<string | null> => {
    const cached = cache.get(path);
    if (cached) return cached;
    const next = read(path).then(async blob => {
      if (FONT.test(path)) return blobToDataUrl(blob);
      const url = makeUrl(blob);
      urls.push(url);
      return url;
    }).catch(() => null);
    cache.set(path, next);
    return next;
  };

  /** A reference from `fromFile` as a frame URL; "" drops it (absolute, outside, unreadable). */
  const reference = async (fromFile: string, value: string): Promise<string> => {
    if (isEmbedded(value) && !/^data:text\/html/i.test(value.trim())) return value.trim();
    if (value.trim().startsWith("#")) return value.trim();
    const path = resolveDesignReference(fromFile, value);
    if (!path) return "";
    return (await asset(path)) ?? "";
  };

  const rewriteCss = async (css: string, fromFile: string): Promise<string> => {
    const withoutImports = css.replace(CSS_IMPORT, "");
    const matches = [...withoutImports.matchAll(CSS_URL)];
    const replacements = await Promise.all(matches.map(match => reference(fromFile, match[2] ?? "")));
    let index = 0;
    return withoutImports.replace(CSS_URL, () => {
      const url = replacements[index++] ?? "";
      return url ? `url("${url.replace(/"/g, "%22")}")` : "none";
    });
  };

  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const element of [...doc.querySelectorAll(REMOVED)]) element.remove();

  // Linked stylesheets become inline <style> with their own references rewritten.
  for (const link of [...doc.querySelectorAll("link")]) {
    const rel = (link.getAttribute("rel") ?? "").toLowerCase();
    const href = link.getAttribute("href") ?? "";
    const path = rel.split(/\s+/).includes("stylesheet") ? resolveDesignReference(pageFile, href) : null;
    if (path) {
      const css = await read(path).then(blob => blob.text()).catch(() => null);
      if (css !== null) {
        const style = doc.createElement("style");
        style.textContent = await rewriteCss(css, path);
        link.replaceWith(style);
        continue;
      }
    }
    link.remove();
  }

  for (const style of [...doc.querySelectorAll("style")]) style.textContent = await rewriteCss(style.textContent ?? "", pageFile);

  for (const element of [...doc.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "srcdoc" || name === "formaction" || name === "ping") { element.removeAttribute(attribute.name); continue; }
      if (name === "style") { element.setAttribute(attribute.name, await rewriteCss(attribute.value, pageFile)); continue; }
      if (name === "srcset") {
        const candidates = await Promise.all(attribute.value.split(",").map(async candidate => {
          const [url = "", ...descriptor] = candidate.trim().split(/\s+/);
          const next = await reference(pageFile, url);
          return next ? [next, ...descriptor].join(" ") : "";
        }));
        const kept = candidates.filter(Boolean).join(", ");
        if (kept) element.setAttribute(attribute.name, kept); else element.removeAttribute(attribute.name);
        continue;
      }
      if (!URL_ATTRIBUTES.includes(name)) continue;
      // Links inside the page never navigate the frame anywhere.
      if (element.tagName.toLowerCase() === "a" && name === "href") { element.removeAttribute(attribute.name); continue; }
      const next = await reference(pageFile, attribute.value);
      if (next) element.setAttribute(attribute.name, next); else element.removeAttribute(attribute.name);
    }
  }

  const head = doc.head ?? doc.documentElement.insertBefore(doc.createElement("head"), doc.body);
  const policy = doc.createElement("meta");
  policy.setAttribute("http-equiv", "Content-Security-Policy");
  policy.setAttribute("content", DESIGN_FRAME_CSP);
  head.insertBefore(policy, head.firstChild);

  return { html: `<!doctype html>\n${doc.documentElement.outerHTML}`, urls };
}

/** The scale that fits a page inside a box, never above 1 unless asked. */
export function fitScale(box: { width: number; height: number }, page: { width: number; height: number }, allowUpscale = false): number {
  if (box.width <= 0 || box.height <= 0 || page.width <= 0 || page.height <= 0) return 0;
  const scale = Math.min(box.width / page.width, box.height / page.height);
  return allowUpscale ? scale : Math.min(1, scale);
}

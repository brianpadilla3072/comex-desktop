import type { Board, DesignKind, DesignTokens } from "@openwork/types/designs";
import { pageSize } from "./core.js";

/**
 * What a new design starts with, per kind. Neutral sample content only: the agent replaces it.
 * Every page is a self-contained HTML document with inline styles and no external reference.
 */

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char] ?? char);

function documentShell(title: string, width: number, height: number, style: string, body: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  html, body { margin: 0; padding: 0; }
  body { width: ${width}px; height: ${height}px; overflow: hidden; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #111827; background: #ffffff; }
${style}
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

/** A blank page of the kind's size, used by "add page" without HTML. */
export function blankPageHtml(kind: DesignKind, title: string): string {
  const { width, height } = pageSize(kind);
  return documentShell(title, width, height, "", "");
}

export function firstPageHtml(kind: DesignKind, title: string): string {
  const { width, height } = pageSize(kind);
  const safe = escapeHtml(title);
  if (kind === "slides") {
    return documentShell(title, width, height, `  .slide { box-sizing: border-box; width: 100%; height: 100%; padding: 160px; display: flex; flex-direction: column; justify-content: center; gap: 32px; }
  .slide h1 { margin: 0; font-size: 104px; line-height: 1.05; font-weight: 700; letter-spacing: -0.02em; }
  .slide p { margin: 0; font-size: 40px; color: #4b5563; }`,
    `<section class="slide">
  <h1>${safe}</h1>
  <p>Subtítulo de la presentación</p>
</section>`);
  }
  if (kind === "mockup") {
    return documentShell(title, width, height, `  header { height: 72px; display: flex; align-items: center; justify-content: space-between; padding: 0 48px; border-bottom: 1px solid #e5e7eb; }
  header strong { font-size: 20px; }
  nav { display: flex; gap: 24px; font-size: 16px; color: #4b5563; }
  main { padding: 96px 48px; display: grid; gap: 24px; max-width: 880px; }
  main h1 { margin: 0; font-size: 56px; line-height: 1.1; }
  main p { margin: 0; font-size: 20px; color: #4b5563; }
  .cta { justify-self: start; padding: 14px 24px; border-radius: 10px; background: #111827; color: #ffffff; font-size: 16px; }`,
    `<header><strong>${safe}</strong><nav><span>Inicio</span><span>Servicios</span><span>Contacto</span></nav></header>
<main>
  <h1>Pantalla principal</h1>
  <p>Describe aquí el objetivo de esta pantalla.</p>
  <span class="cta">Acción principal</span>
</main>`);
  }
  if (kind === "system") {
    const tokens = systemTokens();
    const swatches = tokens.colors.map(color => `<li><span class="swatch" style="background:${escapeHtml(color.value)}"></span><strong>${escapeHtml(color.name)}</strong><code>${escapeHtml(color.value)}</code></li>`).join("\n    ");
    return documentShell(title, width, height, `  main { padding: 72px; display: grid; gap: 40px; }
  h1 { margin: 0; font-size: 48px; }
  p { margin: 0; font-size: 18px; color: #4b5563; max-width: 760px; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; gap: 24px; }
  li { display: grid; gap: 8px; font-size: 14px; }
  .swatch { display: block; width: 120px; height: 80px; border-radius: 12px; border: 1px solid #e5e7eb; }
  code { color: #6b7280; }`,
    `<main>
  <h1>${safe}</h1>
  <p>${escapeHtml(tokens.overview)}</p>
  <ul>
    ${swatches}
  </ul>
</main>`);
  }
  // Board: the canvas lives in board.json; this page is its static backdrop.
  return documentShell(title, width, height, "  body { background: #f9fafb; }", "");
}

export function systemTokens(): DesignTokens {
  return {
    format: "openwork.design-tokens", version: 1,
    overview: "Sistema de diseño inicial: colores, tipografía y espaciado de base. Ajústalo a tu marca.",
    content: "Tono claro y directo. Frases cortas, tuteo, sin jerga innecesaria.",
    colors: [
      { name: "Primario", value: "#1E3A8A", role: "primary" },
      { name: "Acento", value: "#0EA5E9", role: "accent" },
      { name: "Texto", value: "#111827", role: "foreground" },
      { name: "Fondo", value: "#FFFFFF", role: "background" },
    ],
    typography: [
      { name: "Título", family: "system-ui, sans-serif", size: "48px", weight: 700, lineHeight: "1.1", sample: "Título principal" },
      { name: "Cuerpo", family: "system-ui, sans-serif", size: "16px", weight: 400, lineHeight: "1.5", sample: "Texto de párrafo" },
    ],
    spacing: [{ name: "S", value: "8px" }, { name: "M", value: "16px" }, { name: "L", value: "32px" }],
    radii: [{ name: "Base", value: "8px" }],
    shadows: [{ name: "Suave", value: "0 1px 3px rgba(0,0,0,0.12)" }],
    gradients: [],
    layout: [{ name: "Ancho máximo", value: "1200px" }],
    components: [],
    assets: [],
  };
}

export function boardTemplate(): Board {
  return {
    format: "openwork.board", version: 1,
    elements: [{ id: "frame-1", type: "frame", title: "Marco 1", x: 200, y: 200, width: 1200, height: 800, rotation: 0, style: {}, frameId: null }],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

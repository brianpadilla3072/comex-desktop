import { DESIGN_LIMITS, DESIGN_PAGE_SIZES, type DesignManifest } from "@openwork/types/designs";
import { designAgentPath, designForSession, readManifest } from "./store.js";

/**
 * What the agent must know when a chat works on a design: where it lives, the file format and
 * the rules every page follows. The server adds it as its own engine instruction entry (the same
 * channel as the project's instructions), only for sessions bound to a design
 * (`POST /designs/:ws/:id/chats`). Material, not authority: it never changes permissions.
 */

/**
 * Brand context of the design system a design follows (`systemId`). The design-system part
 * (`apps/server/src/designs/system-context.ts`) provides it; the server wires it at startup with
 * `configureDesignSystemContext`. Until then a short pointer to `tokens.json` is used.
 */
export type DesignSystemContextProvider = (projectRoot: string, systemId: string) => Promise<string | null>;

// Owner: the server process; set once at startup (or by tests), read on every bound prompt.
let systemContextProvider: DesignSystemContextProvider | null = null;
export function configureDesignSystemContext(provider: DesignSystemContextProvider | null) { systemContextProvider = provider; }

const KIND_LABEL: Record<DesignManifest["kind"], string> = {
  slides: "una presentación de diapositivas",
  mockup: "un diseño de pantallas (mockup)",
  system: "un sistema de diseño",
  board: "una pizarra",
};

export function designGuidanceText(manifest: DesignManifest, folder: string, systemFolder: string | null): string {
  const size = DESIGN_PAGE_SIZES[manifest.kind];
  const pages = manifest.pages.map(page => `${page.id} "${page.title}" → ${folder}/${page.file}`).join("; ");
  const parts = [
    `Esta conversación trabaja en ${KIND_LABEL[manifest.kind]} llamado ${JSON.stringify(manifest.title)}, guardado como archivos locales en ${folder}/. Edítalo con tus herramientas de archivos.`,
    `Formato: ${folder}/design.json es el manifiesto (format "openwork.design", version 1) con la lista ordenada de páginas {id, title, file, width, height, notes?}; cada página es un documento HTML completo y autocontenido en ${folder}/pages/<id>.html; estilos compartidos opcionales en ${folder}/styles.css (enlazados desde la página como "../styles.css"); imágenes, logos e ilustraciones en ${folder}/assets/ (referenciados como "../assets/<archivo>").`,
    `Páginas actuales: ${pages || "ninguna"}.`,
    `Reglas: cada página mide ${size.width}×${size.height} px (fija ese tamaño en el body); solo rutas relativas a la carpeta del diseño; nada de red (sin URLs http/https, CDNs, fuentes web externas ni scripts: la página se muestra en un marco aislado sin JavaScript y sin conexión); usa estilos en línea o en <style>; las ilustraciones y los íconos van como SVG escrito por ti (en línea o en assets/), nunca generados por servicios externos; textos de ejemplo neutrales.`,
    `Para agregar o quitar páginas actualiza design.json (id único "p-<n>", file "pages/<id>.html", width ${size.width}, height ${size.height}) y crea o borra el archivo; respeta los límites de ${DESIGN_LIMITS.pages} páginas y ${Math.round(DESIGN_LIMITS.pageBytes / 1024 / 1024)} MB por página. No toques otros diseños salvo que la persona lo pida.`,
  ];
  if (manifest.kind === "board") parts.push(`La pizarra vive en ${folder}/board.json (format "openwork.board", version 1: elements frame/rect/ellipse/text/sticky/path/image con x, y, width, height; viewport). Las imágenes de la pizarra van en assets/.`);
  if (manifest.kind === "system") parts.push(`Los tokens viven en ${folder}/tokens.json (format "openwork.design-tokens", version 1: overview, content, colors, typography, spacing, radii, shadows, gradients, layout, components, assets). Mantén las páginas de muestra coherentes con los tokens.`);
  if (systemFolder) parts.push(`Este diseño sigue el sistema de diseño del proyecto en ${systemFolder}/ (tokens en ${systemFolder}/tokens.json): usa sus colores, tipografías, espaciados, radios y recursos.`);
  return parts.join(" ");
}

/** The instruction entry for a session, or null when it is not bound to a (valid) design. */
export async function designAgentInstructions(projectRoot: string, sessionId: string): Promise<string | null> {
  const designId = await designForSession(projectRoot, sessionId).catch(() => null);
  if (!designId) return null;
  const manifest = await readManifest(projectRoot, designId).catch(() => null);
  if (!manifest) return null;
  const systemId = manifest.systemId && manifest.systemId !== manifest.id ? manifest.systemId : null;
  const system = systemId ? await readManifest(projectRoot, systemId).catch(() => null) : null;
  const followed = system?.kind === "system" ? system : null;
  const text = designGuidanceText(manifest, designAgentPath(projectRoot, manifest.id), followed ? designAgentPath(projectRoot, followed.id) : null);
  const brand = followed && systemContextProvider ? await systemContextProvider(projectRoot, followed.id).catch(() => null) : null;
  return brand ? `${text} ${brand}` : text;
}

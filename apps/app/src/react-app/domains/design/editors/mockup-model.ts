import { designManifestSchema, DESIGN_LIMITS, type DesignManifest, type DesignPage } from "@openwork/types/designs";

/**
 * Pure helpers of the screens editor (designs of kind "mockup"). A screen is a page of the design
 * (`pages/<id>.html`); the width toggle re-renders the same document at another viewport width.
 */

export type MockupWidthId = "desktop" | "tablet" | "phone";
export const MOCKUP_WIDTHS: ReadonlyArray<{ id: MockupWidthId; width: number; height: number }> = [
  { id: "desktop", width: 1440, height: 900 },
  { id: "tablet", width: 834, height: 1194 },
  { id: "phone", width: 390, height: 844 },
];

export function mockupWidth(id: MockupWidthId) {
  return MOCKUP_WIDTHS.find(entry => entry.id === id) ?? { id: "desktop" as const, width: 1440, height: 900 };
}

/** The preset closest to a page's own width (a page made for phones opens as phone). */
export function presetForPage(page: Pick<DesignPage, "width"> | undefined): MockupWidthId {
  if (!page) return "desktop";
  let best: MockupWidthId = "desktop";
  let distance = Infinity;
  for (const entry of MOCKUP_WIDTHS) {
    const d = Math.abs(entry.width - page.width);
    if (d < distance) {
      distance = d;
      best = entry.id;
    }
  }
  return best;
}

/** The page as rendered at a preset width; the desktop preset keeps the page's own height. */
export function pageAtWidth(page: DesignPage, id: MockupWidthId): DesignPage {
  const preset = mockupWidth(id);
  const height = id === "desktop" && presetForPage(page) === "desktop" ? page.height : preset.height;
  return { ...page, width: preset.width, height };
}

export const MOCKUP_ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2];

/** Scale that fits `width` × `height` inside the available box (never above 1). */
export function fitScale(available: { width: number; height: number }, page: { width: number; height: number }, padding = 32): number {
  const w = Math.max(1, available.width - padding * 2);
  const h = Math.max(1, available.height - padding * 2);
  return Math.max(0.05, Math.min(1, w / page.width, h / page.height));
}

/** Width-only fit, for a scrolling canvas where tall screens scroll vertically. */
export function fitWidthScale(availableWidth: number, pageWidth: number, padding = 32): number {
  return Math.max(0.05, Math.min(1, Math.max(1, availableWidth - padding * 2) / pageWidth));
}

export function nextZoom(current: number, direction: 1 | -1): number {
  if (direction > 0) return MOCKUP_ZOOM_STEPS.find(step => step > current + 0.001) ?? MOCKUP_ZOOM_STEPS[MOCKUP_ZOOM_STEPS.length - 1] ?? current;
  return [...MOCKUP_ZOOM_STEPS].reverse().find(step => step < current - 0.001) ?? MOCKUP_ZOOM_STEPS[0] ?? current;
}

/** Page ids with `pageId` moved by `delta` positions (clamped); unchanged when it cannot move. */
export function movePageId(pageIds: string[], pageId: string, delta: number): string[] {
  const from = pageIds.indexOf(pageId);
  if (from < 0) return pageIds;
  const to = Math.max(0, Math.min(pageIds.length - 1, from + delta));
  if (to === from) return pageIds;
  const next = [...pageIds];
  next.splice(from, 1);
  next.splice(to, 0, pageId);
  return next;
}

/** The manifest with one page renamed (validated), used when the server has no page-rename route. */
export function renamePage(design: DesignManifest, pageId: string, title: string, now = Date.now()): DesignManifest | null {
  const clean = title.trim().slice(0, DESIGN_LIMITS.titleChars);
  if (!clean || !design.pages.some(page => page.id === pageId)) return null;
  const next = { ...design, updatedAt: now, pages: design.pages.map(page => (page.id === pageId ? { ...page, title: clean } : page)) };
  const parsed = designManifestSchema.safeParse(next);
  return parsed.success ? parsed.data : null;
}

/** `{ design }` from a server reply, when it carries a valid manifest. */
/** Reads a reply that is either the manifest itself (the server client unwraps it) or `{ design }`. */
export function designFromReply(reply: unknown): DesignManifest | null {
  const direct = designManifestSchema.safeParse(reply);
  if (direct.success) return direct.data;
  if (typeof reply !== "object" || reply === null || !("design" in reply)) return null;
  const parsed = designManifestSchema.safeParse(reply.design);
  return parsed.success ? parsed.data : null;
}

export function canAddPage(design: DesignManifest): boolean {
  return design.pages.length < DESIGN_LIMITS.pages;
}

/** Model-facing context for "Pedir al agente" in the screens editor. */
export function mockupAgentContext(design: Pick<DesignManifest, "id" | "title" | "pages">, current: DesignPage | null, width: MockupWidthId): string {
  const preset = mockupWidth(width);
  const lines = [
    `Screen mockups "${design.title}" in proyecto/diseno/${design.id}/ (design.json lists ${design.pages.length} screens in order).`,
    current ? `Current screen: "${current.title}" (${current.id}), file ${current.file}, viewed at ${preset.width}px wide (${width}).` : "No screen selected.",
    "Each screen is one self-contained HTML document in pages/. Use relative paths only (../styles.css, ../assets/...), no network, no scripts that fetch.",
    "Make layouts responsive so they work at 1440px (desktop), 834px (tablet) and 390px (phone).",
    "To add a screen, create pages/<id>.html and add it to design.json pages (id, title, file, width, height).",
  ];
  return lines.join("\n");
}

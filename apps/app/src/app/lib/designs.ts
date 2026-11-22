import { z } from "zod";
import { t } from "@/i18n";
import {
  designManifestSchema, designSummarySchema,
  type DesignKind, type DesignManifest, type DesignPage,
} from "@openwork/types/designs";

/**
 * Client side of the design studio (feature `designStudio`, docs/features/design-studio). The
 * format schemas are the server's own (`@openwork/types/designs`); every client method in
 * `openwork-server.ts` parses its response with one of the schemas below.
 */

export * from "@openwork/types/designs";

export const designListSchema = z.object({ designs: z.array(designSummarySchema), writable: z.boolean() });
export type DesignList = z.infer<typeof designListSchema>;
export const designDetailSchema = z.object({ design: designManifestSchema, writable: z.boolean(), revision: z.number().int().nonnegative().default(0) });
export type DesignDetail = z.infer<typeof designDetailSchema>;
export const designResponseSchema = z.object({ design: designManifestSchema });
export const designWriteResponseSchema = z.object({ ok: z.literal(true), design: designManifestSchema });
export const designDeleteResponseSchema = z.object({ ok: z.literal(true) });
export const designChatsSchema = z.object({ sessions: z.array(z.string()) });

export type DesignCreateInput = { workspaceId: string; kind: DesignKind; title: string };
export type DesignPatchInput = { title?: string; systemId?: string | null };
export type DesignPageInput = { title?: string; afterPageId?: string; html?: string };
export type DesignPagePatchInput = { title?: string; notes?: string | null };

/** Page paths of the design studio (the API lives under `/designs`). */
export const DESIGN_ROUTE = "/design";
export const designPageRoute = (workspaceId: string, designId: string) => `${DESIGN_ROUTE}/${encodeURIComponent(workspaceId)}/${encodeURIComponent(designId)}`;

/** `/design` or a design page: the "Diseño" entry is the current destination. */
export const isDesignPath = (pathname: string) => pathname === DESIGN_ROUTE || pathname.startsWith(`${DESIGN_ROUTE}/`);

/** The design shown at `/design/<workspaceId>/<designId>`, or null on any other path. */
export function designRouteFromPath(pathname: string): { workspaceId: string; designId: string } | null {
  const match = /^\/design\/([^/]+)\/([^/]+)\/?$/.exec(pathname);
  if (!match?.[1] || !match[2]) return null;
  try { return { workspaceId: decodeURIComponent(match[1]), designId: decodeURIComponent(match[2]) }; } catch { return null; }
}

export function designKindLabel(kind: DesignKind): string {
  if (kind === "slides") return t("design_ui.studio.kind_slides");
  if (kind === "mockup") return t("design_ui.studio.kind_mockup");
  if (kind === "system") return t("design_ui.studio.kind_system");
  return t("design_ui.studio.kind_board");
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "Ahora", "hace 5 minutos", "hace 3 horas", "hace 2 días", then a short date. */
export function formatDesignTime(timestamp: number, now: number, locale = "es"): string {
  const delta = Math.max(0, now - timestamp);
  if (delta < MINUTE) return t("design_ui.studio.time_now");
  if (delta < HOUR) return t("design_ui.studio.time_minutes", { count: Math.floor(delta / MINUTE) });
  if (delta < DAY) return t("design_ui.studio.time_hours", { count: Math.floor(delta / HOUR) });
  if (delta < 7 * DAY) return t("design_ui.studio.time_days", { count: Math.floor(delta / DAY) });
  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" }).format(date);
}

/** The first page of a design (its cover / thumbnail source), or null for an empty one. */
export const firstDesignPage = (design: Pick<DesignManifest, "pages">): DesignPage | null => design.pages[0] ?? null;

/**
 * A relative reference inside a page (`../assets/logo.svg` from `pages/p-1.html`) as a path
 * inside the design folder, or null when it leaves the folder, is absolute or uses a scheme.
 */
export function resolveDesignReference(fromFile: string, reference: string): string | null {
  const ref = reference.trim();
  if (!ref || ref.startsWith("#") || ref.startsWith("/") || ref.startsWith("\\") || /^[a-z][a-z0-9+.-]*:/i.test(ref)) return null;
  const clean = ref.split(/[?#]/)[0] ?? "";
  if (!clean) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(clean); } catch { return null; }
  const parts = fromFile.split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") { if (!parts.length) return null; parts.pop(); continue; }
    if (part.startsWith(".") || part.includes("\\")) return null;
    parts.push(part);
  }
  return parts.length ? parts.join("/") : null;
}

/** Lower case without accents, so "presentacion" finds "Presentación". */
export const foldDesignSearch = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es").trim();

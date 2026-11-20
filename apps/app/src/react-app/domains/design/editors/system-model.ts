import {
  DESIGN_PAGE_SIZES,
  designRelativePathSchema,
  designTokensSchema,
  pageIdSchema,
  type DesignManifest,
  type DesignPage,
  type DesignSummary,
  type DesignTokens,
} from "@openwork/types/designs";

/**
 * Pure model of the design system editor (kind "system", `tokens.json`). No React, no I/O:
 * parsing, sections and search, token forms and validation, the files list, and the helpers the
 * design page uses to let a design follow a system.
 */

export const TOKENS_FILE = "tokens.json";

export const SYSTEM_SECTIONS = [
  "overview", "colors", "typography", "spacing", "radii", "shadows", "gradients", "layout", "components", "assets", "files",
] as const;
export type SystemSection = (typeof SYSTEM_SECTIONS)[number];

/** Sections whose items are tokens of `tokens.json` (everything but Overview and Files). */
export const TOKEN_KINDS = ["colors", "typography", "spacing", "radii", "shadows", "gradients", "layout", "components", "assets"] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];
export type TokenOf<K extends TokenKind> = DesignTokens[K][number];
export type AnyToken = TokenOf<TokenKind>;

export function isTokenKind(section: SystemSection): section is TokenKind {
  return TOKEN_KINDS.some(kind => kind === section);
}

export function emptyTokens(): DesignTokens {
  return designTokensSchema.parse({ format: "openwork.design-tokens", version: 1 });
}

export type ParsedTokens = { ok: true; tokens: DesignTokens } | { ok: false; code: "invalid_json" | "invalid_tokens" };

/** Reads the text of `tokens.json`. An empty file is an empty system. */
export function parseTokensText(text: string): ParsedTokens {
  if (!text.trim()) return { ok: true, tokens: emptyTokens() };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, code: "invalid_json" };
  }
  const parsed = designTokensSchema.safeParse(raw);
  return parsed.success ? { ok: true, tokens: parsed.data } : { ok: false, code: "invalid_tokens" };
}

export function serializeTokens(tokens: DesignTokens): string {
  return `${JSON.stringify(designTokensSchema.parse(tokens), null, 2)}\n`;
}

/** True when the system has nothing yet: no prose and no tokens. */
export function tokensAreEmpty(tokens: DesignTokens): boolean {
  return !tokens.overview.trim() && !tokens.content.trim() && TOKEN_KINDS.every(kind => tokens[kind].length === 0);
}

// ---- Search ----

export function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/** The texts a token is found by. */
export function tokenSearchText(token: AnyToken): string {
  return Object.values(token).map(value => String(value ?? "")).join(" ");
}

export function filterTokens<K extends TokenKind>(tokens: DesignTokens, kind: K, query: string): { token: TokenOf<K>; index: number }[] {
  const needle = normalizeSearch(query);
  const list: TokenOf<K>[] = tokens[kind];
  return list.map((token, index) => ({ token, index })).filter(({ token }) => !needle || normalizeSearch(tokenSearchText(token)).includes(needle));
}

/** Items per section for the navigation; a search counts only matching items. */
export function sectionCounts(tokens: DesignTokens, files: readonly DesignFileEntry[], query: string): Record<SystemSection, number | null> {
  const needle = normalizeSearch(query);
  const counts: Record<SystemSection, number | null> = {
    overview: null, colors: 0, typography: 0, spacing: 0, radii: 0, shadows: 0, gradients: 0, layout: 0, components: 0, assets: 0,
    files: needle ? files.filter(file => normalizeSearch(file.path).includes(needle)).length : files.length,
  };
  for (const kind of TOKEN_KINDS) counts[kind] = filterTokens(tokens, kind, query).length;
  return counts;
}

// ---- CSS values (only rendered as React style values, never as markup) ----

/**
 * A value that can be used as a CSS property value for a sample without loading anything:
 * no `url()`/`image()` (they would fetch), no escapes, no declarations or blocks.
 */
export function isSafeCssValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 400) return false;
  if (/[\\;{}<>@"'`]/.test(trimmed)) return false;
  return !/\b(?:url|image|image-set|element|cross-fade|src|expression|attr)\s*\(/i.test(trimmed);
}

const NAMED_COLORS = new Set(["transparent", "currentcolor", "black", "white", "red", "green", "blue", "yellow", "orange", "purple", "gray", "grey", "navy", "teal", "maroon", "olive", "silver", "lime", "aqua", "fuchsia"]);

export function isCssColor(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(trimmed)) return true;
  if (/^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([^()]*\)$/.test(trimmed)) return isSafeCssValue(trimmed);
  return NAMED_COLORS.has(trimmed);
}

export function isCssLength(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return /^(?:0|-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|%|pt|vh|vw|ch|ex))$/.test(trimmed);
}

function isFontWeight(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  if (["normal", "bold", "lighter", "bolder"].includes(trimmed)) return true;
  const number = Number(trimmed);
  return /^\d+$/.test(trimmed) && number >= 1 && number <= 1000;
}

function isLineHeight(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return trimmed === "normal" || /^(?:\d+\.?\d*|\.\d+)$/.test(trimmed) || isCssLength(trimmed);
}

/** A font-family list for a specimen: the token's family first, then the system stack. */
export function fontStack(family: string): string {
  const clean = family.replace(/[^\p{L}\p{N} ,'"-]/gu, "").trim();
  return clean ? `${clean}, system-ui, sans-serif` : "system-ui, sans-serif";
}

/** Parsed weight for the specimen: numbers stay numbers, keywords stay words. */
export function fontWeightValue(weight: number | string): number | string {
  const text = String(weight).trim();
  return /^\d+$/.test(text) ? Number(text) : isFontWeight(text) ? text : 400;
}

// ---- Token forms ----

export const TOKEN_FIELDS = {
  colors: ["name", "value", "role", "group"],
  typography: ["name", "family", "size", "weight", "lineHeight", "sample"],
  spacing: ["name", "value"],
  radii: ["name", "value"],
  shadows: ["name", "value"],
  gradients: ["name", "value"],
  layout: ["name", "value", "note"],
  components: ["name", "file", "description"],
  assets: ["name", "file"],
} as const satisfies Record<TokenKind, readonly string[]>;
export type TokenField = (typeof TOKEN_FIELDS)[TokenKind][number];
export type TokenForm = Partial<Record<TokenField, string>>;

const REQUIRED_FIELDS = new Set<TokenField>(["name", "value", "family", "size", "weight", "file"]);
const MULTILINE_FIELDS = new Set<TokenField>(["description", "note", "sample"]);

export function tokenFieldRequired(field: TokenField): boolean {
  return REQUIRED_FIELDS.has(field);
}
export function tokenFieldMultiline(field: TokenField): boolean {
  return MULTILINE_FIELDS.has(field);
}

export function tokenFormFrom(kind: TokenKind, token: AnyToken | null): TokenForm {
  const form: TokenForm = {};
  for (const field of TOKEN_FIELDS[kind]) {
    const value: unknown = token ? Reflect.get(token, field) : undefined;
    form[field] = value === undefined || value === null ? "" : String(value);
  }
  return form;
}

export type TokenErrors = Partial<Record<TokenField, string>>;
export type BuiltToken = { ok: true; token: AnyToken } | { ok: false; errors: TokenErrors };

const elementSchemas = {
  colors: designTokensSchema.shape.colors.unwrap().element,
  typography: designTokensSchema.shape.typography.unwrap().element,
  spacing: designTokensSchema.shape.spacing.unwrap().element,
  radii: designTokensSchema.shape.radii.unwrap().element,
  shadows: designTokensSchema.shape.shadows.unwrap().element,
  gradients: designTokensSchema.shape.gradients.unwrap().element,
  layout: designTokensSchema.shape.layout.unwrap().element,
  components: designTokensSchema.shape.components.unwrap().element,
  assets: designTokensSchema.shape.assets.unwrap().element,
};

function isTokenField(value: unknown): value is TokenField {
  return Object.values(TOKEN_FIELDS).some(fields => fields.some(field => field === value));
}

/**
 * Validates a token form against the list it goes into (names are unique per section, ignoring
 * case) and the schema's limits. `editIndex` is the position being edited, or null when adding.
 * Errors are i18n keys.
 */
export function buildToken(kind: TokenKind, form: TokenForm, list: readonly AnyToken[], editIndex: number | null): BuiltToken {
  const errors: TokenErrors = {};
  const value = (field: TokenField) => (form[field] ?? "").trim();
  for (const field of TOKEN_FIELDS[kind]) {
    if (tokenFieldRequired(field) && !value(field)) errors[field] = "design_ui.system.error.required";
  }
  const name = value("name");
  if (name && list.some((token, index) => index !== editIndex && normalizeSearch(token.name) === normalizeSearch(name))) {
    errors.name = "design_ui.system.error.name_taken";
  }
  const main = value("value");
  if (main && !errors.value) {
    if (kind === "colors" && !isCssColor(main)) errors.value = "design_ui.system.error.color";
    if ((kind === "spacing" || kind === "radii") && !isCssLength(main)) errors.value = "design_ui.system.error.length";
    if (kind === "shadows" && !isSafeCssValue(main)) errors.value = "design_ui.system.error.css";
    if (kind === "gradients" && (!isSafeCssValue(main) || !/gradient\(/i.test(main))) errors.value = "design_ui.system.error.gradient";
  }
  if (kind === "typography") {
    if (value("size") && !isCssLength(value("size"))) errors.size = "design_ui.system.error.length";
    if (value("weight") && !isFontWeight(value("weight"))) errors.weight = "design_ui.system.error.weight";
    if (value("lineHeight") && !isLineHeight(value("lineHeight"))) errors.lineHeight = "design_ui.system.error.line_height";
  }
  if (value("file") && !designRelativePathSchema.safeParse(value("file")).success) errors.file = "design_ui.system.error.path";

  const candidate: Record<string, string | number> = {};
  for (const field of TOKEN_FIELDS[kind]) {
    const text = value(field);
    if (!text) continue;
    candidate[field] = field === "weight" && /^\d+$/.test(text) ? Number(text) : text;
  }
  const parsed = elementSchemas[kind].safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (isTokenField(field) && !errors[field]) errors[field] = issue.code === "too_big" ? "design_ui.system.error.too_long" : "design_ui.system.error.invalid";
    }
  }
  if (Object.keys(errors).length > 0 || !parsed.success) return { ok: false, errors };
  return { ok: true, token: parsed.data };
}

/** Returns the tokens with the item added (editIndex null), replaced or removed (token null). */
export function updateTokens(tokens: DesignTokens, kind: TokenKind, editIndex: number | null, token: AnyToken | null): DesignTokens {
  const list: AnyToken[] = [...tokens[kind]];
  if (editIndex === null) {
    if (token) list.push(token);
  } else if (token) {
    list[editIndex] = token;
  } else {
    list.splice(editIndex, 1);
  }
  // Reading back through the schema keeps every list typed as its own kind.
  return designTokensSchema.parse({ ...tokens, [kind]: list });
}

// ---- Files and components ----

export type DesignFileKind = "manifest" | "tokens" | "page" | "component" | "asset" | "thumbnail";
export type DesignFileEntry = { path: string; kind: DesignFileKind };

/** Files the design folder is known to hold, from the manifest and `tokens.json`. */
export function designFiles(design: DesignManifest, tokens: DesignTokens): DesignFileEntry[] {
  const files = new Map<string, DesignFileKind>();
  const add = (path: string, kind: DesignFileKind) => { if (!files.has(path)) files.set(path, kind); };
  add("design.json", "manifest");
  add(TOKENS_FILE, "tokens");
  for (const page of design.pages) add(page.file, "page");
  for (const component of tokens.components) add(component.file, "component");
  for (const asset of tokens.assets) add(asset.file, "asset");
  if (design.thumbnail) add(design.thumbnail, "thumbnail");
  return [...files].map(([path, kind]) => ({ path, kind })).sort((a, b) => a.path.localeCompare(b.path));
}

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", svg: "image/svg+xml",
};

/** The image type of an asset by extension, or null when it is not an image. */
export function imageType(path: string): string | null {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_TYPES[extension] ?? null;
}

/** The page a component preview renders: the manifest's page for that file, or one built from it. */
export function componentPage(design: DesignManifest, component: TokenOf<"components">, index: number): DesignPage {
  const existing = design.pages.find(page => page.file === component.file);
  if (existing) return existing;
  const slug = component.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  const id = pageIdSchema.safeParse(`c${index}-${slug}`.replace(/-+$/, "")).success ? `c${index}-${slug}`.replace(/-+$/, "") : `c${index}`;
  return { id, title: component.name.slice(0, 120), file: component.file, ...DESIGN_PAGE_SIZES.system };
}

// ---- Following a system (for the design page; the server applies the same rule) ----

export type DesignSystemChoice = { id: string; title: string };

/** The design systems a design of a project can follow (never itself). */
export function designSystemChoices(designs: readonly DesignSummary[], workspaceId: string, designId: string): DesignSystemChoice[] {
  return designs
    .filter(design => design.workspaceId === workspaceId && design.kind === "system" && design.id !== designId)
    .map(design => ({ id: design.id, title: design.title }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * The system a design follows: its `systemId` when that system still exists, otherwise the
 * project's only system. `explicit` says whether the person chose it. Mirrors the server's
 * `pickDesignSystemId` (apps/server/src/designs/system-context.ts).
 */
export function followedSystem(design: Pick<DesignManifest, "id" | "kind" | "systemId">, choices: readonly DesignSystemChoice[]): { system: DesignSystemChoice; explicit: boolean } | null {
  if (design.kind === "system") return null;
  const candidates = choices.filter(choice => choice.id !== design.id);
  if (design.systemId) {
    const chosen = candidates.find(choice => choice.id === design.systemId);
    return chosen ? { system: chosen, explicit: true } : null;
  }
  const only = candidates.length === 1 ? candidates[0] : undefined;
  return only ? { system: only, explicit: false } : null;
}

/** The PATCH body for `updateDesign` when the person picks a system (null = follow none / the default). */
export function systemIdPatch(choice: string | null, choices: readonly DesignSystemChoice[]): { systemId: string | null } {
  return { systemId: choice && choices.some(item => item.id === choice) ? choice : null };
}

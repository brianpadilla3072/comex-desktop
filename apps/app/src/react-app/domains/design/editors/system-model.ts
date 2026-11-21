import {
  DESIGN_PAGE_SIZES,
  designRelativePathSchema,
  designTokensSchema,
  pageIdSchema,
  type DesignAsset,
  type DesignColorTheme,
  type DesignColorToken,
  type DesignComponent,
  type DesignManifest,
  type DesignMeasureToken,
  type DesignPage,
  type DesignSummary,
  type DesignTokens,
  type DesignTypeGroup,
  type ThemedTokenValue,
} from "@openwork/types/designs";

/**
 * Pure model of the design system editor (kind "system", `tokens.json`). No React, no I/O:
 * parsing, sections and search, token forms and validation, the files list, and the helpers the
 * design page uses to let a design follow a system.
 *
 * `tokens.json` is stored in the v2 shape (themes, grouped type styles, measure groups, rich
 * components). The editor still speaks the v1 section names; this module is the adapter: it
 * reads v2 into flat, v1-like token views and writes edited views back into the v2 document.
 */

export const TOKENS_FILE = "tokens.json";

export const SYSTEM_SECTIONS = [
  "overview", "colors", "typography", "spacing", "radii", "shadows", "gradients", "layout", "components", "assets", "files",
] as const;
export type SystemSection = (typeof SYSTEM_SECTIONS)[number];

/** Sections whose items are tokens of `tokens.json` (everything but Overview and Files). */
export const TOKEN_KINDS = ["colors", "typography", "spacing", "radii", "shadows", "gradients", "layout", "components", "assets"] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];

export function isTokenKind(section: SystemSection): section is TokenKind {
  return TOKEN_KINDS.some(kind => kind === section);
}

// ---- The v2 document, seen through the editor's v1-named sections ----

/** A color value may be themed; the editor edits the value of the first theme. */
export type ColorToken = { name: string; value: string; role?: string; group?: string };
/** A type style, with its family key resolved to the CSS stack and its group flattened in. */
export type TypographyToken = { name: string; family: string; size: string; weight: number | string; lineHeight?: string; sample?: string };
/** A spacing/radius/shadow/gradient/layout token; `note` is the v2 `usage`. */
export type MeasureToken = { name: string; value: string; note?: string };
/** A component preview; `description` maps to the v2 `summary`. */
export type ComponentToken = { name: string; file: string; description?: string };
export type AssetToken = { name: string; file: string };

export type TokenOf<K extends TokenKind> =
  K extends "colors" ? ColorToken
    : K extends "typography" ? TypographyToken
      : K extends "components" ? ComponentToken
        : K extends "assets" ? AssetToken
          : MeasureToken;
export type AnyToken = TokenOf<TokenKind>;

const themedValue = (value: ThemedTokenValue): string => typeof value === "string" ? value : Object.values(value)[0] ?? "";

const colorView = (token: DesignColorToken): ColorToken => ({
  name: token.name,
  value: themedValue(token.value),
  ...(token.usage ? { role: token.usage } : {}),
  ...(token.group ? { group: token.group } : {}),
});

const measureView = (token: DesignMeasureToken): MeasureToken => ({
  name: token.name,
  value: themedValue(token.value),
  ...(token.usage ? { note: token.usage } : {}),
});

const componentView = (token: DesignComponent): ComponentToken => {
  const description = token.summary ?? token.description;
  return { name: token.name, file: token.file ?? "", ...(description ? { description } : {}) };
};

const assetView = (token: DesignAsset): AssetToken => ({ name: token.name, file: token.file });

const familyKeySlug = (family: string): string =>
  family.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "familia";

/** v2 type groups → flat styles, with each group's family key resolved to its CSS stack. */
export function typeEntries(tokens: DesignTokens): TypographyToken[] {
  const entries: TypographyToken[] = [];
  for (const group of tokens.type.groups) {
    const family = tokens.type.families[group.family ?? ""] ?? group.family ?? "";
    for (const style of group.styles) entries.push({
      name: style.name,
      family,
      size: style.fontSize,
      weight: style.fontWeight ?? 400,
      ...(style.lineHeight !== undefined ? { lineHeight: style.lineHeight } : {}),
      ...(style.sample !== undefined ? { sample: style.sample } : {}),
    });
  }
  return entries;
}

/** Flat styles → v2 type groups and family map; font files and the rest of the document survive. */
export function rebuildTypeGroups(tokens: DesignTokens, entries: readonly TypographyToken[]): DesignTokens {
  const families: Record<string, string> = {};
  const groups: DesignTypeGroup[] = [];
  const byFamily = new Map<string, DesignTypeGroup>();
  const used = new Set<string>();
  const keyFor = (stack: string): string => {
    for (const [key, value] of Object.entries(tokens.type.families)) {
      if (value === stack && !used.has(key)) { used.add(key); return key; }
    }
    const base = familyKeySlug(stack);
    let key = base;
    for (let n = 2; Object.hasOwn(families, key) || used.has(key); n += 1) key = `${base}-${n}`;
    used.add(key);
    return key;
  };
  for (const entry of entries) {
    const stack = entry.family.trim();
    let group = byFamily.get(stack);
    if (!group) {
      const key = keyFor(stack);
      families[key] = stack;
      group = { name: stack.slice(0, 120) || "Familia", family: key, styles: [] };
      byFamily.set(stack, group);
      groups.push(group);
    }
    group.styles.push({
      name: entry.name,
      fontSize: entry.size,
      ...(entry.lineHeight !== undefined ? { lineHeight: entry.lineHeight } : {}),
      ...(entry.weight !== undefined ? { fontWeight: entry.weight } : {}),
      ...(entry.sample !== undefined ? { sample: entry.sample } : {}),
    });
  }
  return designTokensSchema.parse({ ...tokens, type: { ...tokens.type, families, groups } });
}

const sectionReaders: { [K in TokenKind]: (tokens: DesignTokens) => TokenOf<K>[] } = {
  colors: tokens => tokens.color.tokens.map(colorView),
  typography: typeEntries,
  spacing: tokens => tokens.spacing.tokens.map(measureView),
  radii: tokens => tokens.radius.tokens.map(measureView),
  shadows: tokens => tokens.shadow.tokens.map(measureView),
  gradients: tokens => tokens.gradient.tokens.map(measureView),
  layout: tokens => tokens.layout.tokens.map(measureView),
  components: tokens => tokens.components.map(componentView),
  assets: tokens => tokens.assets.map(assetView),
};

/** The tokens of a section, in the flat shape the UI and the forms use. */
export function sectionTokens<K extends TokenKind>(tokens: DesignTokens, kind: K): TokenOf<K>[] {
  return sectionReaders[kind](tokens);
}

export function emptyTokens(): DesignTokens {
  return designTokensSchema.parse({ format: "openwork.design-tokens", version: 2 });
}

export type ParsedTokens = { ok: true; tokens: DesignTokens } | { ok: false; code: "invalid_json" | "invalid_tokens" };

/** Reads the text of `tokens.json`. An empty file is an empty system; v1 files are migrated. */
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
  return !tokens.overview.trim() && !tokens.content.trim() && TOKEN_KINDS.every(kind => sectionTokens(tokens, kind).length === 0);
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
  return sectionTokens(tokens, kind).map((token, index) => ({ token, index }))
    .filter(({ token }) => !needle || normalizeSearch(tokenSearchText(token)).includes(needle));
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

/** Same limits as the v2 schema: the form checks them before writing a document. */
const FIELD_LIMITS: Partial<Record<TokenField, number>> = {
  name: 80, value: 400, role: 2000, group: 80, family: 200, size: 32, weight: 16,
  lineHeight: 32, sample: 300, description: 2000, note: 2000,
};

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

/**
 * Validates a token form against the list it goes into (names are unique per section, ignoring
 * case) and the document's limits. `editIndex` is the position being edited, or null when adding.
 * Errors are i18n keys.
 */
export function buildToken(kind: TokenKind, form: TokenForm, list: readonly AnyToken[], editIndex: number | null): BuiltToken {
  const errors: TokenErrors = {};
  const value = (field: TokenField) => (form[field] ?? "").trim();
  for (const field of TOKEN_FIELDS[kind]) {
    if (tokenFieldRequired(field) && !value(field)) errors[field] = "design_ui.system.error.required";
    const limit = FIELD_LIMITS[field];
    if (limit !== undefined && value(field).length > limit) errors[field] = "design_ui.system.error.too_long";
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
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, token: candidate as AnyToken };
}

function replaceAt<T>(list: readonly T[], editIndex: number | null, token: T | null): T[] {
  const next = [...list];
  if (editIndex === null) {
    if (token) next.push(token);
  } else if (token) {
    next[editIndex] = token;
  } else {
    next.splice(editIndex, 1);
  }
  return next;
}

function colorToV2(view: ColorToken, themes: readonly DesignColorTheme[], existing?: DesignColorToken): DesignColorToken {
  const ids = existing && typeof existing.value === "object" && existing.value !== null
    ? Object.keys(existing.value) : themes.map(theme => theme.id);
  const value: ThemedTokenValue = ids.length ? Object.fromEntries(ids.map(id => [id, view.value])) : view.value;
  return {
    name: view.name,
    value,
    ...(view.role ? { usage: view.role } : {}),
    ...(view.group ? { group: view.group } : {}),
  };
}

const measureToV2 = (view: MeasureToken): DesignMeasureToken => ({
  name: view.name,
  value: view.value,
  ...(view.note ? { usage: view.note } : {}),
});

function componentToV2(view: ComponentToken, existing?: DesignComponent): DesignComponent {
  const file = view.file.trim() || existing?.file;
  return {
    ...(existing ?? {}),
    name: view.name,
    ...(file ? { file } : {}),
    ...(view.description ? { summary: view.description } : {}),
  };
}

const assetToV2 = (view: AssetToken, existing?: DesignAsset): DesignAsset => ({ ...(existing ?? {}), name: view.name, file: view.file });

const sectionWriters: { [K in TokenKind]: (tokens: DesignTokens, editIndex: number | null, token: TokenOf<K> | null) => DesignTokens } = {
  colors: (tokens, editIndex, token) => {
    const list = replaceAt(tokens.color.tokens, editIndex, token ? colorToV2(token, tokens.color.themes, editIndex === null ? undefined : tokens.color.tokens[editIndex]) : null);
    return designTokensSchema.parse({ ...tokens, color: { ...tokens.color, tokens: list } });
  },
  typography: (tokens, editIndex, token) => {
    const entries = replaceAt(typeEntries(tokens), editIndex, token);
    return rebuildTypeGroups(tokens, entries);
  },
  spacing: (tokens, editIndex, token) => designTokensSchema.parse({ ...tokens, spacing: { ...tokens.spacing, tokens: replaceAt(tokens.spacing.tokens, editIndex, token ? measureToV2(token) : null) } }),
  radii: (tokens, editIndex, token) => designTokensSchema.parse({ ...tokens, radius: { ...tokens.radius, tokens: replaceAt(tokens.radius.tokens, editIndex, token ? measureToV2(token) : null) } }),
  shadows: (tokens, editIndex, token) => designTokensSchema.parse({ ...tokens, shadow: { ...tokens.shadow, tokens: replaceAt(tokens.shadow.tokens, editIndex, token ? measureToV2(token) : null) } }),
  gradients: (tokens, editIndex, token) => designTokensSchema.parse({ ...tokens, gradient: { ...tokens.gradient, tokens: replaceAt(tokens.gradient.tokens, editIndex, token ? measureToV2(token) : null) } }),
  layout: (tokens, editIndex, token) => designTokensSchema.parse({ ...tokens, layout: { ...tokens.layout, tokens: replaceAt(tokens.layout.tokens, editIndex, token ? measureToV2(token) : null) } }),
  components: (tokens, editIndex, token) => designTokensSchema.parse({ ...tokens, components: replaceAt(tokens.components, editIndex, token ? componentToV2(token, editIndex === null ? undefined : tokens.components[editIndex]) : null) }),
  assets: (tokens, editIndex, token) => designTokensSchema.parse({ ...tokens, assets: replaceAt(tokens.assets, editIndex, token ? assetToV2(token, editIndex === null ? undefined : tokens.assets[editIndex]) : null) }),
};

/** Returns the tokens with the item added (editIndex null), replaced or removed (token null). */
export function updateTokens<K extends TokenKind>(tokens: DesignTokens, kind: K, editIndex: number | null, token: TokenOf<K> | null): DesignTokens {
  return sectionWriters[kind](tokens, editIndex, token);
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
  for (const component of tokens.components) if (component.file) add(component.file, "component");
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
export function componentPage(design: DesignManifest, component: ComponentToken, index: number): DesignPage {
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

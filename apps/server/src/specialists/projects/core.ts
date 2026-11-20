import { PROJECT_LIMITS } from "@openwork/types/projects";

/**
 * Pure rules of the Projects experience (no I/O). Another implementation must match them:
 * contracts/projects/v1/vectors.json runs every function here.
 */

export type ContextPathResult = { ok: true; path: string } | { ok: false; code: ContextPathError };
export type ContextPathError = "path_required" | "path_invalid" | "path_hidden" | "path_too_deep" | "name_too_long";

const RESERVED = /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i;
const CONTROL = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;
const MAX_COMPONENT_BYTES = 255;

/**
 * Normalize a path inside a project's context area. `/` and `\` separate folders; leading and
 * trailing separators are ignored; `.`/`..`, hidden names (leading dot), colons, control or
 * bidirectional characters, Windows device names, names ending in a dot or space, names over
 * 255 UTF-8 bytes and nesting deeper than `PROJECT_LIMITS.contextDepth` are refused.
 * `allowRoot` accepts the empty path (the context root itself).
 */
export function normalizeContextPath(input: string, options: { allowRoot: boolean }): ContextPathResult {
  const parts = input.replace(/\\/g, "/").split("/").filter(part => part.length > 0);
  if (!parts.length) return options.allowRoot ? { ok: true, path: "" } : { ok: false, code: "path_required" };
  if (parts.length > PROJECT_LIMITS.contextDepth) return { ok: false, code: "path_too_deep" };
  for (const part of parts) {
    if (part === "." || part === "..") return { ok: false, code: "path_invalid" };
    if (CONTROL.test(part) || part.includes(":") || /[. ]$/.test(part) || /^\s/.test(part) || RESERVED.test(part)) return { ok: false, code: "path_invalid" };
    if (part.startsWith(".")) return { ok: false, code: "path_hidden" };
    if (new TextEncoder().encode(part).length > MAX_COMPONENT_BYTES) return { ok: false, code: "name_too_long" };
  }
  return { ok: true, path: parts.map(part => part.normalize("NFC")).join("/") };
}

export type UploadCheck = { ok: true } | { ok: false; code: "context_file_too_large" | "context_capacity_bytes" | "context_capacity_files" };

/**
 * Whether a file of `size` bytes fits. `replacing` is the size of the file it overwrites (null
 * for a new file): replacing frees that space and does not add to the file count.
 */
export function checkUpload(usage: { files: number; bytes: number }, size: number, replacing: number | null): UploadCheck {
  if (size > PROJECT_LIMITS.contextFileBytes) return { ok: false, code: "context_file_too_large" };
  if (replacing === null && usage.files + 1 > PROJECT_LIMITS.contextFiles) return { ok: false, code: "context_capacity_files" };
  if (usage.bytes - (replacing ?? 0) + size > PROJECT_LIMITS.contextBytes) return { ok: false, code: "context_capacity_bytes" };
  return { ok: true };
}

/** The most bytes an upload may stream before it is cut off (the smaller of both caps). */
export function uploadByteBudget(usage: { bytes: number }, replacing: number | null): number {
  return Math.max(0, Math.min(PROJECT_LIMITS.contextFileBytes, PROJECT_LIMITS.contextBytes - usage.bytes + (replacing ?? 0)));
}

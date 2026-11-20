import { z } from "zod";

/** Pure rules of task isolation and review (docs/features/task-isolation-review). Paths, the
 *  change classification and the line diff take data and return data; the vectors in
 *  contracts/task-isolation/v1/ pin them for another implementation. All I/O lives in service.ts. */

export const ISOLATION_LIMITS = {
  /** Files in one project copy (and in the copy when it is reviewed). */
  maxFiles: 20_000,
  /** Bytes copied for one snapshot. */
  maxTotalBytes: 1024 * 1024 * 1024,
  /** A single file larger than this is not copied: the project is too large to isolate. */
  maxFileBytes: 256 * 1024 * 1024,
  /** A side larger than this is shown as size and type only, never as a text diff. */
  maxDiffBytes: 512 * 1024,
  /** Diff lines returned for one file. */
  maxDiffLines: 4_000,
  /** Paths accepted or discarded in one request. */
  maxPathsPerRequest: 500,
  /** Active isolated copies per application. */
  maxActive: 20,
} as const;

/** Folders never copied nor reviewed: version control, dependencies and caches. */
const EXCLUDED_DIRECTORIES = new Set([".git", "node_modules", ".cache", "__pycache__", ".venv", "venv", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".turbo", ".next", ".parcel-cache"]);
const EXCLUDED_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
/** OpenCode installs plugin dependencies inside `.opencode/`; that bookkeeping is not work. */
const EXCLUDED_PATHS = new Set([".opencode/bun.lock", ".opencode/package-lock.json", ".opencode/.gitignore"]);
export const TEMPORARY_PREFIX = ".openwork-isolation-";

export type PathProblem = "path_invalid" | "path_excluded";

/** A project-relative path as it travels in requests and on disk: forward slashes, no `.`/`..`,
 *  no empty segment, no absolute or drive prefix, no control characters. */
export function relativePathProblem(value: string): PathProblem | null {
  if (!value || value.length > 1024) return "path_invalid";
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return "path_invalid";
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value)) return "path_invalid";
  const segments = value.split("/");
  if (segments.some(segment => !segment || segment === "." || segment === "..")) return "path_invalid";
  if (isExcludedPath(value)) return "path_excluded";
  return null;
}

export function isExcludedPath(path: string): boolean {
  if (EXCLUDED_PATHS.has(path)) return true;
  const segments = path.split("/");
  const name = segments[segments.length - 1] ?? "";
  if (EXCLUDED_FILES.has(name) || name.startsWith(TEMPORARY_PREFIX)) return true;
  return segments.slice(0, -1).some(segment => EXCLUDED_DIRECTORIES.has(segment)) || EXCLUDED_DIRECTORIES.has(name);
}

/** A directory name the walker never descends into. */
export function isExcludedDirectory(path: string): boolean {
  const name = path.split("/").pop() ?? "";
  return EXCLUDED_DIRECTORIES.has(name);
}

export const fileStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("absent") }),
  /** A link, folder or device where a file is expected: never equal to anything. */
  z.object({ kind: z.literal("other") }),
]);
export type FileState = z.infer<typeof fileStateSchema>;
export const ABSENT: FileState = { kind: "absent" };

export function sameState(a: FileState, b: FileState): boolean {
  if (a.kind === "absent" && b.kind === "absent") return true;
  return a.kind === "file" && b.kind === "file" && a.sha256 === b.sha256 && a.size === b.size;
}

export type ChangeKind = "added" | "modified" | "deleted";
export type Classification = { change: ChangeKind | null; conflict: boolean; alreadyApplied: boolean };

/** `base`: the file when the copy was made. `copy`: the file in the task's copy now. `project`:
 *  the file in the project now. A change conflicts when the project moved away from the base and
 *  does not already hold the task's version. */
export function classifyChange(base: FileState, copy: FileState, project: FileState): Classification {
  if (sameState(base, copy) || copy.kind === "other") return { change: null, conflict: false, alreadyApplied: false };
  const change: ChangeKind = base.kind !== "file" ? "added" : copy.kind === "absent" ? "deleted" : "modified";
  const alreadyApplied = sameState(project, copy);
  return { change, conflict: !alreadyApplied && !sameState(project, base), alreadyApplied };
}

/** UTF-8 text without NUL bytes, small enough to diff. Anything else is shown by size and type. */
export function isDiffableText(bytes: Uint8Array): boolean {
  if (bytes.byteLength > ISOLATION_LIMITS.maxDiffBytes) return false;
  if (bytes.includes(0)) return false;
  try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); return true; }
  catch { return false; }
}

export const diffLineSchema = z.object({ kind: z.enum(["context", "removed", "added"]), text: z.string() });
export const diffHunkSchema = z.object({
  oldStart: z.number().int().nonnegative(), oldLines: z.number().int().nonnegative(),
  newStart: z.number().int().nonnegative(), newLines: z.number().int().nonnegative(),
  lines: z.array(diffLineSchema),
});
export type DiffHunk = z.infer<typeof diffHunkSchema>;
type DiffLine = z.infer<typeof diffLineSchema>;

export function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Edit distance beyond which the diff degrades to "everything replaced" (still correct). */
const MAX_EDIT_DISTANCE = 1_000;

/** Myers O(ND) line diff over the middle that differs (common prefix/suffix trimmed first). */
function editScript(a: string[], b: string[]): DiffLine[] {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const head: DiffLine[] = a.slice(0, prefix).map(text => ({ kind: "context", text }));
  const tail: DiffLine[] = a.slice(a.length - suffix).map(text => ({ kind: "context", text }));
  const x = a.slice(prefix, a.length - suffix);
  const y = b.slice(prefix, b.length - suffix);
  const n = x.length;
  const m = y.length;
  const replaceAll = (): DiffLine[] => [...x.map(text => ({ kind: "removed" as const, text })), ...y.map(text => ({ kind: "added" as const, text }))];
  if (!n || !m) return [...head, ...replaceAll(), ...tail];
  const max = Math.min(n + m, MAX_EDIT_DISTANCE);
  const offset = max + 1;
  let v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let i = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let j = i - k;
      while (i < n && j < m && x[i] === y[j]) { i++; j++; }
      next[offset + k] = i;
      if (i >= n && j >= m) { found = true; break; }
    }
    v = next;
  }
  if (!found) return [...head, ...replaceAll(), ...tail];
  trace.push(v);
  // Walk back through the saved frontiers (trace[d + 1] is the frontier after step d).
  const middle: DiffLine[] = [];
  let i = n;
  let j = m;
  for (let d = trace.length - 2; d >= 0; d--) {
    const frontier = trace[d]!;
    const k = i - j;
    const down = k === -d || (k !== d && frontier[offset + k - 1]! < frontier[offset + k + 1]!);
    const previousK = down ? k + 1 : k - 1;
    const previousI = d === 0 ? 0 : frontier[offset + previousK]!;
    const previousJ = d === 0 ? 0 : previousI - previousK;
    while (i > previousI && j > previousJ && (d > 0 || i > 0 && j > 0)) { middle.push({ kind: "context", text: x[i - 1]! }); i--; j--; }
    if (d === 0) break;
    if (down) { middle.push({ kind: "added", text: y[j - 1]! }); j--; }
    else { middle.push({ kind: "removed", text: x[i - 1]! }); i--; }
  }
  middle.reverse();
  return [...head, ...middle, ...tail];
}

/** Unified hunks with three lines of context, capped at `maxLines` output lines. */
export function lineDiff(before: string, after: string, maxLines: number = ISOLATION_LIMITS.maxDiffLines): { hunks: DiffHunk[]; truncated: boolean } {
  const script = editScript(splitLines(before), splitLines(after));
  const context = 3;
  const hunks: DiffHunk[] = [];
  let emitted = 0;
  let truncated = false;
  let index = 0;
  // Line numbers (1-based) of the next entry in each side.
  const oldAt: number[] = [];
  const newAt: number[] = [];
  let o = 1;
  let n = 1;
  for (const line of script) {
    oldAt.push(o); newAt.push(n);
    if (line.kind !== "added") o++;
    if (line.kind !== "removed") n++;
  }
  while (index < script.length) {
    while (index < script.length && script[index]!.kind === "context") index++;
    if (index >= script.length) break;
    const start = Math.max(0, index - context);
    let end = index;
    // Extend while the next change is within 2 × context lines.
    while (end < script.length) {
      if (script[end]!.kind !== "context") { end++; continue; }
      let run = end;
      while (run < script.length && script[run]!.kind === "context") run++;
      if (run >= script.length || run - end > context * 2) { end = Math.min(script.length, end + context); break; }
      end = run;
    }
    const lines = script.slice(start, end);
    if (emitted + lines.length > maxLines) { truncated = true; break; }
    emitted += lines.length;
    const oldLines = lines.filter(line => line.kind !== "added").length;
    const newLines = lines.filter(line => line.kind !== "removed").length;
    hunks.push({
      oldStart: oldLines ? oldAt[start]! : Math.max(0, oldAt[start]! - 1), oldLines,
      newStart: newLines ? newAt[start]! : Math.max(0, newAt[start]! - 1), newLines,
      lines,
    });
    index = end;
  }
  return { hunks, truncated };
}

/** A broad type for files shown by size only, from the extension. */
export function fileTypeLabel(path: string): string {
  const extension = /\.([A-Za-z0-9]{1,10})$/.exec(path)?.[1]?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tif", "tiff"].includes(extension)) return "image";
  if (extension === "pdf") return "pdf";
  if (["xlsx", "xls", "ods", "csv", "tsv"].includes(extension)) return "spreadsheet";
  if (["docx", "doc", "odt", "rtf"].includes(extension)) return "document";
  if (["pptx", "ppt", "odp", "key"].includes(extension)) return "presentation";
  if (["zip", "gz", "tgz", "7z", "rar", "tar"].includes(extension)) return "archive";
  if (["mp3", "wav", "ogg", "m4a", "mp4", "mov", "webm"].includes(extension)) return "media";
  return "file";
}

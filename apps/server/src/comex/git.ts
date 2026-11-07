import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { lstat, mkdir, realpath, readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join, resolve, parse, relative } from "node:path";
import { ApiError } from "../errors.js";

const execute = promisify(execFile);
// Inherited repository/config overrides must not escape the registered workspace.
function gitEnvironment() {
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_"))), GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
}
const gitOptions = ["-c", "core.fsmonitor=false", "-c", "core.quotePath=false", "-c", "submodule.recurse=false"];
const unavailable = () => new ApiError(422, "git_unavailable", "No pude completar la operación Git. Verificá el repositorio y la instalación de Git.");

/** Status/diff also run clean filters, so disable drivers before every operation. */
async function disabledFilters(root: string) {
  try {
    const result = await execute("git", [...gitOptions, "-C", root, "config", "--null", "--name-only", "--list"], {
      encoding: "utf8", timeout: 15_000, maxBuffer: 2 * 1024 * 1024, env: gitEnvironment(), windowsHide: true,
    });
    const drivers = new Set(result.stdout.split("\0").flatMap(key => {
      const match = /^filter\.([\s\S]+)\.(?:clean|smudge|process|required)$/i.exec(key);
      return match ? [match[1]!] : [];
    }));
    return [...drivers].flatMap(name => ["-c", `filter.${name}.clean=`, "-c", `filter.${name}.smudge=`, "-c", `filter.${name}.process=`, "-c", `filter.${name}.required=false`]);
  } catch { throw unavailable(); }
}

/** Drain output while retaining only the preview; large diffs must not exhaust memory. */
async function diffPreview(root: string, args: string[]) {
  const filters = await disabledFilters(root);
  return new Promise<{ text: string; truncated: boolean; digest: string }>((resolvePreview, reject) => {
    const child = spawn("git", [...gitOptions, ...filters, "-C", root, ...args], { env: gitEnvironment(), stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    const chunks: Buffer[] = [];
    const hash = createHash("sha256");
    const limit = 160_001;
    let bytes = 0;
    let truncated = false;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 15_000);
    child.stdout.on("data", (chunk: Buffer) => {
      hash.update(chunk);
      const retained = chunk.subarray(0, Math.max(0, limit - bytes));
      if (retained.length) chunks.push(retained);
      bytes += retained.length;
      if (retained.length < chunk.length) truncated = true;
    });
    child.once("error", () => { clearTimeout(timer); reject(unavailable()); });
    child.once("close", code => {
      clearTimeout(timer);
      if (timedOut || code !== 0) reject(unavailable());
      else resolvePreview({ text: Buffer.concat(chunks).toString("utf8"), truncated, digest: hash.digest("hex") });
    });
  });
}
async function git(root: string, args: string[]) {
  try {
    const filters = await disabledFilters(root);
    const result = await execute("git", [...gitOptions, ...filters, "-C", root, ...args], {
      encoding: "utf8", timeout: 15_000, maxBuffer: 2 * 1024 * 1024,
      env: gitEnvironment(), windowsHide: true,
    });
    return result.stdout;
  } catch {
    throw unavailable();
  }
}

export async function reviewGitWorkspace(directory: string, options: { codeOnly?: boolean } = {}) {
  const canonical = await realpath(directory);
  const root = (await git(canonical, ["rev-parse", "--show-toplevel"])).replace(/\r?\n$/, "");
  // Never expose the enclosing repository when a registered project is a subfolder.
  if (await realpath(root) !== canonical) throw new ApiError(422, "git_root_required", "Abrí la carpeta raíz del repositorio para revisar sus cambios.");
  const status = await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=normal", "--ignore-submodules=dirty"]);
  let head: string | null = null;
  try { head = (await git(root, ["rev-parse", "--verify", "HEAD"])).trim(); } catch { /* An empty repository has no committed base. */ }
  const args = ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--ignore-submodules=dirty", "--submodule=short"];
  const paths = options.codeOnly ? ["--", ...codePaths] : [];
  const unstaged = await diffPreview(root, [...args, ...paths]);
  const staged = await diffPreview(root, [...args, "--cached", ...paths]);
  let currentHead: string | null = null;
  try { currentHead = (await git(root, ["rev-parse", "--verify", "HEAD"])).trim(); } catch { /* Unborn repository. */ }
  if (currentHead !== head) throw new ApiError(409, "git_head_changed", "Cambió el commit durante la revisión. Volvé a revisar el proyecto.");
  const max = 160_000;
  const fullDiff = [staged.text && `Cambios preparados\n${staged.text}`, unstaged.text && `Cambios sin preparar\n${unstaged.text}`].filter(Boolean).join("\n");
  const entries = status.split("\0").filter(Boolean);
  const filtered: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const renamed = /^[RC]|^.[RC]/.test(entry);
    const previous = renamed ? entries[++i] : undefined;
    if (!options.codeOnly || isCodePath(entry.slice(3)) || previous && isCodePath(previous)) filtered.push(entry, ...(previous ? [previous] : []));
  }
  return { root, head, status: filtered, diff: fullDiff.slice(0, max), truncated: staged.truncated || unstaged.truncated || fullDiff.length > max };
}

async function privateDirectory(directory: string) {
  const absolute = resolve(directory);
  const base = parse(absolute).root;
  let current = base;
  for (const part of relative(base, absolute).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    await mkdir(current, { recursive: true, mode: 0o700 });
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new ApiError(422, "git_unsafe_path", "La carpeta de trabajo aislado no admite enlaces simbólicos.");
  }
}

/** Snapshot committed HEAD only: uncommitted changes remain in the source. */
export async function createGitWorktree(directory: string, runtimeDirectory: string, expectedHead: string) {
  const review = await reviewGitWorkspace(directory);
  if (!review.head) throw new ApiError(422, "git_commit_required", "Guardá un primer commit antes de crear un trabajo aislado.");
  if (expectedHead !== review.head) throw new ApiError(409, "git_head_changed", "Cambió el commit del proyecto. Volvé a revisar los cambios antes de crear el trabajo aislado.");
  const parent = join(runtimeDirectory, "comex-worktrees", createHash("sha256").update(review.root).digest("hex").slice(0, 24));
  await privateDirectory(parent);
  const path = join(parent, randomUUID());
  // A new random nonexistent directory cannot contain a post-checkout hook.
  const disabledHooks = join(parent, `disabled-hooks-${randomUUID()}`);
  await git(review.root, ["-c", "core.hooksPath=" + disabledHooks, "worktree", "add", "--detach", "--", path, expectedHead]);
  return { path, head: expectedHead, detached: true, includesUncommittedChanges: false };
}

/** Code-only pathspecs: reports, spreadsheets and prose never trigger code review. */
const codePaths = ["*.ts", "*.tsx", "*.js", "*.jsx", "*.mjs", "*.cjs", "*.py", "*.rs", "*.go", "*.java", "*.kt", "*.swift", "*.c", "*.cpp", "*.h", "*.cs", "*.rb", "*.php", "*.sh", "*.bash", "*.html", "*.css", "*.scss", "*.sql", "package.json", "Dockerfile", "Makefile", "tsconfig.json"];
export const isCodePath = (path: string) => /\.(?:[cm]?[jt]sx?|py|rs|go|java|kt|swift|c|cpp|h|cs|rb|php|sh|bash|html|css|scss|sql)$/i.test(path) || /(?:^|\/)(?:package\.json|tsconfig\.json|Dockerfile|Makefile)$/.test(path);
export async function codeChangeFingerprint(root: string): Promise<string | null> {
  const diffArgs = ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--ignore-submodules=all"];
  const [unstaged, staged, untracked] = await Promise.all([
    diffPreview(root, [...diffArgs, "--", ...codePaths]), diffPreview(root, [...diffArgs, "--cached", "--", ...codePaths]),
    git(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  const hash = createHash("sha256").update(staged.digest).update(unstaged.digest);
  let changed = Boolean(staged.text || unstaged.text);
  for (const path of untracked.split("\0").filter(isCodePath).sort()) {
    const full = join(root, path);
    const info = await lstat(full);
    if (!info.isFile() || info.isSymbolicLink()) continue;
    // Do not follow a parent link outside the project.
    const canonical = await realpath(full);
    if (relative(await realpath(root), canonical).startsWith("..")) continue;
    changed = true;
    hash.update(path).update(String(info.size)).update(String(info.mtimeMs));
    if (info.size <= 1024 * 1024) hash.update(await readFile(full));
  }
  return changed ? hash.digest("hex") : null;
}

export async function listGitWorktrees(root: string) {
  const review = await reviewGitWorkspace(root);
  const output = await git(review.root, ["worktree", "list", "--porcelain", "-z"]);
  return output.split("\0\0").filter(Boolean).map(block => {
    const fields = block.split("\0");
    return { path: fields.find(x => x.startsWith("worktree "))?.slice(9) ?? "",
      head: fields.find(x => x.startsWith("HEAD "))?.slice(5) ?? "",
      locked: fields.some(x => x === "locked" || x.startsWith("locked ")) };
  });
}

/** Only remove a clean, unlocked worktree whose commit is retained by the source. */
export async function removeGitWorktree(root: string, path: string, expectedHead: string) {
  const listed = await listGitWorktrees(root);
  const entry = listed.find(w => w.path === path);
  if (!entry || entry.locked || await realpath(root) === await realpath(path)) throw new ApiError(409, "worktree_unavailable", "El trabajo aislado no se puede retirar.");
  const review = await reviewGitWorkspace(path);
  if (review.head !== expectedHead || review.status.length) throw new ApiError(409, "worktree_changed", "El trabajo tiene cambios. Guardalos e integralos antes de retirarlo.");
  try { await git(root, ["merge-base", "--is-ancestor", expectedHead, "HEAD"]); }
  catch { throw new ApiError(409, "worktree_unmerged", "El trabajo contiene commits que todavía no están integrados."); }
  await git(root, ["worktree", "remove", "--", path]);
}

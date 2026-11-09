import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { buildFrontmatter, parseFrontmatter } from "../frontmatter.js";
import { validateDescription } from "../validators.js";
import { specialistDirectory } from "./store.js";
import { sha256, statOrNull } from "./digest.js";
import type { ServerConfig } from "../types.js";

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TEXT_LIMIT = 1_000_000;
const TOP = new Set(["skills", "agents", "commands", "scripts", "references", "templates", "assets", "resources", "tools"]);
const ROOT_FILES = new Set(["AGENTS.md", "README.md"]);
const SKIP = new Set([".git", "node_modules", ".venv", "venv", "__pycache__", ".DS_Store"]);
export const MANIFEST_FILE = ".library.json";

const failure = (message: string) => new ApiError(422, "invalid_library_file", message);
export const libraryRoot = (config: Pick<ServerConfig, "configPath">, id: string) => join(specialistDirectory(config), id, "pack");
export const contextFile = (config: Pick<ServerConfig, "configPath">, id: string) => join(specialistDirectory(config), id, "context.md");

export const libraryName = z.string().trim().min(1).max(64).regex(NAME, "El nombre debe ser kebab-case (letras minúsculas, números y guiones).");
export const agentInput = z.object({ name: libraryName, description: z.string().trim().min(1).max(1024), content: z.string().max(TEXT_LIMIT).optional() });
export const skillInput = z.object({ name: libraryName, description: z.string().trim().min(1).max(1024), content: z.string().max(TEXT_LIMIT).optional() });
export const libraryFileInput = z.object({ path: z.string().trim().min(1).max(4_096), content: z.string().max(TEXT_LIMIT) });
export const contextInput = z.string().trim().max(8_000);

export type LibraryOrigin = "official" | "official-modified" | "custom";
export type LibraryEntry = { path: string; name?: string; bytes: number; updatedAt: number; origin: LibraryOrigin; description?: string };

/** Only paths the library manages: known folders, no traversal, no hidden segments. */
export function safeLibraryPath(value: string): string {
  const path = value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const parts = path.split("/");
  if (!path || parts.some(part => !part || part === "." || part === "..")) throw failure("Ruta inválida dentro de la biblioteca.");
  if (parts.some(part => part.startsWith("."))) throw failure("No se editan archivos ocultos desde la biblioteca.");
  if (parts.length === 1 && ROOT_FILES.has(parts[0]!)) return path;
  if (!TOP.has(parts[0]!)) throw failure("Solo podés editar agentes, skills y recursos del pack (agents/, skills/, scripts/, references/, templates/, assets/, resources/, tools/, commands/).");
  if (parts[0] === "agents" && !(parts.length === 2 && parts[1]!.endsWith(".md") && NAME.test(parts[1]!.slice(0, -3)))) throw failure("Los agentes son agents/nombre.md con nombre kebab-case.");
  if (parts[0] === "skills" && !NAME.test(parts[1]!)) throw failure("La carpeta de la skill debe tener nombre kebab-case.");
  return parts.join("/");
}

async function assertInsideNoSymlink(root: string, relative: string) {
  let cursor = root;
  for (const part of relative.split("/")) {
    cursor = join(cursor, part);
    const stat = await statOrNull(cursor);
    if (stat?.isSymbolicLink()) throw failure(`Hay un enlace simbólico en ${relative}. La biblioteca no puede instalarse ni editarse.`);
  }
  if (resolve(cursor).startsWith(resolve(root) + "/") === false && resolve(cursor) !== resolve(root)) throw failure("La ruta supera los límites de la biblioteca.");
}

function validateEntryContent(path: string, content: string) {
  const agent = path.match(/^agents\/([^/]+)\.md$/);
  const skill = path.match(/^skills\/([^/]+)\/SKILL\.md$/);
  if (!agent && !skill) return;
  if (!content.trim()) throw failure("El archivo no puede quedar vacío.");
  let data: Record<string, unknown>;
  try { ({ data } = parseFrontmatter(content)); }
  catch { throw failure("El encabezado YAML no es válido. Revisá los guiones y las comillas."); }
  const kind = agent ? "agente" : "skill";
  try { validateDescription(typeof data.description === "string" ? data.description : undefined); }
  catch { throw failure(`Revisá la descripción del ${kind} (entre 1 y 1024 caracteres).`); }
  if (skill && data.name !== skill[1]) throw failure("El nombre de la skill debe coincidir con el de su carpeta.");
  if (agent && !["primary", "subagent", "all"].includes(String(data.mode ?? "all"))) throw failure("El modo del agente debe ser primary, subagent o all.");
}

/** Walk the owned library snapshot. Rejects symlinks and validates agent/skill headers like the importer. */
export async function walkLibrary(root: string) {
  const files: Array<{ path: string; data: Buffer; updatedAt: number }> = [];
  let bytes = 0;
  async function walk(prefix: string, depth: number) {
    if (depth > 12) throw failure("La biblioteca tiene demasiados niveles de carpetas.");
    let entries;
    try { entries = await readdir(join(root, prefix), { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      if (entry.name === MANIFEST_FILE || SKIP.has(entry.name) || entry.name.startsWith(".") || /\.py[co]$/i.test(entry.name)) continue;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!prefix && !TOP.has(entry.name) && !ROOT_FILES.has(entry.name)) continue;
      const stat = await assertEntry(join(root, path), path);
      if (stat.isDirectory) { await walk(path, depth + 1); continue; }
      if (files.length >= 2_000 || bytes + stat.size > 50 * 1024 * 1024) throw failure("La biblioteca supera los límites (2.000 archivos / 50 MB).");
      const data = await readFile(join(root, path));
      validateEntryContent(path, data.toString("utf8"));
      bytes += data.byteLength;
      files.push({ path, data, updatedAt: stat.updatedAt });
    }
  }
  await walk("", 0);
  return files;
}

async function assertEntry(path: string, relative: string) {
  const stat = await statOrNull(path);
  if (!stat) throw failure(`Faltó ${relative} durante la lectura.`);
  if (stat.isSymbolicLink()) throw failure(`La biblioteca contiene un enlace simbólico: ${relative}`);
  if (stat.isDirectory()) return { isDirectory: true as const, size: 0, updatedAt: 0 };
  if (!stat.isFile()) throw failure(`Archivo no compatible: ${relative}`);
  return { isDirectory: false as const, size: stat.size, updatedAt: stat.mtimeMs };
}

async function readManifest(root: string): Promise<Record<string, string>> {
  try {
    const value: unknown = JSON.parse(await readFile(join(root, MANIFEST_FILE), "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch { return {}; }
}

export async function writeManifest(root: string, manifest: Record<string, string>) {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, MANIFEST_FILE), JSON.stringify(manifest, null, 0), { mode: 0o600 });
}

function originFor(path: string, data: Uint8Array, manifest: Record<string, string>): LibraryOrigin {
  const original = manifest[path];
  if (original === undefined) return "custom";
  return original === sha256(data) ? "official" : "official-modified";
}

export async function listSpecialistLibrary(config: Pick<ServerConfig, "configPath">, id: string) {
  const root = libraryRoot(config, id);
  const manifest = await readManifest(root);
  const files = await walkLibrary(root);
  const agents: LibraryEntry[] = [];
  const skills = new Map<string, LibraryEntry>();
  const resourceCount = new Map<string, number>();
  const extras: LibraryEntry[] = [];
  for (const file of files) {
    const base: LibraryEntry = { path: file.path, bytes: file.data.byteLength, updatedAt: file.updatedAt, origin: originFor(file.path, file.data, manifest) };
    const agent = file.path.match(/^agents\/([^/]+)\.md$/);
    const skill = file.path.match(/^skills\/([^/]+)\/SKILL\.md$/);
    const skillResource = file.path.match(/^skills\/([^/]+)\//);
    if (agent) {
      const { data } = parseFrontmatter(file.data.toString("utf8"));
      agents.push({ ...base, name: agent[1]!, description: typeof data.description === "string" ? data.description : undefined });
    } else if (skill) {
      const { data } = parseFrontmatter(file.data.toString("utf8"));
      skills.set(skill[1]!, { ...base, name: skill[1]!, description: typeof data.description === "string" ? data.description : undefined });
    } else if (skillResource) {
      const name = skillResource[1]!;
      resourceCount.set(name, (resourceCount.get(name) ?? 0) + 1);
      if (!skills.has(name)) extras.push(base);
    } else extras.push(base);
  }
  const contextStat = await statOrNull(contextFile(config, id));
  return {
    agents: agents.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
    skills: [...skills.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, entry]) => ({ ...entry, resources: resourceCount.get(name) ?? 0, missing: false })),
    files: extras,
    context: { exists: Boolean(contextStat?.isFile()), bytes: contextStat?.isFile() ? contextStat.size : 0 },
    counts: { agents: agents.length, skills: skills.size },
  };
}

export async function readLibraryFile(config: Pick<ServerConfig, "configPath">, id: string, value: string) {
  const path = safeLibraryPath(value);
  const root = libraryRoot(config, id);
  await assertInsideNoSymlink(root, path);
  const stat = await statOrNull(join(root, path));
  if (!stat?.isFile()) throw new ApiError(404, "library_file_not_found", "Ese archivo no está en la biblioteca.");
  if (stat.size > TEXT_LIMIT) throw failure("El archivo supera 1 MB; abrí la carpeta para editarlo aparte.");
  const manifest = await readManifest(root);
  const data = await readFile(join(root, path));
  return { path, content: data.toString("utf8"), bytes: data.byteLength, updatedAt: stat.mtimeMs, origin: originFor(path, data, manifest) };
}

export async function writeLibraryFile(config: Pick<ServerConfig, "configPath">, id: string, value: string, content: string) {
  const path = safeLibraryPath(value);
  validateEntryContent(path, content);
  const root = libraryRoot(config, id);
  await mkdir(root, { recursive: true });
  await assertInsideNoSymlink(root, path);
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, target);
  return readLibraryFile(config, id, path);
}

export async function deleteLibraryFile(config: Pick<ServerConfig, "configPath">, id: string, value: string) {
  const path = safeLibraryPath(value);
  const root = libraryRoot(config, id);
  await assertInsideNoSymlink(root, path);
  const target = join(root, path);
  const stat = await statOrNull(target);
  if (!stat) throw new ApiError(404, "library_file_not_found", "Ese archivo no está en la biblioteca.");
  if (stat.isDirectory()) {
    if (!/^skills\/[^/]+$/.test(path)) throw failure("Solo se eliminan carpetas completas de skills.");
    await rm(target, { recursive: true });
  } else {
    const skillFolder = path.match(/^skills\/([^/]+)\//);
    if (skillFolder) await rm(join(root, "skills", skillFolder[1]!), { recursive: true, force: true });
    else await rm(target);
  }
  const manifest = await readManifest(root);
  const prefix = path.match(/^skills\/[^/]+/)?.[0] ?? path;
  const removed = Object.keys(manifest).filter(key => key === prefix || key.startsWith(`${prefix}/`));
  if (removed.length) { for (const key of removed) delete manifest[key]; await writeManifest(root, manifest); }
  return { deleted: path };
}

const agentTemplate = (name: string, description: string) =>
  buildFrontmatter({ description, mode: "all" })
  + `\nSos el agente "${name}". ${description}\n\n## Tu forma de trabajar\n\n1. Confirmá el objetivo y los datos que faltan antes de empezar; preguntá si hace falta.\n2. Describí acá los pasos concretos que seguís, en orden.\n3. Guardá cada resultado en el proyecto y enlazá los archivos generados.\n\n## Entregables\n\nQué producís y dónde lo guardás.\n`;

const skillTemplate = (name: string, description: string) =>
  buildFrontmatter({ name, description })
  + `\n# ${name}\n\n## Cuándo usar esta skill\n\nSituaciones del trabajo en las que hay que aplicarla.\n\n## Pasos\n\n1. Primer paso concreto.\n2. Segundo paso.\n\n## Entregable\n\nQué archivo o resultado produce y dónde lo guarda.\n`;

export async function createLibraryAgent(config: Pick<ServerConfig, "configPath">, id: string, input: z.infer<typeof agentInput>) {
  const path = `agents/${input.name}.md`;
  if (await statOrNull(join(libraryRoot(config, id), path))) throw new ApiError(409, "library_exists", "Ya existe un agente con ese nombre.");
  const raw = input.content?.trim();
  const content = !raw ? agentTemplate(input.name, input.description)
    : raw.startsWith("---") ? raw : buildFrontmatter({ description: input.description, mode: "all" }) + "\n" + raw + "\n";
  return writeLibraryFile(config, id, path, content);
}

export async function createLibrarySkill(config: Pick<ServerConfig, "configPath">, id: string, input: z.infer<typeof skillInput>) {
  const path = `skills/${input.name}/SKILL.md`;
  if (await statOrNull(join(libraryRoot(config, id), `skills/${input.name}`))) throw new ApiError(409, "library_exists", "Ya existe una skill con ese nombre.");
  const raw = input.content?.trim();
  const content = !raw ? skillTemplate(input.name, input.description)
    : raw.startsWith("---") ? raw : buildFrontmatter({ name: input.name, description: input.description }) + "\n" + raw + "\n";
  return writeLibraryFile(config, id, path, content);
}

export async function readSpecialistContext(config: Pick<ServerConfig, "configPath">, id: string): Promise<string | null> {
  try { return await readFile(contextFile(config, id), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

export async function writeSpecialistContext(config: Pick<ServerConfig, "configPath">, id: string, content: string) {
  const file = contextFile(config, id);
  await mkdir(dirname(file), { recursive: true });
  if (!content.trim()) { await rm(file, { force: true }); return null; }
  await writeFile(file, content, { mode: 0o600 });
  return content;
}

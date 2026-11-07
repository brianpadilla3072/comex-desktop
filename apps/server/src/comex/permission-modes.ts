import { randomUUID, createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { applyEdits, modify, parseTree } from "jsonc-parser";
import { z } from "zod";
import { builtinPermissionProfiles, permissionProfileSchema, profilePermissionRules, type PermissionProfile, type NativePermissionRule } from "@openwork/types/permission-modes";
import { createWorkspaceKvStore } from "../workspace-kv-store.js";
import { readJsoncFile } from "../jsonc.js";
import { ApiError } from "../errors.js";

const rule = z.object({ action: z.string(), resource: z.string(), effect: z.enum(["allow", "ask", "deny"]) }).strict();
const storedSchema = z.object({ revision: z.number().int().nonnegative(), profiles: z.array(permissionProfileSchema).max(50), disabledBuiltinIds: z.array(z.string()).default([]), activeId: z.string().nullable(), baseline: z.array(rule).nullable(), appliedHash: z.string().nullable() });
export type PermissionModesState = z.infer<typeof storedSchema>;
export const permissionModesStore = createWorkspaceKvStore({ tableName: "comex_permission_modes", valueColumn: "value_json", parse: value => storedSchema.parse(JSON.parse(value)), serialize: value => JSON.stringify(value) });
export const emptyPermissionModes = (): PermissionModesState => ({ revision: 0, profiles: [], disabledBuiltinIds: [], activeId: null, baseline: null, appliedHash: null });
export const modeProfiles = (state: PermissionModesState) => [...builtinPermissionProfiles.map(profile => ({ ...profile, enabled: !state.disabledBuiltinIds.includes(profile.id) })), ...state.profiles];
export const permissionHash = (rules: NativePermissionRule[]) => createHash("sha256").update(JSON.stringify(rules)).digest("hex");

async function safeDirectory(root: string, create = false) {
  const directory = join(root, ".opencode");
  try { const st = await lstat(directory); if (!st.isDirectory() || st.isSymbolicLink()) throw new Error("unsafe"); }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") { if (create) await mkdir(directory); } else throw new ApiError(409, "unsafe_mode_path", "La carpeta .opencode no es una carpeta local segura."); }
  return directory;
}
export async function readNativePermissions(root: string) {
  const directory = await safeDirectory(root);
  // Native v2 discovers these files; prefer an existing JSONC document over a new document.
  const jsonc = join(directory, "opencode.jsonc"); const json = join(directory, "opencode.json");
  let path = json;
  try { await lstat(jsonc); path = jsonc; } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  if (path === jsonc) {
    try { await lstat(json); throw new ApiError(409, "mode_config_ambiguous", "Hay dos configuraciones locales de OpenCode. Unificalas antes de cambiar permisos."); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  }
  const { raw, data, invalid } = await readJsoncFile<Record<string, unknown>>(path, {}, { allowInvalid: true, regularFileOnly: true, maxBytes: 1_000_000 });
  const errors: { error: number; offset: number; length: number }[] = [];
  const tree = parseTree(raw || "{}", errors, { allowTrailingComma: true });
  const keys = tree?.children?.map(node => node.children?.[0]?.value) ?? [];
  if (invalid || errors.length || tree?.type !== "object" || new Set(keys).size !== keys.length) throw new ApiError(409, "mode_invalid_config", "El archivo de configuración debe ser JSONC válido, sin claves duplicadas.");
  const rules = z.array(rule).max(5000).safeParse(data.permissions ?? []);
  if (!rules.success) throw new ApiError(409, "mode_invalid_rules", "Los permisos existentes tienen un formato no compatible.");
  return { path, raw: raw || "{}\n", rules: rules.data };
}
/** Preserve existing restrictive rules, and detect concurrent/manual permission edits before replacing a mode. */
export function nextPermissionRules(state: PermissionModesState, current: NativePermissionRule[], profile: PermissionProfile) {
  if (state.appliedHash && state.appliedHash !== permissionHash(current)) throw new ApiError(409, "mode_changed", "Los permisos cambiaron fuera del selector. Revisá la configuración antes de aplicar otro modo.");
  const baseline = state.baseline ?? current;
  return { baseline, rules: [...profilePermissionRules(profile), ...baseline.filter(rule => rule.effect !== "allow")] };
}
export async function writeNativePermissions(current: Awaited<ReturnType<typeof readNativePermissions>>, rules: NativePermissionRule[]) {
  await safeDirectory(dirname(dirname(current.path)), true);
  const content = applyEdits(current.raw, modify(current.raw, ["permissions"], rules, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
  const temp = join(dirname(current.path), `.permission-mode-${randomUUID()}.tmp`);
  const handle = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try { await handle.writeFile(content, "utf8"); await handle.sync(); } finally { await handle.close(); }
  try {
    const latest = await readJsoncFile<unknown>(current.path, {}, { allowInvalid: true, regularFileOnly: true });
    if ((latest.raw || "{}\n") !== current.raw) throw new ApiError(409, "mode_config_changed", "La configuración cambió mientras se guardaba. Volvé a intentar.");
    await rename(temp, current.path);
  } finally { await rm(temp, { force: true }); }
}

/** Native agents can append their own permissions after workspace rules. Refuse unverified or weaker overrides. */
export function agentsRespectMode(rules: NativePermissionRule[], value: unknown): boolean {
  const parsed = z.object({ data: z.array(z.object({ permissions: z.array(rule) }).passthrough()).min(1) }).passthrough().safeParse(value);
  if (!parsed.success || !rules.length) return false;
  for (const agent of parsed.data.data) {
    let end = -1;
    for (let i = 0; i <= agent.permissions.length - rules.length; i++) {
      if (rules.every((rule, offset) => JSON.stringify(rule) === JSON.stringify(agent.permissions[i + offset]))) end = i + rules.length;
    }
    if (end < 0) return false;
    for (const override of agent.permissions.slice(end)) {
      if (override.effect === "deny") continue;
      for (let i = 0; i < rules.length; i++) {
        const requested = rules[i]!;
        if (requested.effect === "allow" || requested.effect === "ask" && override.effect === "ask") continue;
        if (override.action !== "*" && requested.action !== "*" && override.action !== requested.action) continue;
        // A later action-wide rule supersedes the earlier workspace catch-all for that action.
        if (override.action !== "*" && rules.slice(i + 1).some(later => later.resource === "*" && (later.action === "*" || later.action === override.action))) continue;
        // Pattern intersection is deliberately conservative; never call uncertain overrides safe.
        return false;
      }
    }
  }
  return true;
}

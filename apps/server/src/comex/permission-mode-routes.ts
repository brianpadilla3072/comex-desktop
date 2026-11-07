import { randomUUID } from "node:crypto";
import { z } from "zod";
import { permissionProfileInputSchema, type PermissionModesSnapshot } from "@openwork/types/permission-modes";
import { addRoute, type Route, type RequestContext } from "../routes/registry.js";
import { ApiError } from "../errors.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { comexWorkspaceEnabled } from "./features.js";
import { emptyPermissionModes, modeProfiles, nextPermissionRules, permissionHash, permissionModesStore, readNativePermissions, writeNativePermissions } from "./permission-modes.js";

export function registerPermissionModeRoutes(o: {
  routes: Route[]; config: ServerConfig;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
  jsonResponse: (body: unknown, status?: number) => Response;
  authorize: (ctx: RequestContext, workspace: WorkspaceInfo, apply: boolean) => Promise<void>;
  idle: (workspace: WorkspaceInfo) => Promise<void>;
  fence: <T>(workspace: WorkspaceInfo, run: () => Promise<T>) => Promise<T>;
  native: (workspace: WorkspaceInfo, path: string, hash: string, verifyAgents?: boolean) => Promise<boolean>;
  supported: () => boolean;
}) {
  const bodyOf = async <T>(schema: z.ZodType<T>, request: Request): Promise<T> => { const parsed = schema.safeParse(await o.readJsonBody(request)); if (!parsed.success) throw new ApiError(422, "mode_invalid_payload", "Revisá el nombre, los permisos y la revisión del modo."); return parsed.data; };
  const workspace = async (id: string) => {
    if (!comexWorkspaceEnabled()) throw new ApiError(404, "modes_disabled", "Los modos Comex están desactivados.");
    const value = await o.resolveWorkspace(o.config, id);
    if (value.workspaceType !== "local") throw new ApiError(422, "modes_local_required", "Los modos requieren un proyecto local.");
    return value;
  };
  const state = async (w: WorkspaceInfo) => await permissionModesStore.get(o.config, w.id) ?? emptyPermissionModes();
  const snapshot = async (w: WorkspaceInfo): Promise<PermissionModesSnapshot> => {
    const s = await state(w); let reason: string | undefined; let activeId: string | null = null; let pending = false;
    try {
      const current = await readNativePermissions(w.path); const hash = permissionHash(current.rules);
      if (s.appliedHash === hash) { activeId = s.activeId; pending = s.activeId !== null && !await o.native(w, current.path, hash); }
      else if (s.appliedHash) reason = "Los permisos se modificaron fuera del selector. No se reemplazarán automáticamente.";
    } catch (error) { reason = error instanceof Error ? error.message : "No se pudo leer la configuración."; }
    if (!o.supported()) reason = "Se necesita el motor OpenCode v2 conectado para aplicar estos modos.";
    return { profiles: modeProfiles(s), activeId, revision: s.revision, supported: o.supported() && !reason, ...(reason ? { reason } : {}), pending };
  };
  addRoute(o.routes, "GET", "/workspace/:id/permission-modes", "client", async ctx => o.jsonResponse(await snapshot(await workspace(ctx.params.id))));
  addRoute(o.routes, "POST", "/workspace/:id/permission-modes", "client", async ctx => {
    const w = await workspace(ctx.params.id); await o.authorize(ctx, w, false);
    const body = await bodyOf(z.object({ revision: z.number().int().nonnegative(), id: z.string().regex(/^[a-z0-9-]{1,80}$/).optional(), profile: permissionProfileInputSchema }).strict(), ctx.request);
    return o.fence(w, async () => {
      const s = await state(w);
      if (body.revision !== s.revision) throw new ApiError(409, "modes_conflict", "Los modos cambiaron. Volvé a abrir el menú.");
      const original = body.id ? modeProfiles(s).find(p => p.id === body.id) : undefined;
      if (body.id && !original) throw new ApiError(404, "mode_missing", "No existe ese modo.");
      if (original && body.id === s.activeId && (body.profile.name !== original.name || body.profile.description !== original.description || JSON.stringify(body.profile.settings) !== JSON.stringify(original.settings))) throw new ApiError(409, "mode_active", "Elegí otro modo antes de modificar los permisos del modo activo.");
      if (original?.builtin) {
        if (body.profile.name !== original.name || body.profile.description !== original.description || JSON.stringify(body.profile.settings) !== JSON.stringify(original.settings)) throw new ApiError(409, "mode_builtin", "Los permisos iniciales se personalizan duplicando el modo. Podés activar o desactivar su visibilidad.");
        await permissionModesStore.set(o.config, w.id, { ...s, revision: s.revision + 1, disabledBuiltinIds: body.profile.enabled ? s.disabledBuiltinIds.filter(id => id !== original.id) : [...new Set([...s.disabledBuiltinIds, original.id])] });
        return o.jsonResponse(await snapshot(w));
      }
      if (!body.id && s.profiles.length >= 50) throw new ApiError(422, "modes_limit", "Se pueden guardar hasta 50 modos.");
      const profile = { ...body.profile, builtin: false, id: body.id ?? `custom-${randomUUID()}` };
      if (modeProfiles(s).some(p => p.id !== profile.id && p.name.toLocaleLowerCase() === profile.name.toLocaleLowerCase())) throw new ApiError(409, "mode_name_exists", "Ya existe un modo con ese nombre.");
      await permissionModesStore.set(o.config, w.id, { ...s, revision: s.revision + 1, profiles: [...s.profiles.filter(p => p.id !== profile.id), profile] });
      return o.jsonResponse(await snapshot(w));
    });
  });
  addRoute(o.routes, "DELETE", "/workspace/:id/permission-modes/:profile", "client", async ctx => {
    const w = await workspace(ctx.params.id); await o.authorize(ctx, w, false);
    const body = await bodyOf(z.object({ revision: z.number().int().nonnegative() }).strict(), ctx.request);
    return o.fence(w, async () => {
      const s = await state(w);
      if (s.revision !== body.revision) throw new ApiError(409, "modes_conflict", "Los modos cambiaron. Volvé a abrir el menú.");
      if (!s.profiles.some(p => p.id === ctx.params.profile) || s.activeId === ctx.params.profile) throw new ApiError(409, "mode_not_removable", "Los modos iniciales y el modo activo no se pueden eliminar.");
      await permissionModesStore.set(o.config, w.id, { ...s, revision: s.revision + 1, profiles: s.profiles.filter(p => p.id !== ctx.params.profile) });
      return o.jsonResponse(await snapshot(w));
    });
  });
  addRoute(o.routes, "PUT", "/workspace/:id/permission-modes/active", "client", async ctx => {
    const w = await workspace(ctx.params.id);
    const body = await bodyOf(z.object({ revision: z.number().int().nonnegative(), id: z.string().nullable(), confirmed: z.literal(true) }).strict(), ctx.request);
    if (!o.supported()) throw new ApiError(409, "modes_engine_required", "El motor v2 debe estar conectado.");
    await o.idle(w); await o.authorize(ctx, w, true);
    return o.fence(w, async () => {
      await o.idle(w); const s = await state(w);
      if (s.revision !== body.revision) throw new ApiError(409, "modes_conflict", "Los modos cambiaron. Volvé a abrir el menú.");
      const restoring = body.id === null;
      const profile = restoring ? null : modeProfiles(s).find(p => p.id === body.id);
      if (profile && !profile.enabled) throw new ApiError(409, "mode_disabled", "Este modo está desactivado. Habilitalo desde Personalizar modos antes de usarlo.");
      if (!restoring && !profile) throw new ApiError(404, "mode_missing", "No existe ese modo.");
      if (restoring && (!s.activeId || s.baseline === null)) return o.jsonResponse(await snapshot(w));
      const current = await readNativePermissions(w.path);
      if (s.appliedHash && s.appliedHash !== permissionHash(current.rules)) throw new ApiError(409, "mode_changed", "Los permisos cambiaron fuera del selector. No se reemplazarán esos cambios.");
      const next = profile ? nextPermissionRules(s, current.rules, profile) : { baseline: null, rules: s.baseline ?? [] };
      await writeNativePermissions(current, next.rules);
      let verified = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        if (await o.native(w, current.path, permissionHash(next.rules), !restoring)) { verified = true; break; }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      if (!verified) {
        const latest = await readNativePermissions(w.path);
        if (permissionHash(latest.rules) !== permissionHash(next.rules)) throw new ApiError(409, "mode_changed_during_apply", "Los permisos cambiaron durante la verificación. No se reemplazaron esos cambios; revisá la configuración.");
        await writeNativePermissions(latest, current.rules);
        throw new ApiError(409, "mode_not_verified", "El motor no confirmó el modo o hay agentes con permisos propios que lo contradicen. Se restauraron los permisos anteriores; revisá esos agentes antes de volver a intentar.");
      }
      try {
        await permissionModesStore.set(o.config, w.id, { ...s, revision: s.revision + 1, baseline: next.baseline, activeId: profile?.id ?? null, appliedHash: restoring ? null : permissionHash(next.rules) });
      } catch {
        const latest = await readNativePermissions(w.path);
        if (permissionHash(latest.rules) === permissionHash(next.rules)) await writeNativePermissions(latest, current.rules);
        throw new ApiError(503, "mode_state_failed", "No se pudo guardar el estado del modo. Revisá la configuración antes de continuar.");
      }
      return o.jsonResponse(await snapshot(w));
    });
  });
}

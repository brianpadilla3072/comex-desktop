import { z } from "zod";
export const permissionEffectSchema = z.enum(["allow", "ask", "deny"]);
export const permissionSettingsSchema = z.object({ read: permissionEffectSchema, edit: permissionEffectSchema, shell: permissionEffectSchema, web: permissionEffectSchema, external: permissionEffectSchema }).strict();
export const permissionProfileInputSchema = z.object({ name: z.string().trim().min(1).max(60), description: z.string().trim().max(240), settings: permissionSettingsSchema, enabled: z.boolean().default(true) }).strict();
export const permissionProfileSchema = permissionProfileInputSchema.extend({ id: z.string().regex(/^[a-z0-9-]{1,80}$/), builtin: z.boolean() });
export type PermissionProfile = z.infer<typeof permissionProfileSchema>;
export type PermissionProfileInput = z.infer<typeof permissionProfileInputSchema>;
export type PermissionSettings = z.infer<typeof permissionSettingsSchema>;
export type NativePermissionRule = { action: string; resource: string; effect: "allow" | "ask" | "deny" };
export type PermissionModesSnapshot = { profiles: PermissionProfile[]; activeId: string | null; revision: number; supported: boolean; reason?: string; pending: boolean };
export const builtinPermissionProfiles: PermissionProfile[] = [
  { id: "approve", builtin: true, enabled: true, name: "Solicitar aprobación", description: "Pedir aprobación antes de modificar archivos, ejecutar comandos o usar Internet.", settings: { read: "allow", edit: "ask", shell: "ask", web: "ask", external: "ask" } },
  { id: "auto", builtin: true, enabled: true, name: "Aprobar automáticamente", description: "Permitir archivos del proyecto e Internet; preguntar por comandos, archivos sensibles y accesos externos.", settings: { read: "allow", edit: "allow", shell: "ask", web: "allow", external: "ask" } },
  { id: "full", builtin: true, enabled: true, name: "Acceso completo", description: "Permitir acciones sin confirmaciones adicionales, respetando las restricciones existentes.", settings: { read: "allow", edit: "allow", shell: "allow", web: "allow", external: "allow" } },
];
/** Unknown tools/services still ask in custom modes. Permissions do not configure model intelligence. */
export function profilePermissionRules(profile: PermissionProfile): NativePermissionRule[] {
  if (profile.builtin && profile.id === "full") return [{ action: "*", resource: "*", effect: "allow" }];
  const s = profile.settings;
  return [
    { action: "*", resource: "*", effect: "ask" },
    ...["read", "list", "glob", "grep"].map(action => ({ action, resource: "*", effect: s.read })),
    { action: "edit", resource: "*", effect: s.edit }, { action: "shell", resource: "*", effect: s.shell },
    ...["webfetch", "websearch"].map(action => ({ action, resource: "*", effect: s.web })),
    { action: "external_directory", resource: "*", effect: s.external },
    { action: "read", resource: "*.env", effect: s.read === "allow" ? "ask" : s.read }, { action: "read", resource: "*.env.*", effect: s.read === "allow" ? "ask" : s.read },
    { action: "question", resource: "*", effect: "allow" },
  ];
}

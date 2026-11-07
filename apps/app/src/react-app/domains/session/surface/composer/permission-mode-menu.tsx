import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Check, Hand, ShieldCheck, ShieldAlert, Plus, Settings2, Power } from "lucide-react";
import type { PermissionProfile, PermissionSettings, PermissionModesSnapshot } from "@openwork/types/permission-modes";
import { permissionEffectSchema } from "@openwork/types/permission-modes";
import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";

const categories: { key: keyof PermissionSettings; label: string }[] = [{ key: "read", label: "Leer archivos del proyecto" }, { key: "edit", label: "Crear y modificar archivos" }, { key: "shell", label: "Ejecutar comandos" }, { key: "web", label: "Buscar y consultar Internet" }, { key: "external", label: "Acceder a archivos externos" }];
const effectLabels = { allow: "Permitir", ask: "Preguntar", deny: "Bloquear" };
const investigate: PermissionSettings = { read: "allow", edit: "deny", shell: "ask", web: "allow", external: "ask" };
export function PermissionModeMenu({ client, workspaceId, busy }: { client: OpenworkServerClient; workspaceId: string; busy: boolean }) {
  const cache = useQueryClient(); const key = ["permission-modes", client.baseUrl, workspaceId];
  const query = useQuery({ queryKey: key, queryFn: () => client.getPermissionModes(workspaceId), refetchInterval: 15_000, retry: 1 });
  const [open, setOpen] = useState(false); const [manage, setManage] = useState(false);
  const [editor, setEditor] = useState(false); const [editing, setEditing] = useState<string | undefined>();
  const [enabled, setEnabled] = useState(true);
  const [name, setName] = useState(""); const [description, setDescription] = useState(""); const [settings, setSettings] = useState<PermissionSettings>(investigate);
  const [removing, setRemoving] = useState<PermissionProfile | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  const [confirm, setConfirm] = useState<PermissionProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({ mutationFn: async (job: () => Promise<PermissionModesSnapshot>) => job(), onSuccess: value => { cache.setQueryData(key, value); setError(null); setEditor(false); setConfirm(null); setRemoving(null); setDeactivating(false); }, onError: (e: Error) => { setError(e.message); void query.refetch(); } });
  const active = query.data?.profiles.find(p => p.id === query.data.activeId);
  const Icon = active?.id === "full" ? ShieldAlert : active?.id === "approve" ? Hand : ShieldCheck;
  const locked = busy || mutation.isPending || !query.data?.supported;
  const editingProfile = query.data?.profiles.find(profile => profile.id === editing);
  const editingActive = Boolean(editing && active?.id === editing);
  const fixedFields = editingProfile?.builtin || editingActive;
  const edit = (profile?: PermissionProfile, duplicate = false) => { setEditing(profile && !duplicate ? profile.id : undefined); setEnabled(duplicate ? true : profile?.enabled !== false); setName(profile ? duplicate ? `${profile.name} personalizado` : profile.name : "Investigar"); setDescription(profile?.description ?? "Consultar fuentes sin modificar los archivos del proyecto."); setSettings(profile?.settings ?? { ...investigate }); setError(null); setManage(false); setOpen(false); setEditor(true); };
  return <>
    <DropdownMenu open={open} onOpenChange={value => { setOpen(value); if (value) void query.refetch(); }}>
      <DropdownMenuTrigger aria-label="Elegir modo de permisos" className="inline-flex h-9 max-w-60 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-sm text-muted-foreground hover:text-foreground">
        <Icon className={`size-4 shrink-0 ${active?.id === "full" ? "text-orange-500" : ""}`} /><span className="hidden truncate @min-[560px]/composer:block">{query.isError ? "Permisos no disponibles" : query.isPending ? "Consultar permisos" : active?.name ?? "Sin modo activo"}{query.data?.pending ? " (pendiente)" : ""}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-[min(420px,calc(100vw-24px))] p-2">
        <DropdownMenuGroup><DropdownMenuLabel>¿Cómo deben aprobarse las acciones?</DropdownMenuLabel>
        {query.data?.profiles.filter(profile => profile.enabled !== false).map(profile => <DropdownMenuItem key={profile.id} disabled={locked} className="items-start gap-2 py-2" onClick={() => { setOpen(false); setError(null); setConfirm(profile); }}>
          {profile.id === "full" ? <ShieldAlert className="mt-0.5 size-4 text-orange-500" /> : profile.id === "approve" ? <Hand className="mt-0.5 size-4" /> : <ShieldCheck className="mt-0.5 size-4" />}
          <span className="min-w-0 flex-1"><span className={`block ${profile.id === "full" ? "text-orange-500" : ""}`}>{profile.name}</span><span className="block text-xs text-muted-foreground">{profile.description}</span></span>{active?.id === profile.id && <Check className="size-4" />}
        </DropdownMenuItem>)}
        {query.data?.pending && <p role="status" className="px-2 py-1 text-xs text-muted-foreground">Guardado; el motor aún no confirmó la configuración. No asumas que el modo ya está activo.</p>}
        {busy && <p role="status" className="px-2 py-1 text-xs text-muted-foreground">Esperá a que terminen todas las tareas para cambiar permisos.</p>}
        {query.data?.reason && <p role="status" className="px-2 py-1 text-xs text-muted-foreground">{query.data.reason}</p>}
        {query.isError && <p role="alert" className="px-2 text-xs">No se pudo actualizar la lista. Volvé a abrir el menú para reintentar.</p>}
        </DropdownMenuGroup><DropdownMenuSeparator />
<DropdownMenuItem disabled={!query.data} onClick={() => { setOpen(false); setManage(true); }}><Settings2 className="size-4" />Personalizar modos</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <Dialog open={manage} onOpenChange={setManage}><DialogContent aria-describedby={undefined} className="max-h-[85dvh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>Personalizar modos</DialogTitle></DialogHeader>
      <div className="divide-y divide-border">{query.data?.profiles.map(profile => <div key={profile.id} className="flex min-h-12 items-center justify-between gap-3 py-2"><div className="min-w-0"><span className="block truncate text-sm">{profile.name}</span><span className="text-xs text-muted-foreground">{profile.enabled === false ? "Desactivado" : active?.id === profile.id ? "En uso" : profile.builtin ? "Predeterminado" : "Personalizado"}</span></div><Button variant="ghost" size="sm" disabled={mutation.isPending} onClick={() => edit(profile)}>Editar</Button></div>)}</div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button disabled={query.isPending || query.isError || mutation.isPending} onClick={() => edit()}><Plus className="size-4" />Crear modo personalizado</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={editor} onOpenChange={value => { if (!mutation.isPending) setEditor(value); }}><DialogContent aria-describedby={undefined} className="max-h-[85dvh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>{editing ? "Editar modo de permisos" : "Crear modo de permisos"}</DialogTitle></DialogHeader>
      <div className="space-y-4"><div className="flex items-center justify-between gap-3"><Label htmlFor="permission-mode-enabled">Modo habilitado</Label><Switch id="permission-mode-enabled" checked={enabled} disabled={mutation.isPending} onCheckedChange={setEnabled} /></div>
      <p className="text-xs text-muted-foreground">{enabled ? "Visible en el selector de modos." : "Oculto del selector; se conserva en Personalizar modos."}</p>
      {editingActive && <div className="space-y-2"><p className="text-xs text-muted-foreground">Este modo está en uso. Ocultarlo del selector conserva los permisos actuales.</p><Button variant="outline" size="sm" disabled={locked} onClick={() => { setEditor(false); setError(null); setDeactivating(true); }}><Power className="size-4" />Desactivar modo activo</Button></div>}
      {editingProfile?.builtin && <p className="text-xs text-muted-foreground">Podés habilitar o desactivar este modo inicial. Para cambiar sus permisos, duplicalo.</p>}
      <div className="space-y-1"><Label htmlFor="permission-mode-name">Nombre</Label><Input disabled={fixedFields} id="permission-mode-name" maxLength={60} value={name} onChange={event => setName(event.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="permission-mode-description">Descripción</Label><Textarea disabled={fixedFields} id="permission-mode-description" maxLength={240} value={description} onChange={event => setDescription(event.target.value)} /></div>
      {categories.map(category => <div key={category.key} className="flex items-center justify-between gap-3"><Label>{category.label}</Label><Select disabled={fixedFields} value={settings[category.key]} onValueChange={value => { const effect = permissionEffectSchema.safeParse(value); if (effect.success) setSettings(previous => ({ ...previous, [category.key]: effect.data })); }}><SelectTrigger aria-label={category.label} className="w-32"><SelectValue>{effectLabels[settings[category.key]]}</SelectValue></SelectTrigger><SelectContent>{Object.entries(effectLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>)}
      <p className="text-xs text-muted-foreground">Las herramientas no contempladas piden aprobación. Permitir Internet también permite enviar datos en esas consultas. Los comandos y conexiones pueden tener efectos adicionales.</p></div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {editingProfile && <div className="flex justify-start border-t border-border pt-3">{editingProfile.builtin ? <Button variant="ghost" size="sm" disabled={mutation.isPending} onClick={() => edit(editingProfile, true)}>Duplicar modo</Button> : <Button variant="ghost" size="sm" disabled={editingActive || mutation.isPending} onClick={() => { setEditor(false); setError(null); setRemoving(editingProfile); }}>Eliminar modo</Button>}</div>}
      <DialogFooter><Button variant="ghost" disabled={mutation.isPending} onClick={() => { setEditor(false); setManage(true); }}>Cancelar</Button><Button disabled={!name.trim() || mutation.isPending || !query.data} onClick={() => { if (query.data) mutation.mutate(() => client.savePermissionMode(workspaceId, query.data.revision, { name: name.trim(), description: description.trim(), settings, enabled }, editing)); }}>{mutation.isPending ? "Guardando…" : "Guardar modo"}</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={Boolean(removing)} onOpenChange={value => { if (!value && !mutation.isPending) setRemoving(null); }}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Eliminar {removing?.name}</DialogTitle><DialogDescription>Se eliminará este modo personalizado del proyecto. Los permisos activos no cambian.</DialogDescription></DialogHeader>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button variant="ghost" disabled={mutation.isPending} onClick={() => { setRemoving(null); setManage(true); }}>Cancelar</Button><Button variant="destructive" disabled={mutation.isPending} onClick={() => { if (query.data && removing) mutation.mutate(() => client.deletePermissionMode(workspaceId, query.data.revision, removing.id)); }}>Eliminar modo</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={deactivating} onOpenChange={value => { if (!mutation.isPending) setDeactivating(value); }}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Desactivar modo de permisos</DialogTitle><DialogDescription>Se restaurarán los permisos que tenía este proyecto antes de activar un modo. Pueden ser más o menos restrictivos que los actuales. Tus modos guardados se conservan.</DialogDescription></DialogHeader>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button variant="ghost" disabled={mutation.isPending} onClick={() => setDeactivating(false)}>Cancelar</Button><Button disabled={locked} onClick={() => { if (query.data) mutation.mutate(() => client.applyPermissionMode(workspaceId, query.data.revision, null)); }}>{mutation.isPending ? "Desactivando…" : "Desactivar y restaurar permisos"}</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={Boolean(confirm)} onOpenChange={value => { if (!value && !mutation.isPending) setConfirm(null); }}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Aplicar {confirm?.name}</DialogTitle><DialogDescription>Cambia los permisos de todas las conversaciones de este proyecto. Se conservan las restricciones existentes del motor y del administrador.</DialogDescription></DialogHeader>
      {confirm && <dl className="space-y-2 text-sm">{categories.map(category => <div key={category.key} className="flex justify-between gap-3"><dt>{category.label}</dt><dd>{effectLabels[confirm.settings[category.key]]}</dd></div>)}</dl>}
      {confirm?.id === "full" && <p className="text-sm text-orange-500">Puede editar o eliminar archivos, ejecutar comandos y acceder a Internet y carpetas externas sin confirmaciones adicionales.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button variant="ghost" disabled={mutation.isPending} onClick={() => setConfirm(null)}>Cancelar</Button><Button disabled={locked} onClick={() => { if (query.data && confirm) mutation.mutate(() => client.applyPermissionMode(workspaceId, query.data.revision, confirm.id)); }}>{mutation.isPending ? "Aplicando…" : "Aplicar al proyecto"}</Button></DialogFooter>
    </DialogContent></Dialog>
  </>;
}

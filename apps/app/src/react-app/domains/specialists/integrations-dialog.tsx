/** @jsxImportSource react */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { openDesktopUrl, pickDirectory } from "@/app/lib/desktop";
import { isDesktopRuntime } from "@/app/utils";
import type { OpenworkServerClient, SpecialistApplication, SpecialistPackReview } from "@/app/lib/openwork-server";

export function SpecialistIntegrationsDialog({ app, client, onClose, onChanged }: { app: SpecialistApplication; client: OpenworkServerClient; onClose(): void; onChanged(): Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [packPath, setPackPath] = useState("");
  const [destination, setDestination] = useState("");
  const [review, setReview] = useState<SpecialistPackReview | null>(null);
  const query = useQuery({ queryKey: ["specialist-integrations", client.baseUrl, app.id], queryFn: () => client.getSpecialistIntegrations(app.id), refetchInterval: 5_000, retry: false });
  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try { await action(); await query.refetch(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo completar la operación. Volvé a intentar."); }
    finally { setBusy(false); }
  }
  async function providerAction(id: string, action: "install" | "login" | "disconnect" | "test" | "key" | "enable", enabled?: boolean) {
    await perform(async () => {
      const result = await client.specialistIntegrationAction(app.id, id, { action, enabled, ...(action === "key" ? { apiKey } : {}) });
      if (action === "key") setApiKey("");
      if (result.authorizationUrl) { await openDesktopUrl(result.authorizationUrl); setNotice("Completá el acceso a Tavily en el navegador. La conexión se actualiza al volver."); }
      else if (result.verifiedAt) setNotice(`Búsqueda verificada: ${result.sources?.length ?? 0} fuente encontrada.`);
      else if (action === "install") setNotice("Tavily preparado. Ya podés conectar tu cuenta.");
    });
  }
  async function pick(kind: "pack" | "export") {
    await perform(async () => { const folder = await pickDirectory({ title: kind === "pack" ? "Pack o perfil OCX" : "Carpeta para exportar el perfil" }); if (typeof folder === "string" && folder) { if (kind === "pack") { setPackPath(folder); setReview(null); } else setDestination(folder); } });
  }
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto lg:max-w-2xl">
      <DialogHeader><DialogTitle>Herramientas y fuentes de {app.name}</DialogTitle></DialogHeader>
      {query.isPending ? <div className="grid gap-3"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div> : null}
      {query.isError ? <p role="alert" className="text-sm text-destructive">No se pudo consultar la conexión. <Button variant="link" onClick={() => void query.refetch()}>Volver a intentar</Button></p> : null}
      {query.data?.providers.map(provider => <section key={provider.id} className="grid gap-3 border-b pb-4">
        <div className="flex items-center justify-between gap-3">
          <div><p className="font-medium">{provider.label}</p><p className="text-xs text-muted-foreground">{!provider.installed ? "Herramienta pendiente" : provider.authenticated ? "Cuenta conectada" : provider.loginPending ? "Esperando acceso en el navegador" : "Cuenta pendiente"}</p></div>
          <div className="flex items-center gap-2"><Label htmlFor={`research-${provider.id}`}>Usar en este perfil</Label><Switch id={`research-${provider.id}`} checked={provider.enabled} disabled={busy} onCheckedChange={enabled => void providerAction(provider.id, "enable", enabled)} /></div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!provider.installed ? <Button disabled={busy} onClick={() => void providerAction(provider.id, "install")}>Preparar {provider.label}</Button>
            : <><Button disabled={busy} onClick={() => void providerAction(provider.id, provider.authenticated ? "test" : "login")}>{provider.authenticated ? "Probar búsqueda" : provider.loginPending ? "Abrir acceso" : `Conectar ${provider.label}`}</Button>{provider.authenticated || provider.loginPending ? <Button disabled={busy} variant="ghost" onClick={() => void providerAction(provider.id, "disconnect")}>Desconectar</Button> : null}</>}
        </div>
        {provider.installed && !provider.authenticated ? <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Usar una clave de API</summary><form className="mt-3 flex gap-2" onSubmit={event => { event.preventDefault(); void providerAction(provider.id, "key"); }}><Input type="password" aria-label={`Clave de ${provider.label}`} autoComplete="off" value={apiKey} onChange={event => setApiKey(event.target.value)} /><Button type="submit" disabled={busy || !apiKey.trim()}>Guardar conexión</Button></form></details> : null}
        <p className="text-xs text-muted-foreground">Las consultas usan la cuenta y los créditos de {provider.label}. Las cifras y citas requieren verificación.</p>
        {provider.error && provider.installed ? <p role="status" className="text-xs text-muted-foreground">{provider.error}</p> : null}
      </section>)}
      <section className="grid gap-3 border-b pb-4">
        <Label htmlFor="specialist-update-pack">Actualizar agentes y skills desde una carpeta o perfil OCX</Label>
        <div className="flex gap-2"><Input id="specialist-update-pack" value={packPath} onChange={event => { setPackPath(event.target.value); setReview(null); }} placeholder="Ruta del pack o perfil OCX" />{isDesktopRuntime() ? <Button variant="outline" disabled={busy} onClick={() => void pick("pack")}>Elegir carpeta</Button> : null}</div>
        <Button variant="outline" className="justify-self-start" disabled={busy || !packPath} onClick={() => void perform(async () => setReview(await client.previewSpecialistPackUpdate(app.id, packPath)))}>Revisar cambios</Button>
        {review ? <div className="grid gap-2 text-sm">
          <p role="status">{review.changes.length} archivos con cambios · {review.conflicts.length} cambios locales se conservarán</p>
          <details><summary className="cursor-pointer text-muted-foreground">Ver archivos</summary><ul className="mt-2 grid gap-1 text-xs">{review.changes.map(change => <li key={change.path}>{change.action === "add" ? "Agregar" : change.action === "remove" ? "Retirar" : "Actualizar"}: {change.path}</li>)}{review.conflicts.map(conflict => <li key={`${conflict.workspaceId}:${conflict.path}`}>Conservar edición local: {conflict.path}</li>)}</ul></details>
          <Button className="justify-self-start" disabled={busy || !review.changes.length} onClick={() => void perform(async () => { const result = await client.updateSpecialistPack(app.id, packPath, review.fingerprint); setReview(null); setNotice(`Pack actualizado: ${result.applied} archivos aplicados; ${result.preserved.length} ediciones locales conservadas.`); await onChanged(); })}>Actualizar pack</Button>
        </div> : null}
      </section>
      <section className="grid gap-3">
        <Label htmlFor="specialist-export-pack">Exportar perfil portable</Label>
        <div className="flex gap-2"><Input id="specialist-export-pack" value={destination} onChange={event => setDestination(event.target.value)} placeholder="Carpeta de destino" />{isDesktopRuntime() ? <Button variant="outline" disabled={busy} onClick={() => void pick("export")}>Elegir destino</Button> : null}</div>
        <Button variant="outline" className="justify-self-start" disabled={busy || !destination} onClick={() => void perform(async () => { const result = await client.exportSpecialistOcx(app.id, destination); setNotice(`Perfil exportado: ${result.folderPath}`); })}>Exportar perfil</Button>
        <p className="text-xs text-muted-foreground">Incluye agentes, skills y personalidad en formato portable y OCX 3. Las cuentas y conversaciones quedan en tu equipo.</p>
      </section>
      {busy ? <p role="status" className="text-xs text-muted-foreground">Operación en curso</p> : null}
      {notice ? <p role="status" className="break-words text-sm">{notice}</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </DialogContent>
  </Dialog>;
}

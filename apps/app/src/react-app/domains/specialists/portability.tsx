/** @jsxImportSource react */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { OpenworkServerClient, SpecialistApplication } from "@/app/lib/openwork-server";
import { specialistErrorMessage } from "./error-message";

/** File name for an exported application: readable, safe on every OS, recognizable on import. */
export function bundleFileName(name: string, date = new Date()) {
  const slug = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "aplicacion";
  return `${slug}-${date.toISOString().slice(0, 10)}.openwork-app.json`;
}

/** Download the application as a JSON bundle (see docs/features/specialist-app-portability). */
export async function downloadApplicationBundle(client: OpenworkServerClient, app: SpecialistApplication) {
  const bundle = await client.exportSpecialistApplication(app.id);
  const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = bundleFileName(app.name);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Ask for a bundle file and parse it. Resolves to null when the person cancels. */
export function pickBundleFile(): Promise<unknown | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      file.text().then(text => {
        try { resolve(JSON.parse(text)); }
        catch { reject(new Error("El archivo no es un JSON válido.")); }
      }, () => reject(new Error("No se pudo leer el archivo.")));
    });
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

/** Summary shown after an import: what was skipped and what needs a look. */
export function importNotice(result: { skippedSections: string[]; warnings: string[] }) {
  const parts = [...result.warnings];
  if (result.skippedSections.length) parts.push(`Se omitieron partes que esta versión no reconoce: ${result.skippedSections.join(", ")}.`);
  return parts.join(" ");
}

export function DeleteApplicationDialog({ app, client, onClose, onDeleted }: {
  app: SpecialistApplication;
  client: OpenworkServerClient;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState(false);
  async function exportFirst() {
    setBusy(true); setError(null);
    try { await downloadApplicationBundle(client, app); setExported(true); }
    catch (cause) { setError(specialistErrorMessage(cause, "No se pudo exportar la aplicación.")); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError(null);
    try { await client.deleteSpecialistApplication(app.id); await onDeleted(); }
    catch (cause) { setError(specialistErrorMessage(cause, "No se pudo eliminar la aplicación.")); setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="gap-4 lg:max-w-lg">
      <DialogHeader>
        <DialogTitle>Eliminar {app.name}</DialogTitle>
        <DialogDescription>
          Se borran su biblioteca, su contexto, sus tareas y los proyectos creados dentro de la aplicación, con su memoria y sus notas de sesión. Las carpetas que agregaste desde otro lugar conservan todos sus archivos.
        </DialogDescription>
      </DialogHeader>
      <p className="text-sm text-muted-foreground">{exported ? "Exportaste una copia. Podés importarla en esta u otra computadora." : "Si querés conservarla, exportá una copia antes de eliminarla."}</p>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button type="button" variant="outline" onClick={() => void exportFirst()} disabled={busy}>Exportar copia</Button>
        <Button type="button" variant="destructive" onClick={() => void remove()} disabled={busy}>Eliminar aplicación</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

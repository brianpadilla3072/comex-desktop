/** @jsxImportSource react */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { OpenworkServerClient, SpecialistApplication } from "@/app/lib/openwork-server";
import { t } from "@/i18n";
import { specialistErrorMessage } from "./error-message";

/** File name for an exported application: readable, safe on every OS, recognizable on import. */
export function bundleFileName(name: string, date = new Date()) {
  const slug = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "aplicacion";
  return `${slug}-${date.toISOString().slice(0, 10)}.openwork-app.json`;
}

/** `<Nombre>.owapp`: the application's own name, minus characters no file system accepts
 *  (same rule as the server's Content-Disposition; feature: specialistAppZipBundle). */
export function archiveFileName(name: string) {
  const clean = name.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 80);
  return `${clean || "aplicacion"}.owapp`;
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Download the application: a `.owapp` archive with the project's work files when `zip` is on,
 *  otherwise the v1 JSON bundle (see docs/features/specialist-app-portability). */
export async function downloadApplicationBundle(client: OpenworkServerClient, app: SpecialistApplication, options: { zip?: boolean } = {}) {
  if (options.zip) {
    saveBlob(await client.exportSpecialistApplicationArchive(app.id), archiveFileName(app.name));
    return;
  }
  const bundle = await client.exportSpecialistApplication(app.id);
  saveBlob(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }), bundleFileName(app.name));
}

export type PickedBundle = { kind: "archive"; file: Blob } | { kind: "json"; bundle: unknown };

/** A ZIP starts with a local file header (or an empty archive's end record). */
export async function isZipFile(file: Blob) {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b && ((head[2] === 0x03 && head[3] === 0x04) || (head[2] === 0x05 && head[3] === 0x06));
}

/** Read a picked file: an archive is uploaded as is (never read into memory here), a JSON
 *  bundle is parsed. The content decides, not the extension. */
export async function readBundleFile(file: Blob, options: { archives: boolean }): Promise<PickedBundle> {
  if (await isZipFile(file)) {
    if (!options.archives) throw new Error(t("specialist_zip.archive_disabled"));
    return { kind: "archive", file };
  }
  let text: string;
  try { text = await file.text(); }
  catch { throw new Error(t("specialist_zip.read_failed")); }
  try { return { kind: "json", bundle: JSON.parse(text) }; }
  catch { throw new Error(t(options.archives ? "specialist_zip.invalid_file" : "specialist_zip.invalid_json")); }
}

/** Ask for a bundle file. Resolves to null when the person cancels. */
export function pickBundleFile(options: { archives: boolean } = { archives: false }): Promise<PickedBundle | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = options.archives ? ".owapp,.zip,.json,application/zip,application/json" : ".json,application/json";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      readBundleFile(file, options).then(resolve, reject);
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

export function DeleteApplicationDialog({ app, client, zip, onClose, onDeleted }: {
  app: SpecialistApplication;
  client: OpenworkServerClient;
  /** Export as a `.owapp` archive (feature: specialistAppZipBundle). */
  zip?: boolean;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState(false);
  async function exportFirst() {
    setBusy(true); setError(null);
    try { await downloadApplicationBundle(client, app, { zip }); setExported(true); }
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

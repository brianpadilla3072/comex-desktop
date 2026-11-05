/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { docxPreviewDocument } from "./docx-preview-document";
import { PreviewError, PreviewLoading } from "./preview";

export function DocxPreview({ data, name }: { data: ArrayBuffer; name: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [fit, setFit] = useState(true);
  const [result, setResult] = useState<{ owner: ArrayBuffer; html?: string; pageWidth?: number; error?: string } | null>(null);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(entries => { const entry = entries[0]; if (entry) setWidth(entry.contentRect.width); });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let current = true;
    void docxPreviewDocument(data).then(
      value => { if (current) setResult({ owner: data, ...value }); },
      () => { if (current) setResult({ owner: data, error: "No pude mostrar este Word. Puede estar protegido, dañado o superar los límites del visor. Podés descargarlo y abrirlo con Word." }); },
    );
    return () => { current = false; };
  }, [data]);
  const scale = fit && width ? Math.max(0.15, Math.min(1, width / (result?.pageWidth ?? 826))) : 1;
  const html = result?.html?.replace("<style>", `<style>.docx-wrapper{zoom:${scale}}`);
  return <div ref={container} className="flex h-full min-h-0 flex-col" data-testid="docx-preview">
    {result?.owner !== data ? <PreviewLoading aria-label="Abriendo documento de Word" /> : result.error ? <PreviewError role="alert" message={result.error} /> : <>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <span className="min-w-0 flex-1 text-xs text-muted-foreground">Vista de lectura</span>
        <Button variant={fit ? "secondary" : "ghost"} size="xs" aria-pressed={fit} onClick={() => setFit(true)}>Ajustar ancho</Button>
        <Button variant={!fit ? "secondary" : "ghost"} size="xs" aria-pressed={!fit} onClick={() => setFit(false)}>100 %</Button>
      </div>
      <iframe title={name} srcDoc={html} sandbox="" referrerPolicy="no-referrer" className="min-h-0 w-full flex-1 border-0" />
      <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">Para editar, abrí el archivo en Word. La paginación puede variar.</p>
    </>}
  </div>;
}

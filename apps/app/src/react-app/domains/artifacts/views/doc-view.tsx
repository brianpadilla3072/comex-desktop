/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Copy, Download, Eye, ListTree, Maximize2, Minimize2, Moon, Pencil, RotateCcw, Search, Sun, WrapText, ZoomIn, ZoomOut,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MarkdownBlock } from "../../session/surface/markdown";
import type { ArtifactMetadata } from "../types";
import { mdxToMarkdown } from "./mdx-to-markdown";

type ViewerState = NonNullable<ArtifactMetadata["viewer"]>;
type DocViewProps = {
  content: string;
  format?: "md" | "mdx";
  viewer?: ViewerState;
  title?: string;
  onContentChange?: (content: string) => void;
  onViewerChange?: (patch: ViewerState) => void;
  className?: string;
};

type Heading = { level: number; text: string };

function headingsOf(markdown: string): Heading[] {
  const headings: Heading[] = [];
  markdown.split(/\r?\n/).forEach(line => {
    const match = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line.trim());
    if (match) headings.push({ level: match[1].length, text: match[2].trim() });
  });
  return headings;
}

/** The native MD/MDX viewer: one React surface for both formats, with the
 *  toolbar a document needs and the state the agent can drive through
 *  specialist_doc_view. No iframe, no esm.sh, no second browser app. */
export function DocView({ content, format, viewer, title, onContentChange, onViewerChange, className }: DocViewProps) {
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [draft, setDraft] = useState(content);
  const [theme, setTheme] = useState<"light" | "dark">(viewer?.theme ?? "light");
  const [zoom, setZoom] = useState(viewer?.zoom ?? 100);
  const [wrap, setWrap] = useState(viewer?.wrap ?? true);
  const [outlineOpen, setOutlineOpen] = useState(viewer?.outline ?? false);
  const [query, setQuery] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Agent-driven view state arrives with the refreshed artifact metadata.
  // Local toolbar changes apply immediately and are optionally persisted.
  useEffect(() => { if (viewer?.theme) setTheme(viewer.theme); }, [viewer?.theme]);
  useEffect(() => { if (viewer?.zoom !== undefined) setZoom(viewer.zoom); }, [viewer?.zoom]);
  useEffect(() => { if (viewer?.wrap !== undefined) setWrap(viewer.wrap); }, [viewer?.wrap]);
  useEffect(() => { if (viewer?.outline !== undefined) setOutlineOpen(viewer.outline); }, [viewer?.outline]);
  useEffect(() => { if (content !== draft && mode === "preview") setDraft(content); }, [content, mode]);

  const isMdx = (format ?? viewer?.format) === "mdx";
  const markdown = useMemo(() => isMdx ? mdxToMarkdown(content) : content, [content, isMdx]);
  const headings = useMemo(() => headingsOf(markdown), [markdown]);
  const matchCount = useMemo(() => {
    if (!query.trim()) return 0;
    const needle = query.trim().toLocaleLowerCase();
    return markdown.split(/\r?\n/).filter(line => line.toLocaleLowerCase().includes(needle)).length;
  }, [markdown, query]);

  const scrollTo = useCallback((needle: string) => {
    const target = Array.from(contentRef.current?.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6") ?? [])
      .find(heading => heading.textContent?.trim().toLocaleLowerCase().includes(needle.toLocaleLowerCase()));
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  useEffect(() => {
    if (!viewer?.scrollTo) return;
    const timer = setTimeout(() => scrollTo(viewer.scrollTo ?? ""), 80);
    return () => clearTimeout(timer);
  }, [viewer?.scrollTo, scrollTo]);

  const update = (patch: ViewerState) => onViewerChange?.(patch);

  const download = () => {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(title ?? "documento").replace(/[^\p{L}\p{N}._-]+/gu, "-")}.${isMdx ? "mdx" : "md"}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void contentRef.current?.requestFullscreen();
  };
  useEffect(() => {
    const change = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);

  return (
    <section data-testid="doc-viewer" data-doc-format={isMdx ? "mdx" : "md"} className={cn("flex h-full min-h-0 flex-col", className)} aria-label="Visor de documento">
      <header className="flex flex-wrap items-center gap-1 border-b border-border bg-muted/20 px-2 py-1.5">
        <div role="group" aria-label="Modo del documento" className="flex items-center rounded-md border border-border p-0.5">
          <Button type="button" size="sm" variant={mode === "preview" ? "secondary" : "ghost"} className="h-7 px-2" aria-pressed={mode === "preview"} aria-label="Vista previa" onClick={() => setMode("preview")}><Eye className="size-3.5" />Vista previa</Button>
          <Button type="button" size="sm" variant={mode === "edit" ? "secondary" : "ghost"} className="h-7 px-2" aria-pressed={mode === "edit"} aria-label="Editar documento" onClick={() => setMode("edit")}><Pencil className="size-3.5" />Editar</Button>
        </div>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <Button variant="ghost" size="icon-sm" aria-label="Alejar" title="Alejar" onClick={() => { const next = Math.max(50, zoom - 10); setZoom(next); update({ zoom: next }); }}><ZoomOut className="size-4" /></Button>
        <button type="button" className="min-w-10 rounded px-1 text-xs tabular-nums text-muted-foreground hover:bg-muted" aria-label="Restablecer zoom" onClick={() => { setZoom(100); update({ zoom: 100 }); }}>{zoom}%</button>
        <Button variant="ghost" size="icon-sm" aria-label="Acercar" title="Acercar" onClick={() => { const next = Math.min(200, zoom + 10); setZoom(next); update({ zoom: next }); }}><ZoomIn className="size-4" /></Button>
        <Button variant="ghost" size="icon-sm" aria-pressed={wrap} aria-label="Ajustar líneas" title="Ajustar líneas" onClick={() => { setWrap(!wrap); update({ wrap: !wrap }); }}><WrapText className="size-4" /></Button>
        <Button variant="ghost" size="icon-sm" aria-pressed={theme === "dark"} aria-label={theme === "dark" ? "Tema claro" : "Tema oscuro"} title="Tema" onClick={() => { const next = theme === "dark" ? "light" : "dark"; setTheme(next); update({ theme: next }); }}>{theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}</Button>
        <Button variant="ghost" size="icon-sm" aria-pressed={outlineOpen} aria-label="Índice de títulos" title="Índice" onClick={() => { setOutlineOpen(!outlineOpen); update({ outline: !outlineOpen }); }}><ListTree className="size-4" /></Button>
        <form className="relative mx-1 min-w-24 flex-1" onSubmit={event => { event.preventDefault(); if (matchCount) scrollTo(query.trim()); }}>
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Buscar en el documento" placeholder="Buscar…" className="h-7 pl-7 text-xs" value={query} onChange={event => setQuery(event.currentTarget.value)} />
          {query ? <span className="absolute top-1/2 right-2 -translate-y-1/2 text-[10px] text-muted-foreground">{matchCount}</span> : null}
        </form>
        <Button variant="ghost" size="icon-sm" aria-label="Restablecer vista" title="Restablecer vista" onClick={() => { setZoom(100); setTheme("light"); setWrap(true); setQuery(""); update({ zoom: 100, theme: "light", wrap: true }); }}><RotateCcw className="size-4" /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Copiar documento" title="Copiar" onClick={() => void navigator.clipboard?.writeText(content)}><Copy className="size-4" /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Descargar documento" title="Descargar" onClick={download}><Download className="size-4" /></Button>
        <Button variant="ghost" size="icon-sm" aria-label={fullscreen ? "Salir de pantalla completa" : "Pantalla completa"} title="Pantalla completa" onClick={toggleFullscreen}>{fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}</Button>
      </header>
      <div className="flex min-h-0 flex-1">
        {outlineOpen ? (
          <nav data-testid="doc-outline" aria-label="Índice del documento" className="w-56 shrink-0 overflow-auto border-r border-border bg-muted/20 px-2 py-3">
            <p className="mb-2 px-2 text-xs font-medium text-muted-foreground">Contenido</p>
            {headings.length ? headings.map((heading, index) => (
              <button key={`${heading.text}-${index}`} type="button" className="block w-full rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground" style={{ paddingLeft: `${8 + (heading.level - 1) * 12}px` }} onClick={() => scrollTo(heading.text)}>{heading.text}</button>
            )) : <p className="px-2 text-xs text-muted-foreground">Sin títulos</p>}
          </nav>
        ) : null}
        <div
          ref={contentRef}
          data-testid="doc-content"
          className={cn("min-w-0 flex-1 overflow-auto", wrap ? "[&_pre]:whitespace-pre-wrap" : "[&_pre]:whitespace-pre")}
          style={{ zoom: zoom / 100, colorScheme: theme, backgroundColor: theme === "dark" ? "#0f172a" : "#ffffff", color: theme === "dark" ? "#e2e8f0" : "#1e293b" }}
        >
          {mode === "edit" ? (
            <textarea
              aria-label="Contenido del documento"
              className="h-full min-h-[24rem] w-full resize-none bg-transparent p-6 font-mono text-sm outline-none"
              value={draft}
              onChange={event => { setDraft(event.currentTarget.value); onContentChange?.(event.currentTarget.value); }}
            />
          ) : (
            <div className="mx-auto max-w-[80ch] px-6 py-6">
              {isMdx ? <p className="mb-4 rounded border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">MDX renderizado de forma nativa: se muestran títulos, texto y código; los componentes externos no se ejecutan.</p> : null}
              <MarkdownBlock text={markdown} highlightQuery={query.trim() || undefined} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** Kept as a named alias for callers that prefer the longer name. */
export const DocViewer = DocView;

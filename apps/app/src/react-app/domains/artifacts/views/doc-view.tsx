/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check, Copy, Eye, Link2, ListTree, Maximize2, MessageSquare, Minimize2, Moon,
  PanelRightClose, Pencil, RotateCcw, Search, Sun, Trash2, WrapText, ZoomIn, ZoomOut,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MarkdownBlock } from "../../session/surface/markdown";
import type { ArtifactAudit, ArtifactMetadata, ArtifactSourceRef, DocComment } from "../types";
import { mdxToMarkdown } from "./mdx-to-markdown";
import "./doc-view.css";

type ViewerState = NonNullable<ArtifactMetadata["viewer"]>;
type DocViewProps = {
  content: string;
  format?: "md" | "mdx";
  viewer?: ViewerState;
  title?: string;
  comments?: DocComment[];
  sources?: ArtifactSourceRef[];
  audit?: ArtifactAudit;
  onContentChange?: (content: string) => void;
  onViewerChange?: (patch: ViewerState) => void;
  onCommentsChange?: (comments: DocComment[]) => void;
  className?: string;
};

type Heading = { level: number; text: string };

function headingsOf(markdown: string): Heading[] {
  const headings: Heading[] = [];
  markdown.split(/\r?\n/).forEach(line => {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line.trim());
    if (match) headings.push({ level: match[1].length, text: match[2].trim() });
  });
  return headings;
}

/** The native MD/MDX viewer and the single surface for agent-driven document controls. */
export function DocView({
  content, format, viewer, title, comments = [], sources = [], audit,
  onContentChange, onViewerChange, onCommentsChange, className,
}: DocViewProps) {
  const [mode, setMode] = useState<"preview" | "edit">(viewer?.mode ?? "preview");
  const [draft, setDraft] = useState(content);
  const [theme, setTheme] = useState<"light" | "dark">(viewer?.theme ?? "light");
  const [zoom, setZoom] = useState(viewer?.zoom ?? 100);
  const [wrap, setWrap] = useState(viewer?.wrap ?? true);
  const [outlineOpen, setOutlineOpen] = useState(viewer?.outline ?? false);
  const [fullscreen, setFullscreen] = useState(viewer?.fullscreen ?? false);
  const [search, setSearch] = useState(viewer?.search ?? "");
  const [sidePanel, setSidePanel] = useState<"comments" | "sources" | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (viewer?.mode) setMode(viewer.mode); }, [viewer?.mode]);
  useEffect(() => { if (viewer?.theme) setTheme(viewer.theme); }, [viewer?.theme]);
  useEffect(() => { if (viewer?.zoom !== undefined) setZoom(viewer.zoom); }, [viewer?.zoom]);
  useEffect(() => { if (viewer?.wrap !== undefined) setWrap(viewer.wrap); }, [viewer?.wrap]);
  useEffect(() => { if (viewer?.outline !== undefined) setOutlineOpen(viewer.outline); }, [viewer?.outline]);
  useEffect(() => { if (viewer?.fullscreen !== undefined) setFullscreen(viewer.fullscreen); }, [viewer?.fullscreen]);
  useEffect(() => { setSearch(viewer?.search ?? ""); }, [viewer?.search]);
  useEffect(() => { if (content !== draft && mode === "preview") setDraft(content); }, [content, mode, draft]);

  const isMdx = (format ?? viewer?.format) === "mdx";
  const markdown = useMemo(() => isMdx ? mdxToMarkdown(content) : content, [content, isMdx]);
  const headings = useMemo(() => headingsOf(markdown), [markdown]);
  const matchCount = useMemo(() => {
    if (!search.trim()) return 0;
    const needle = search.trim().toLocaleLowerCase();
    return markdown.split(/\r?\n/).filter(line => line.toLocaleLowerCase().includes(needle)).length;
  }, [markdown, search]);

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
  const pendingComments = comments.filter(comment => !comment.resolved).length;
  const citationLabel = audit ? `${audit.valid}/${audit.total} citas` : "Sin citas";

  const resetView = () => {
    setTheme("light"); setZoom(100); setWrap(true); setOutlineOpen(false); setMode("preview"); setFullscreen(false); setSearch("");
    update({ theme: "light", zoom: 100, wrap: true, outline: false, mode: "preview", fullscreen: false, search: "" });
  };

  const setComment = (commentId: string, patch: Partial<DocComment>) => {
    onCommentsChange?.(comments.map(comment => comment.id === commentId ? { ...comment, ...patch, updatedAt: Date.now() } : comment));
  };

  return (
    <section
      data-testid="doc-viewer"
      data-doc-format={isMdx ? "mdx" : "md"}
      data-doc-fullscreen={fullscreen ? "true" : "false"}
      className={cn("flex h-full min-h-0 flex-col", fullscreen && "fixed inset-0 z-50 bg-background", className)}
      aria-label={title ? `Visor de ${title}` : "Visor de documento"}
    >
      <header className="flex flex-wrap items-center gap-1 border-b border-border bg-muted/20 px-2 py-1.5">
        <div role="group" aria-label="Modo del documento" className="flex items-center rounded-md border border-border p-0.5">
          <Button type="button" size="sm" variant={mode === "preview" ? "secondary" : "ghost"} className="h-7 px-2" aria-pressed={mode === "preview"} aria-label="Vista previa" onClick={() => { setMode("preview"); update({ mode: "preview" }); }}><Eye className="size-3.5" />Vista previa</Button>
          <Button type="button" size="sm" variant={mode === "edit" ? "secondary" : "ghost"} className="h-7 px-2" aria-pressed={mode === "edit"} aria-label="Editar documento" onClick={() => { setMode("edit"); update({ mode: "edit" }); }}><Pencil className="size-3.5" />Editar</Button>
        </div>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Button variant="ghost" size="icon-sm" aria-label="Alejar" title="Alejar" onClick={() => { const next = Math.max(50, zoom - 10); setZoom(next); update({ zoom: next }); }}><ZoomOut className="size-4" /></Button>
        <button type="button" className="min-w-10 rounded px-1 text-xs tabular-nums text-muted-foreground hover:bg-muted" aria-label="Restablecer zoom" onClick={() => { setZoom(100); update({ zoom: 100 }); }}>{zoom}%</button>
        <Button variant="ghost" size="icon-sm" aria-label="Acercar" title="Acercar" onClick={() => { const next = Math.min(200, zoom + 10); setZoom(next); update({ zoom: next }); }}><ZoomIn className="size-4" /></Button>
        <Button variant="ghost" size="icon-sm" aria-pressed={wrap} aria-label="Ajustar líneas" title="Ajustar líneas" onClick={() => { setWrap(!wrap); update({ wrap: !wrap }); }}><WrapText className="size-4" /></Button>
        <Button variant="ghost" size="icon-sm" aria-pressed={theme === "dark"} aria-label={theme === "dark" ? "Tema claro" : "Tema oscuro"} title="Tema" onClick={() => { const next = theme === "dark" ? "light" : "dark"; setTheme(next); update({ theme: next }); }}>{theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}</Button>
        <Button variant="ghost" size="icon-sm" aria-pressed={outlineOpen} aria-label="Índice de títulos" title="Índice" onClick={() => { setOutlineOpen(!outlineOpen); update({ outline: !outlineOpen }); }}><ListTree className="size-4" /></Button>
        <Button variant="ghost" size="icon-sm" aria-pressed={sidePanel === "comments"} aria-label={`Comentarios (${pendingComments})`} title="Comentarios" onClick={() => setSidePanel(sidePanel === "comments" ? null : "comments")}><MessageSquare className="size-4" />{pendingComments ? <span className="text-xs tabular-nums">{pendingComments}</span> : null}</Button>
        <Button variant="ghost" size="icon-sm" aria-pressed={sidePanel === "sources"} aria-label={citationLabel} title="Fuentes y citas" onClick={() => setSidePanel(sidePanel === "sources" ? null : "sources")}><Link2 className="size-4" /><span className="text-xs tabular-nums">{audit ? `${audit.valid}/${audit.total}` : "0"}</span></Button>
        <form className="relative mx-1 min-w-24 flex-1" onSubmit={event => { event.preventDefault(); update({ search }); if (matchCount) scrollTo(search.trim()); }}>
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Buscar en el documento" placeholder="Buscar…" className="h-7 pl-7 text-xs" value={search} onChange={event => setSearch(event.currentTarget.value)} onBlur={() => update({ search })} />
          {search ? <span className="absolute top-1/2 right-2 text-xs tabular-nums text-muted-foreground">{matchCount}</span> : null}
        </form>
        <Button variant="ghost" size="icon-sm" aria-label="Restablecer vista" title="Restablecer vista" onClick={resetView}><RotateCcw className="size-4" /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Copiar documento" title="Copiar" onClick={() => void navigator.clipboard?.writeText(content)}><Copy className="size-4" /></Button>
        <Button variant="ghost" size="icon-sm" aria-pressed={fullscreen} aria-label={fullscreen ? "Salir de pantalla completa" : "Pantalla completa"} title="Pantalla completa" onClick={() => { setFullscreen(!fullscreen); update({ fullscreen: !fullscreen }); }}>{fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}</Button>
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
          data-doc-theme={theme}
          className={cn("doc-view-content min-w-0 flex-1 overflow-auto", wrap ? "[&_pre]:whitespace-pre-wrap" : "[&_pre]:whitespace-pre")}
          style={{ zoom: zoom / 100, backgroundColor: "var(--background)", color: "var(--foreground)" }}
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
              <MarkdownBlock text={markdown} highlightQuery={search.trim() || undefined} />
            </div>
          )}
        </div>
        {sidePanel ? (
          <aside className="flex w-72 shrink-0 flex-col border-l border-border bg-background" aria-label={sidePanel === "comments" ? "Comentarios del documento" : "Fuentes y citas"}>
            <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
              <h3 className="min-w-0 flex-1 truncate text-xs font-medium">{sidePanel === "comments" ? "Comentarios" : "Fuentes y citas"}</h3>
              <Button variant="ghost" size="icon-sm" aria-label="Cerrar panel" onClick={() => setSidePanel(null)}><PanelRightClose className="size-4" /></Button>
            </header>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {sidePanel === "comments" ? (
                comments.length ? <div className="grid gap-3">{comments.map(comment => (
                  <article key={comment.id} className={cn("border-l-2 pl-3", comment.resolved ? "border-border opacity-60" : "border-primary")}>
                    <button type="button" className="block w-full text-left text-xs font-medium" onClick={() => { setSearch(comment.quote); update({ search: comment.quote, mode: "preview" }); setSidePanel(null); }}>{comment.quote}</button>
                    <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{comment.text}</p>
                    <div className="mt-2 flex items-center gap-1">
                      <span className="mr-auto text-xs text-muted-foreground">{comment.author === "agent" ? "Agente" : "Usuario"}</span>
                      {onCommentsChange ? <>
                        <Button variant="ghost" size="icon-sm" aria-label={comment.resolved ? "Reabrir comentario" : "Resolver comentario"} onClick={() => setComment(comment.id, { resolved: !comment.resolved })}><Check className="size-3.5" /></Button>
                        <Button variant="ghost" size="icon-sm" aria-label="Eliminar comentario" onClick={() => onCommentsChange(comments.filter(entry => entry.id !== comment.id))}><Trash2 className="size-3.5" /></Button>
                      </> : null}
                    </div>
                  </article>
                ))}</div> : <p className="text-xs text-muted-foreground">Sin comentarios. El agente puede anclarlos a una cita o bloque del documento.</p>
              ) : (
                <div className="grid gap-3">
                  <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">Auditoría</span><span className="tabular-nums">{audit ? `${audit.valid}/${audit.total} válidas` : "Sin auditoría"}</span></div>
                  {audit?.invalid.length ? <div role="alert" className="text-xs text-destructive">{audit.invalid.length} cita(s) sin resolver.</div> : null}
                  {sources.length ? sources.map((source, index) => (
                    <div key={`${source.kind}-${source.id}-${index}`} className="border-b border-border pb-2 text-xs">
                      <p className="font-medium">{source.label}</p>
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">{source.kind} · {source.id}</p>
                    </div>
                  )) : <p className="text-xs text-muted-foreground">El documento no tiene fuentes asociadas.</p>}
                </div>
              )}
            </div>
          </aside>
        ) : null}
      </div>
    </section>
  );
}

/** Kept as a named alias for callers that prefer the longer name. */
export const DocViewer = DocView;

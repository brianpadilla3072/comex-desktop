/** @jsxImportSource react */
import { useMemo } from "react";

interface SlidesViewProps { content: string }

interface SlideBlock { id: string; kind: "text" | "image" | "table" | "chart"; ref: string }
interface Slide { id: string; title?: string; blocks: SlideBlock[]; notes?: string; skipped?: boolean }

/** Minimal but real renderer for the slides artifact: filmstrip + canvas + notes.
 *  Full WYSIWYG editing lands with the slides sub-issue; this avoids a blank canvas. */
export function SlidesView({ content }: SlidesViewProps) {
  const parsed = useMemo(() => {
    try { return JSON.parse(content) as { slides?: Slide[] }; } catch { return null; }
  }, [content]);
  const slides = parsed?.slides ?? [];

  if (slides.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground" role="status">La presentación no tiene diapositivas.</div>;
  }

  return (
    <div className="grid gap-4 p-6" data-testid="slides-view">
      <ol className="flex gap-2 overflow-x-auto pb-2" data-testid="slides-filmstrip">
        {slides.map((slide, index) => (
          <li key={slide.id} className={`shrink-0 rounded-md border px-3 py-2 text-xs ${slide.skipped ? "opacity-50 line-through" : ""}`} data-testid={`slide-thumb-${slide.id}`}>
            <span className="font-medium">{index + 1}.</span> {slide.title ?? `Diapositiva ${index + 1}`}
          </li>
        ))}
      </ol>
      {slides.map((slide, index) => (
        <section key={slide.id} className="rounded-lg border p-4" data-testid={`slide-${slide.id}`}>
          <h3 className="text-sm font-semibold">{slide.title ?? `Diapositiva ${index + 1}`}</h3>
          <ul className="mt-2 grid gap-1 text-xs text-muted-foreground">
            {slide.blocks.map(block => (
              <li key={block.id} data-testid={`block-${block.id}`}>{block.kind}: {block.ref}</li>
            ))}
          </ul>
          {slide.notes ? <p className="mt-2 text-xs italic text-muted-foreground" data-testid={`notes-${slide.id}`}>{slide.notes}</p> : null}
          {slide.skipped ? <p className="mt-1 text-xs text-muted-foreground">(omitida)</p> : null}
        </section>
      ))}
    </div>
  );
}

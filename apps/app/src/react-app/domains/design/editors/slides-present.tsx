/** @jsxImportSource react */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { DesignPage } from "@openwork/types/designs";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { DesignFrame } from "../design-frame";
import { fitScale, presentKey, presentStep } from "./slides-model";

export type SlidesPresenterProps = {
  workspaceId: string;
  designId: string;
  pages: readonly DesignPage[];
  startIndex: number;
  onExit: (lastIndex: number) => void;
};

/**
 * Full-screen presentation: one slide at a time, scaled to the screen. Arrows, space, Page
 * Up/Down, Home/End move; Esc (or leaving full screen) exits; a click advances. The slide
 * itself is not interactive, so keys always reach the presenter.
 */
export function SlidesPresenter({ workspaceId, designId, pages, startIndex, onExit }: SlidesPresenterProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(() => Math.max(0, Math.min(pages.length - 1, startIndex)));
  const [box, setBox] = useState({ width: typeof window === "undefined" ? 1920 : window.innerWidth, height: typeof window === "undefined" ? 1080 : window.innerHeight });
  const indexRef = useRef(index);
  indexRef.current = index;
  const exitedRef = useRef(false);
  const exit = useCallback(() => {
    if (exitedRef.current) return;
    exitedRef.current = true;
    if (typeof document !== "undefined" && document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    onExit(indexRef.current);
  }, [onExit]);

  useEffect(() => {
    const root = rootRef.current;
    root?.focus();
    void root?.requestFullscreen?.().catch(() => undefined);
    const resize = () => setBox({ width: window.innerWidth, height: window.innerHeight });
    const wasFullscreen = { current: false };
    const fullscreenChange = () => { if (!document.fullscreenElement && wasFullscreen.current) exit(); wasFullscreen.current = Boolean(document.fullscreenElement); };
    window.addEventListener("resize", resize);
    document.addEventListener("fullscreenchange", fullscreenChange);
    return () => {
      window.removeEventListener("resize", resize);
      document.removeEventListener("fullscreenchange", fullscreenChange);
    };
  }, [exit]);

  const run = useCallback((command: Parameters<typeof presentStep>[2]) => {
    const next = presentStep(indexRef.current, pages.length, command);
    if (next === null) exit();
    else setIndex(next);
  }, [exit, pages.length]);

  const page = pages[index];
  if (!page) return null;
  const scale = fitScale(box, page, 0);
  const content = (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("design_ui.slides.present.label")}
      tabIndex={-1}
      data-slides-presenter
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black outline-none"
      onKeyDown={event => {
        const command = presentKey(event.key);
        if (!command) return;
        event.preventDefault();
        event.stopPropagation();
        run(command);
      }}
      onClick={() => run("next")}
    >
      <div style={{ width: page.width * scale, height: page.height * scale }} className="overflow-hidden">
        <DesignFrame workspaceId={workspaceId} designId={designId} page={page} scale={scale} interactive={false} />
      </div>
      <div className="group fixed inset-x-0 bottom-0 flex h-20 items-end justify-center pb-4" onClick={event => event.stopPropagation()}>
        <div className="flex items-center gap-1 rounded-xl bg-background/90 px-2 py-1 text-sm text-foreground opacity-0 shadow-[var(--dls-card-shadow)] transition-opacity duration-150 ease-out focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none">
          <Button variant="ghost" size="icon-sm" aria-label={t("design_ui.slides.present.previous")} disabled={index === 0} onClick={() => run("previous")}><ChevronLeft aria-hidden /></Button>
          <span data-slides-counter aria-live="polite" className="min-w-16 text-center tabular-nums">{t("design_ui.slides.present.counter", { current: index + 1, total: pages.length })}</span>
          <Button variant="ghost" size="icon-sm" aria-label={t("design_ui.slides.present.next")} disabled={index >= pages.length - 1} onClick={() => run("next")}><ChevronRight aria-hidden /></Button>
          <Button variant="ghost" size="icon-sm" aria-label={t("design_ui.slides.present.exit")} onClick={exit}><X aria-hidden /></Button>
        </div>
      </div>
    </div>
  );
  return typeof document === "undefined" ? content : createPortal(content, document.body);
}

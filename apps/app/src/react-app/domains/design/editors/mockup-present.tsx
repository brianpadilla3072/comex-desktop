/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DesignPage } from "@openwork/types/designs";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

import { DesignFrame } from "../design-frame";
import { fitScale, pageAtWidth, type MockupWidthId } from "./mockup-model";

/** Full-screen presentation of the screens at the chosen width: arrows move, Esc leaves. */
export function MockupPresent(props: {
  workspaceId: string;
  designId: string;
  pages: DesignPage[];
  startIndex: number;
  width: MockupWidthId;
  reloadKey?: string | number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(Math.max(0, Math.min(props.startIndex, props.pages.length - 1)));
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const rootRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;
  const count = props.pages.length;

  useEffect(() => {
    const root = rootRef.current;
    root?.focus();
    if (root && typeof root.requestFullscreen === "function" && !document.fullscreenElement) {
      root.requestFullscreen().catch(() => undefined);
    }
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    const onFullscreen = () => {
      if (!document.fullscreenElement) onCloseRef.current();
    };
    window.addEventListener("resize", onResize);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("fullscreenchange", onFullscreen);
      if (document.fullscreenElement && typeof document.exitFullscreen === "function") void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  // The screen renders non-interactive, so focus stays in the app and the keys reach the window.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
        event.preventDefault();
        setIndex(current => Math.min(count - 1, current + 1));
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        setIndex(current => Math.max(0, current - 1));
      } else if (event.key === "Home") setIndex(0);
      else if (event.key === "End") setIndex(count - 1);
      else if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count]);

  const source = props.pages[index];
  if (!source) return null;
  const page = pageAtWidth(source, props.width);
  const scale = fitScale({ width: viewport.width, height: viewport.height - 56 }, page, 16);

  return createPortal(
    <div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={t("design_ui.mockup.present_label")}
      data-mockup-present=""
      className="fixed inset-0 z-50 flex flex-col bg-background outline-none"
    >
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div style={{ width: page.width * scale, height: page.height * scale }} className="overflow-hidden rounded-md shadow-[var(--dls-card-shadow)]">
          <DesignFrame workspaceId={props.workspaceId} designId={props.designId} page={page} scale={scale} interactive={false} reloadKey={props.reloadKey} />
        </div>
      </div>
      <div className="flex h-14 shrink-0 items-center justify-center gap-3 text-sm text-muted-foreground">
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("design_ui.mockup.previous")} disabled={index === 0} onClick={() => setIndex(current => Math.max(0, current - 1))}>
          <ChevronLeft />
        </Button>
        <span aria-live="polite" className="min-w-40 text-center">
          {t("design_ui.mockup.present_position", { current: index + 1, total: count, title: source.title })}
        </span>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("design_ui.mockup.next")} disabled={index >= count - 1} onClick={() => setIndex(current => Math.min(count - 1, current + 1))}>
          <ChevronRight />
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={props.onClose} title={t("design_ui.mockup.exit_present_hint")}>
          <X />
          {t("design_ui.mockup.exit_present")}
        </Button>
      </div>
    </div>,
    document.body,
  );
}

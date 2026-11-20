/** @jsxImportSource react */
import { useId } from "react";
import type { BoardElement } from "@openwork/types/designs";
import { BringToFront, Copy, Download, Focus, SendToBack, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

import { BOARD_PALETTE, type ArrangeAction, type BoardStyle } from "./board-model";
import { withShortcut } from "./board-toolbar";

type Props = {
  selected: BoardElement[];
  writable: boolean;
  onStyle: (patch: BoardStyle) => void;
  onArrange: (action: ArrangeAction) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onFocusFrame: (id: string) => void;
  onDownloadFrame: (id: string) => void;
  downloading: string | null;
};

const HAS_FILL = new Set<BoardElement["type"]>(["frame", "rect", "ellipse", "sticky"]);
const HAS_STROKE = new Set<BoardElement["type"]>(["frame", "rect", "ellipse", "path"]);
const HAS_TEXT = new Set<BoardElement["type"]>(["text", "sticky"]);
const STROKE_WIDTHS = [1, 2, 4, 8];

function common<T>(values: T[]): T | undefined {
  const first = values[0];
  return values.every(value => value === first) ? first : undefined;
}

function Swatches(props: { label: string; value: string | undefined; onPick: (color: string) => void; allowNone?: boolean }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-1.5">
      <span id={id} className="text-xs font-medium text-muted-foreground">{props.label}</span>
      <div className="flex flex-wrap items-center gap-1">
        {props.allowNone ? (
          <button
            type="button"
            aria-label={t("design_ui.board.style.none")}
            aria-pressed={props.value === "none"}
            title={t("design_ui.board.style.none")}
            className={cn("size-6 rounded-md border border-border bg-[linear-gradient(135deg,transparent_45%,var(--destructive)_45%,var(--destructive)_55%,transparent_55%)] focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none", props.value === "none" && "ring-2 ring-primary")}
            onClick={() => props.onPick("none")}
          />
        ) : null}
        {BOARD_PALETTE.map(color => (
          <button
            key={color}
            type="button"
            aria-label={t("design_ui.board.style.color", { color })}
            aria-pressed={props.value?.toLowerCase() === color}
            title={color}
            className={cn("size-6 rounded-md border border-border focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none", props.value?.toLowerCase() === color && "ring-2 ring-primary")}
            style={{ background: color }}
            onClick={() => props.onPick(color)}
          />
        ))}
        <input
          type="color"
          aria-label={t("design_ui.board.style.custom_color", { label: props.label })}
          value={props.value && /^#[0-9a-f]{6}$/i.test(props.value) ? props.value : "#000000"}
          className="size-6 cursor-pointer rounded-md border border-border bg-transparent p-0"
          onChange={event => props.onPick(event.currentTarget.value)}
        />
      </div>
    </div>
  );
}

/** Style and arrange controls for the current selection. */
export function BoardStylePanel(props: Props) {
  const { selected, writable } = props;
  const types = new Set(selected.map(e => e.type));
  const any = (set: Set<BoardElement["type"]>) => [...types].some(type => set.has(type));
  const singleFrame = selected.length === 1 && selected[0]?.type === "frame" ? selected[0] : null;
  const fontSize = common(selected.filter(e => HAS_TEXT.has(e.type)).map(e => e.style.fontSize));
  const opacity = common(selected.map(e => e.style.opacity ?? 1)) ?? 1;
  const strokeWidth = common(selected.filter(e => HAS_STROKE.has(e.type)).map(e => e.style.strokeWidth));
  const fontId = useId();
  const opacityId = useId();

  return (
    <section aria-label={t("design_ui.board.style.panel_label")} className="flex flex-col gap-4 text-sm">
      <p className="text-xs text-muted-foreground" aria-live="polite">{t("design_ui.board.selected_count", { count: selected.length })}</p>
      {singleFrame ? (
        <div className="flex flex-col gap-1.5">
          <Button type="button" variant="outline" size="sm" onClick={() => props.onFocusFrame(singleFrame.id)}>
            <Focus />
            {t("design_ui.board.frame_focus")}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={props.downloading === singleFrame.id} onClick={() => props.onDownloadFrame(singleFrame.id)}>
            <Download />
            {t("design_ui.board.frame_download")}
          </Button>
        </div>
      ) : null}
      {writable ? (
        <>
          {any(HAS_FILL) ? <Swatches label={t("design_ui.board.style.fill")} value={common(selected.filter(e => HAS_FILL.has(e.type)).map(e => e.style.fill ?? "none"))} allowNone onPick={fill => props.onStyle({ fill })} /> : null}
          {any(HAS_STROKE) ? (
            <>
              <Swatches label={t("design_ui.board.style.stroke")} value={common(selected.filter(e => HAS_STROKE.has(e.type)).map(e => e.style.stroke ?? "none"))} allowNone onPick={stroke => props.onStyle({ stroke })} />
              <div role="group" aria-label={t("design_ui.board.style.stroke_width")} className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">{t("design_ui.board.style.stroke_width")}</span>
                <div className="flex gap-1">
                  {STROKE_WIDTHS.map(width => (
                    <Button key={width} type="button" variant="outline" size="xs" aria-pressed={strokeWidth === width} className={cn(strokeWidth === width && "bg-muted")} onClick={() => props.onStyle({ strokeWidth: width })}>
                      {width}
                    </Button>
                  ))}
                </div>
              </div>
            </>
          ) : null}
          {any(HAS_TEXT) ? (
            <>
              <Swatches label={t("design_ui.board.style.text_color")} value={common(selected.filter(e => HAS_TEXT.has(e.type)).map(e => e.style.color))} onPick={color => props.onStyle({ color })} />
              <div className="flex flex-col gap-1.5">
                <label htmlFor={fontId} className="text-xs font-medium text-muted-foreground">{t("design_ui.board.style.font_size")}</label>
                <Input
                  id={fontId}
                  type="number"
                  min={4}
                  max={400}
                  className="h-8 w-24"
                  value={fontSize ?? ""}
                  onChange={event => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value) && value >= 4 && value <= 400) props.onStyle({ fontSize: value });
                  }}
                />
              </div>
            </>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={opacityId} className="text-xs font-medium text-muted-foreground">{t("design_ui.board.style.opacity")}</label>
            <input
              id={opacityId}
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={opacity}
              className="w-full accent-[var(--dls-accent)]"
              onChange={event => props.onStyle({ opacity: Number(event.currentTarget.value) })}
            />
          </div>
          <div role="group" aria-label={t("design_ui.board.arrange_label")} className="flex flex-wrap gap-1">
            <Button type="button" variant="outline" size="icon-sm" aria-label={t("design_ui.board.arrange.front")} title={withShortcut(t("design_ui.board.arrange.front"), "Shift+]")} onClick={() => props.onArrange("front")}><BringToFront /></Button>
            <Button type="button" variant="outline" size="xs" title={withShortcut(t("design_ui.board.arrange.forward"), "]")} onClick={() => props.onArrange("forward")}>{t("design_ui.board.arrange.forward")}</Button>
            <Button type="button" variant="outline" size="xs" title={withShortcut(t("design_ui.board.arrange.backward"), "[")} onClick={() => props.onArrange("backward")}>{t("design_ui.board.arrange.backward")}</Button>
            <Button type="button" variant="outline" size="icon-sm" aria-label={t("design_ui.board.arrange.back")} title={withShortcut(t("design_ui.board.arrange.back"), "Shift+[")} onClick={() => props.onArrange("back")}><SendToBack /></Button>
          </div>
          <div className="flex gap-1">
            <Button type="button" variant="outline" size="sm" title={withShortcut(t("design_ui.board.duplicate"), "Ctrl+D")} onClick={props.onDuplicate}>
              <Copy />
              {t("design_ui.board.duplicate")}
            </Button>
            <Button type="button" variant="destructive" size="sm" title={withShortcut(t("design_ui.board.delete"), t("design_ui.board.key_delete"))} onClick={props.onDelete}>
              <Trash2 />
              {t("design_ui.board.delete")}
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}

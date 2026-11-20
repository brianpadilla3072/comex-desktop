/** @jsxImportSource react */
import type { BoardElement } from "@openwork/types/designs";
import { Download, Focus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

/** The board's frames, in order: select one, focus it ("Ampliar") or download it as PNG. */
export function BoardFrames(props: {
  frames: Extract<BoardElement, { type: "frame" }>[];
  selection: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onDownload: (id: string) => void;
  downloading: string | null;
}) {
  if (!props.frames.length) {
    return <p className="px-2 py-1.5 text-xs text-muted-foreground">{t("design_ui.board.frames_empty")}</p>;
  }
  return (
    <ul aria-label={t("design_ui.board.frames_label")} className="flex flex-col">
      {props.frames.map(frame => {
        const selected = props.selection.has(frame.id);
        const title = frame.title || t("design_ui.board.frame_untitled");
        return (
          <li key={frame.id} className={cn("group flex items-center gap-1 rounded-lg pe-1", selected && "bg-muted")}>
            <button
              type="button"
              aria-current={selected ? "true" : undefined}
              className="min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-start text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={() => props.onSelect(frame.id)}
            >
              {title}
            </button>
            <Button type="button" variant="ghost" size="icon-xs" aria-label={t("design_ui.board.frame_focus_named", { title })} title={t("design_ui.board.frame_focus")} onClick={() => props.onFocus(frame.id)}>
              <Focus />
            </Button>
            <Button type="button" variant="ghost" size="icon-xs" disabled={props.downloading === frame.id} aria-label={t("design_ui.board.frame_download_named", { title })} title={t("design_ui.board.frame_download")} onClick={() => props.onDownload(frame.id)}>
              <Download />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

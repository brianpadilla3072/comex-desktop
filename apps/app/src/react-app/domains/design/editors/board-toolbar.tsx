/** @jsxImportSource react */
import type { KeyboardEvent, ReactNode } from "react";
import { Circle, Frame, Hand, Image as ImageIcon, MousePointer2, Pencil, Redo2, Square, StickyNote, Type, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

import { BOARD_TOOLS, type BoardTool } from "./board-model";

const TOOL_ICONS: Record<BoardTool, ReactNode> = {
  select: <MousePointer2 />, hand: <Hand />, frame: <Frame />, text: <Type />, sticky: <StickyNote />,
  pen: <Pencil />, rect: <Square />, ellipse: <Circle />, image: <ImageIcon />,
};

export const toolLabel = (tool: BoardTool) => t(`design_ui.board.tool.${tool}`);

/** A label with its shortcut, for tooltips: "Rectángulo (R)". */
export const withShortcut = (label: string, shortcut: string) => t("design_ui.board.with_shortcut", { label, shortcut });

const modKey = () => (typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl");

/** Arrow keys move focus between the toolbar's buttons (one tab stop for the whole toolbar). */
export function rovingToolbarKeys(event: KeyboardEvent<HTMLElement>) {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])")];
  const index = buttons.findIndex(button => button === document.activeElement);
  const next = event.key === "Home" ? 0
    : event.key === "End" ? buttons.length - 1
    : event.key === "ArrowLeft" || event.key === "ArrowUp" ? Math.max(0, index - 1)
    : Math.min(buttons.length - 1, index + 1);
  buttons[next]?.focus();
  event.preventDefault();
  event.stopPropagation();
}

export function BoardToolbar(props: {
  tool: BoardTool;
  onTool: (tool: BoardTool) => void;
  writable: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const tools = props.writable ? BOARD_TOOLS : BOARD_TOOLS.filter(tool => tool.id === "select" || tool.id === "hand");
  const mod = modKey();
  return (
    <div
      role="toolbar"
      aria-label={t("design_ui.board.toolbar_label")}
      aria-orientation="horizontal"
      className="flex items-center gap-0.5 rounded-xl bg-background p-1 shadow-[var(--dls-card-shadow)]"
      onKeyDown={rovingToolbarKeys}
    >
      {tools.map(({ id, shortcut }) => {
        const label = toolLabel(id);
        const active = props.tool === id;
        return (
          <Button
            key={id}
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-pressed={active}
            aria-keyshortcuts={shortcut}
            title={withShortcut(label, shortcut)}
            tabIndex={active ? 0 : -1}
            data-tool={id}
            className={cn("rounded-lg", active && "bg-muted text-foreground")}
            onClick={() => props.onTool(id)}
          >
            {TOOL_ICONS[id]}
          </Button>
        );
      })}
      {props.writable ? (
        <>
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
          <Button type="button" variant="ghost" size="icon-sm" className="rounded-lg" tabIndex={-1} disabled={!props.canUndo} aria-label={t("design_ui.board.undo")} aria-keyshortcuts="Control+Z Meta+Z" title={withShortcut(t("design_ui.board.undo"), `${mod}+Z`)} onClick={props.onUndo}>
            <Undo2 />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" className="rounded-lg" tabIndex={-1} disabled={!props.canRedo} aria-label={t("design_ui.board.redo")} aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z" title={withShortcut(t("design_ui.board.redo"), `${mod}+Shift+Z`)} onClick={props.onRedo}>
            <Redo2 />
          </Button>
        </>
      ) : null}
    </div>
  );
}

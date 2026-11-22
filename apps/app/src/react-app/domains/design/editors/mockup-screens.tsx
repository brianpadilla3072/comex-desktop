/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";
import type { DesignPage } from "@openwork/types/designs";
import { ArrowDown, ArrowUp, Copy, Ellipsis, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

import { MOCKUP_TEMPLATE_IDS, type MockupTemplateId } from "./mockup-templates";

type Props = {
  pages: DesignPage[];
  currentId: string | null;
  writable: boolean;
  busy: boolean;
  canAdd: boolean;
  onSelect: (pageId: string) => void;
  onAdd: (template: MockupTemplateId) => void;
  onAskAgent: () => void;
  onRename: (pageId: string, title: string) => void;
  onMove: (pageId: string, delta: number) => void;
  onDuplicate: (pageId: string) => void;
  onDelete: (pageId: string) => void;
};

/** Screens of the design, in order, with add / rename / reorder / duplicate / delete. */
export function MockupScreens(props: Props) {
  const [renaming, setRenaming] = useState<string | null>(null);
  return (
    <nav aria-label={t("design_ui.mockup.screens_label")} className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <h3 className="text-xs font-medium text-muted-foreground">{t("design_ui.mockup.screens_count", { count: props.pages.length })}</h3>
        {props.writable ? (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button type="button" variant="outline" size="xs" disabled={props.busy || !props.canAdd} data-mockup-add="" />}>
              <Plus />
              {t("design_ui.mockup.add_screen")}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {MOCKUP_TEMPLATE_IDS.map(id => (
                <DropdownMenuItem key={id} data-mockup-template={id} onClick={() => props.onAdd(id)}>
                  {t(`design_ui.mockup.template.${id}`)}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem data-mockup-ask-screen="" onClick={props.onAskAgent}>{t("design_ui.mockup.ask_screen")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <ol className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
        {props.pages.map((page, index) => {
          const current = page.id === props.currentId;
          const title = page.title || t("design_ui.mockup.untitled", { number: index + 1 });
          return (
            <li key={page.id} data-mockup-screen={page.id} className={cn("group flex items-center gap-1 rounded-lg pe-1", current && "bg-muted")}>
              {renaming === page.id ? (
                <RenameField
                  initial={page.title}
                  onDone={value => {
                    setRenaming(null);
                    if (value !== null && value.trim() && value.trim() !== page.title) props.onRename(page.id, value);
                  }}
                />
              ) : (
                <button
                  type="button"
                  aria-current={current ? "page" : undefined}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-start text-sm focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  onClick={() => props.onSelect(page.id)}
                  onDoubleClick={() => props.writable && setRenaming(page.id)}
                  onKeyDown={event => {
                    if (!props.writable || !event.altKey) return;
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      props.onMove(page.id, -1);
                    } else if (event.key === "ArrowDown") {
                      event.preventDefault();
                      props.onMove(page.id, 1);
                    }
                  }}
                  aria-keyshortcuts={props.writable ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
                >
                  <span className="w-5 shrink-0 text-end text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                  <span className="truncate text-foreground">{title}</span>
                </button>
              )}
              {props.writable && renaming !== page.id ? (
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-xs" aria-label={t("design_ui.mockup.screen_actions", { title })} disabled={props.busy} />}>
                    <Ellipsis />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setRenaming(page.id)}><Pencil />{t("design_ui.mockup.rename")}</DropdownMenuItem>
                    <DropdownMenuItem disabled={index === 0} onClick={() => props.onMove(page.id, -1)}><ArrowUp />{t("design_ui.mockup.move_up")}</DropdownMenuItem>
                    <DropdownMenuItem disabled={index === props.pages.length - 1} onClick={() => props.onMove(page.id, 1)}><ArrowDown />{t("design_ui.mockup.move_down")}</DropdownMenuItem>
                    <DropdownMenuItem disabled={!props.canAdd} onClick={() => props.onDuplicate(page.id)}><Copy />{t("design_ui.mockup.duplicate")}</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" disabled={props.pages.length <= 1} onClick={() => props.onDelete(page.id)}><Trash2 />{t("design_ui.mockup.delete")}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function RenameField(props: { initial: string; onDone: (value: string | null) => void }) {
  const ref = useRef<HTMLInputElement | null>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    props.onDone(value);
  };
  return (
    <input
      ref={ref}
      aria-label={t("design_ui.mockup.rename_label")}
      defaultValue={props.initial}
      maxLength={120}
      data-mockup-rename=""
      className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      onBlur={event => finish(event.currentTarget.value)}
      onKeyDown={event => {
        if (event.key === "Enter") finish(event.currentTarget.value);
        if (event.key === "Escape") finish(null);
      }}
    />
  );
}

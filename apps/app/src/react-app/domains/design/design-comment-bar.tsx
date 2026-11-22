import { Eye, Lock, MessageSquare, TextCursorInput, Undo2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

import { DesignCommentBox } from "./design-comment-box";
import type { DesignPickerController, DesignPickerMode, DesignPickerNotice } from "./design-picker";

const MODES: DesignPickerMode[] = ["view", "comment", "edit"];
const isMode = (value: unknown): value is DesignPickerMode => MODES.some(mode => mode === value);

const NOTICE_KEYS: Record<DesignPickerNotice, string> = {
  saving: "design_ui.comment.saving",
  saved: "design_ui.comment.saved",
  undone: "design_ui.comment.undone",
  error_save: "design_ui.comment.error_save",
  error_changed: "design_ui.comment.error_changed",
  error_not_text: "design_ui.comment.error_not_text",
  error_undo_changed: "design_ui.comment.error_undo_changed",
  error_send: "design_ui.comment.error_send",
};

/**
 * Ver / Comentar / Editar for a design editor's toolbar, with the pending comments and undo.
 * Mount it next to the frames bound with `picker.bindFrame(page)`; it also renders the comment
 * box anchored to the selected element.
 */
export function DesignCommentBar({ picker, className }: { picker: DesignPickerController; className?: string }) {
  const notice = picker.notice;
  const failed = notice !== null && notice.startsWith("error_");
  return (
    <div role="toolbar" aria-label={t("design_ui.comment.toolbar_label")} className={cn("flex min-w-0 flex-wrap items-center gap-2", className)} data-design-comment-bar>
      <ToggleGroup
        value={[picker.mode]}
        onValueChange={values => { const next = values[0]; picker.setMode(isMode(next) ? next : "view"); }}
        variant="segmented"
        spacing={0.5}
        size="xs"
        aria-label={t("design_ui.comment.mode_label")}
      >
        <ToggleGroupItem value="view" data-design-mode="view">
          <Eye strokeWidth={1.5} aria-hidden="true" />
          {t("design_ui.comment.mode_view")}
        </ToggleGroupItem>
        <ToggleGroupItem value="comment" data-design-mode="comment">
          <MessageSquare strokeWidth={1.5} aria-hidden="true" />
          {t("design_ui.comment.mode_comment")}
        </ToggleGroupItem>
        <ToggleGroupItem
          value="edit"
          disabled={!picker.writable}
          title={picker.writable ? t("design_ui.comment.edit_hint") : t("design_ui.comment.edit_locked")}
          data-design-mode="edit"
        >
          {picker.writable ? <TextCursorInput strokeWidth={1.5} aria-hidden="true" /> : <Lock strokeWidth={1.5} aria-hidden="true" />}
          {t("design_ui.comment.mode_edit")}
        </ToggleGroupItem>
      </ToggleGroup>

      {picker.pending.length > 0 ? (
        <div className="flex items-center gap-1">
          <Popover>
            <PopoverTrigger render={
              <Button variant="ghost" size="xs" data-design-pending-trigger>
                {t("design_ui.comment.pending_count", { count: picker.pending.length })}
              </Button>
            } />
            <PopoverContent side="bottom" align="start" className="w-80 gap-0 rounded-xl p-0">
              <PopoverTitle className="flex h-10 items-center px-3 text-sm font-semibold">{t("design_ui.comment.pending_title")}</PopoverTitle>
              <ul className="flex flex-col pb-1" data-design-pending-list>
                {picker.pending.map(item => (
                  <li key={item.id} className="flex min-h-10 items-center gap-2 border-t border-border px-3 py-1.5">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm">{item.comment}</span>
                      <span className="truncate font-mono text-xs text-muted-foreground">{`<${item.target.tag}>, ${item.page.title}`}</span>
                    </div>
                    <Button variant="ghost" size="icon-xs" aria-label={t("design_ui.comment.remove")} title={t("design_ui.comment.remove")} onClick={() => picker.removePending(item.id)}>
                      <X strokeWidth={1.5} />
                    </Button>
                  </li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>
          <Button size="xs" disabled={picker.sending} onClick={() => void picker.sendPending()} data-design-pending-send>
            {picker.pending.length === 1 ? t("design_ui.comment.send") : t("design_ui.comment.send_count", { count: picker.pending.length })}
          </Button>
        </div>
      ) : null}

      {picker.mode === "edit" || picker.canUndo ? (
        <Button variant="ghost" size="xs" disabled={!picker.canUndo} onClick={() => void picker.undo()} data-design-undo>
          <Undo2 strokeWidth={1.5} aria-hidden="true" />
          {t("design_ui.comment.undo")}
        </Button>
      ) : null}

      <span
        role={failed ? "alert" : "status"}
        aria-live="polite"
        className={cn("min-w-0 truncate text-xs", failed ? "text-destructive" : "text-muted-foreground")}
        data-design-comment-notice={notice ?? undefined}
      >
        {notice ? t(NOTICE_KEYS[notice]) : ""}
      </span>

      <DesignCommentBox picker={picker} />
    </div>
  );
}

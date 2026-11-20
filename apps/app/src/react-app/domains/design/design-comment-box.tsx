import { useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";

import type { DesignPickerController } from "./design-picker";

/** The small box anchored to the element the person pointed at (Comentar). */
export function DesignCommentBox({ picker }: { picker: DesignPickerController }) {
  const draft = picker.draft;
  return (
    <Popover open={draft !== null} onOpenChange={open => { if (!open) picker.cancelDraft(); }}>
      {draft ? (
        <PopoverContent anchor={draft.anchor} side="bottom" align="start" sideOffset={8} className="w-80 gap-3 rounded-xl p-3" data-design-comment-box>
          <DesignCommentForm key={`${draft.page.id}:${draft.target.selector}`} picker={picker} />
        </PopoverContent>
      ) : null}
    </Popover>
  );
}

function DesignCommentForm({ picker }: { picker: DesignPickerController }) {
  const [comment, setComment] = useState("");
  const empty = comment.trim().length === 0;
  const target = picker.draft?.target;
  const sendLabel = picker.pending.length > 0
    ? t("design_ui.comment.send_count", { count: picker.pending.length + 1 })
    : t("design_ui.comment.send");
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!empty && !picker.sending) void picker.sendDraft(comment);
    }
  };
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={event => { event.preventDefault(); if (!empty) void picker.sendDraft(comment); }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t("design_ui.comment.prompt")}</span>
        {target ? (
          <span className="truncate font-mono text-xs text-muted-foreground" data-design-comment-target>
            {`<${target.tag}>`}{target.text ? ` ${target.text}` : ""}
          </span>
        ) : null}
        <Textarea
          autoFocus
          value={comment}
          maxLength={4000}
          onChange={event => setComment(event.target.value)}
          onKeyDown={onKeyDown}
          className="min-h-16 text-sm"
          data-design-comment-input
        />
      </label>
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={empty} onClick={() => picker.queueDraft(comment)} data-design-comment-queue>
          {t("design_ui.comment.add_to_list")}
        </Button>
        <Button type="submit" size="sm" disabled={empty || picker.sending} data-design-comment-send>
          {sendLabel}
        </Button>
      </div>
    </form>
  );
}

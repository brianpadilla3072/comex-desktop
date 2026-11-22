/** @jsxImportSource react */
import { useId, useState, type ReactNode } from "react";
import { MessageSquarePlus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";
import { PairDeviceHint } from "@/react-app/shell/pair-device-hint";

/**
 * How the design page reaches the app's chat for the design's project. The route provides it
 * with the app's own session surface and composer, so the chat beside a design is the same chat
 * as everywhere else (model picker, approvals, attachments).
 */
export type DesignChatHost = {
  /** The live conversation (messages and composer) of a session of the design's project. */
  renderSession: (sessionId: string) => ReactNode;
  /** Start a chat in the design's project with a first message; resolves with its session id. */
  startChat: (prompt: string) => Promise<string>;
  /** Send a message to a chat that already exists. */
  sendMessage: (sessionId: string, text: string) => Promise<void>;
  /** Which chat the page shows (null when none): the route prepares that session's runtime. */
  onSessionChange?: (sessionId: string | null) => void;
  /** The app's composer for the first message; a plain field is used without it. */
  renderStarter?: (start: (prompt: string) => void, busy: boolean) => ReactNode;
};

/** The side panel: the design's current chat, or a field to start one. */
export function DesignChatPanel({ host, sessionId, busy, error, writable, onStart, onNewChat, onClose }: {
  host: DesignChatHost | null;
  sessionId: string | null;
  busy: boolean;
  error: string | null;
  writable: boolean;
  onStart: (prompt: string) => void;
  onNewChat: () => void;
  onClose: () => void;
}) {
  // flex-1: the panel must fill the column's height. With auto height the embedded session
  // surface collapses (its scroller is absolute), leaving the composer at the top and the
  // scroll overlays floating over the design header.
  return <aside data-design-chat aria-label={t("design_ui.studio.chat_label")} className="flex min-h-0 min-w-0 flex-1 flex-col border-border bg-background max-md:border-t md:border-l">
    <header className="flex h-10 shrink-0 items-center justify-between gap-2 px-3">
      <h2 className="text-sm font-medium">{t("design_ui.studio.chat_title")}</h2>
      <span className="flex items-center gap-1">
        {host && sessionId && writable ? <Button variant="ghost" size="icon-sm" data-design-chat-new aria-label={t("design_ui.studio.chat_new")} title={t("design_ui.studio.chat_new")} onClick={onNewChat}>
          <MessageSquarePlus className="size-4" aria-hidden />
        </Button> : null}
        <Button variant="ghost" size="icon-sm" data-design-chat-close aria-label={t("design_ui.studio.chat_hide")} title={t("design_ui.studio.chat_hide")} onClick={onClose}>
          <X className="size-4" aria-hidden />
        </Button>
      </span>
    </header>
    {error ? <p role="alert" data-design-chat-error className="mx-3 mb-2 text-sm text-destructive">{error}</p> : null}
    {!host ? <p role="status" data-design-chat-unavailable className="m-3 text-sm text-muted-foreground">{t("design_ui.studio.chat_unavailable")}</p>
      : !writable ? <p role="status" className="m-3 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">{t("design_ui.studio.chat_read_only")} <PairDeviceHint /></p>
      : sessionId ? <div data-design-chat-session={sessionId} className="flex min-h-0 flex-1 flex-col">{host.renderSession(sessionId)}</div>
      : <div data-design-chat-start className="mt-auto p-3">
        {host.renderStarter ? host.renderStarter(onStart, busy) : <PlainStarter busy={busy} onStart={onStart} />}
      </div>}
  </aside>;
}

function PlainStarter({ busy, onStart }: { busy: boolean; onStart: (prompt: string) => void }) {
  const id = useId();
  const [text, setText] = useState("");
  const submit = () => { const value = text.trim(); if (value && !busy) { onStart(value); setText(""); } };
  return <form className="grid gap-2" onSubmit={event => { event.preventDefault(); submit(); }}>
    <Label htmlFor={id} className="sr-only">{t("design_ui.studio.chat_placeholder")}</Label>
    <Textarea id={id} data-design-chat-input rows={3} value={text} placeholder={t("design_ui.studio.chat_placeholder")} disabled={busy}
      onChange={event => setText(event.target.value)}
      onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }} />
    <Button type="submit" size="sm" className="justify-self-end" data-design-chat-send disabled={busy || !text.trim()}>{busy ? t("design_ui.studio.chat_starting") : t("design_ui.studio.chat_send")}</Button>
  </form>;
}

/** The message the agent receives for "ask the agent" from an editor: the request, then its context. */
export function designAskMessage(text: string, context?: string): string {
  const request = text.trim();
  const extra = context?.trim();
  return extra ? `${request}\n\n${extra}` : request;
}

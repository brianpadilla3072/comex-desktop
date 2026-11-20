/** @jsxImportSource react */
import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ChevronDown, Download, MessageSquare, Play } from "lucide-react";

import { DESIGN_LIMITS, designKindLabel, type DesignKind, type DesignManifest } from "@/app/lib/designs";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { PairDeviceHint } from "@/react-app/shell/pair-device-hint";

import { DesignChatPanel, designAskMessage, type DesignChatHost } from "./design-chat-panel";
import { DesignClientContext, designErrorText, designQueryKeys, type DesignClient } from "./design-client";
import { useDesignThumbnailRefresh } from "./design-thumbnail";
import { DESIGN_EDITORS, type DesignEditorProps } from "./editors";
import { useDesignConnection } from "./use-designs";

/**
 * An export format beyond HTML (PDF, PPTX, PNG…), provided by the part that renders it. The
 * page lists every slot in its export menu; `run` downloads or saves the file itself.
 */
export type DesignExportSlot = { id: string; label: string; kinds?: DesignKind[]; run: (input: { client: DesignClient; workspaceId: string; design: DesignManifest }) => Promise<void> };

/** How often an open design checks for changes the agent made to its files. */
const POLL_MS = 3_000;

/** Route entry (`/design/:workspaceId/:designId`): resolves the owner connection, then shows the design. */
export function DesignPage({ workspaceId, designId, chat, exportSlots, onBack }: {
  workspaceId: string;
  designId: string;
  chat: DesignChatHost | null;
  exportSlots?: DesignExportSlot[];
  onBack: () => void;
}) {
  const connection = useDesignConnection();
  const client = connection.data ?? null;
  if (connection.isPending) return <PageSkeleton />;
  if (!client) return <PageError message={connection.error ? designErrorText(connection.error) : t("design_ui.studio.error_unknown")} onRetry={() => void connection.refetch()} onBack={onBack} />;
  return <DesignPagePanel client={client} workspaceId={workspaceId} designId={designId} chat={chat} exportSlots={exportSlots} onBack={onBack} />;
}

/** Download a blob under a file name (web and desktop). */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function DesignPagePanel({ client, workspaceId, designId, chat, exportSlots = [], onBack, editors = DESIGN_EDITORS, initialChatOpen = true }: {
  client: DesignClient;
  workspaceId: string;
  designId: string;
  chat: DesignChatHost | null;
  exportSlots?: DesignExportSlot[];
  onBack: () => void;
  editors?: Record<DesignKind, ComponentType<DesignEditorProps>>;
  initialChatOpen?: boolean;
}) {
  const queryClient = useQueryClient();
  const detailKey = designQueryKeys.detail(client.baseUrl, workspaceId, designId);
  const chatsKey = designQueryKeys.chats(client.baseUrl, workspaceId, designId);
  const detail = useQuery({
    queryKey: detailKey,
    queryFn: () => client.getDesign(workspaceId, designId),
    retry: false,
    refetchInterval: () => typeof document !== "undefined" && document.visibilityState === "hidden" ? false : POLL_MS,
  });
  const chats = useQuery({ queryKey: chatsKey, queryFn: () => client.listDesignChats(workspaceId, designId), retry: false });
  const [chatOpen, setChatOpen] = useState(initialChatOpen);
  const [startedSession, setStartedSession] = useState<string | null>(null);
  const [freshChat, setFreshChat] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [presentSignal, setPresentSignal] = useState(0);
  const toggleChat = useCallback(() => setChatOpen(open => !open), []);
  const design = detail.data?.design ?? null;
  const writable = detail.data?.writable === true;
  const revision = detail.data?.revision ?? 0;
  const sessionId = freshChat ? startedSession : startedSession ?? chats.data?.[0] ?? null;

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: detailKey });
    void queryClient.invalidateQueries({ queryKey: designQueryKeys.list(client.baseUrl) });
  }, [queryClient, client.baseUrl, workspaceId, designId]);

  useDesignThumbnailRefresh({ client, workspaceId, design, revision, writable, onSaved: refresh });

  const reportSession = chat?.onSessionChange;
  useEffect(() => {
    reportSession?.(sessionId);
  }, [reportSession, sessionId]);
  useEffect(() => () => reportSession?.(null), [reportSession]);

  // The latest values for the ask handler, which editors may keep across renders.
  const latest = useRef({ sessionId, chat, busy: chatBusy });
  latest.current = { sessionId, chat, busy: chatBusy };

  const start = useCallback(async (prompt: string) => {
    const host = latest.current.chat;
    if (!host || latest.current.busy) return;
    setChatBusy(true);
    setChatError(null);
    try {
      const created = await host.startChat(prompt);
      // Bind before the agent reads its first instruction entry: the guidance is per session.
      await client.bindDesignChat(workspaceId, designId, created);
      setStartedSession(created);
      setFreshChat(false);
      void queryClient.invalidateQueries({ queryKey: chatsKey });
    } catch (cause) { setChatError(designErrorText(cause)); }
    finally { setChatBusy(false); }
  }, [client, workspaceId, designId, queryClient]);

  const ask = useCallback((text: string, context?: string) => {
    const message = designAskMessage(text, context);
    if (!message) return;
    setChatOpen(true);
    const { sessionId: current, chat: host } = latest.current;
    if (!host) { setChatError(t("design_ui.studio.chat_unavailable")); return; }
    if (!current) { void start(message); return; }
    setChatError(null);
    void host.sendMessage(current, message).catch(cause => setChatError(designErrorText(cause)));
  }, [start]);

  const exportHtml = async (current: DesignManifest) => {
    setExporting("html");
    setExportError(null);
    try { downloadBlob(await client.exportDesignHtml(workspaceId, current.id), `${current.id}.zip`); }
    catch (cause) { setExportError(designErrorText(cause)); }
    finally { setExporting(null); }
  };
  const runSlot = async (slot: DesignExportSlot, current: DesignManifest) => {
    setExporting(slot.id);
    setExportError(null);
    try { await slot.run({ client, workspaceId, design: current }); }
    catch (cause) { setExportError(designErrorText(cause)); }
    finally { setExporting(null); }
  };

  if (!design) {
    return detail.isPending ? <PageSkeleton /> : <PageError message={designErrorText(detail.error)} onRetry={() => void detail.refetch()} onBack={onBack} />;
  }
  const Editor = editors[design.kind];
  const slots = exportSlots.filter(slot => !slot.kinds || slot.kinds.includes(design.kind));

  return <DesignClientContext value={client}>
    <main data-design-page={design.id} data-design-kind={design.kind} className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
        <Button variant="ghost" size="icon-sm" data-design-back aria-label={t("design_ui.studio.back")} title={t("design_ui.studio.back")} onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden />
        </Button>
        <DesignTitle key={design.id} title={design.title} writable={writable}
          onSave={async title => { await client.updateDesign(workspaceId, design.id, { title }); refresh(); }} />
        <span className="hidden truncate text-xs text-muted-foreground sm:inline">{designKindLabel(design.kind)}</span>
        <span className="ml-auto flex items-center gap-1">
          {design.kind === "slides" ? <Button variant="ghost" size="sm" data-design-present onClick={() => setPresentSignal(value => value + 1)}>
            <Play className="size-4" aria-hidden />{t("design_ui.studio.present")}
          </Button> : null}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" data-design-export disabled={exporting !== null} />}>
              <Download className="size-4" aria-hidden />{exporting ? t("design_ui.studio.exporting") : t("design_ui.studio.export")}<ChevronDown className="size-3.5" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {slots.map(slot => <DropdownMenuItem key={slot.id} data-design-export-format={slot.id} onClick={() => void runSlot(slot, design)}>{slot.label}</DropdownMenuItem>)}
              <DropdownMenuItem data-design-export-format="html" onClick={() => void exportHtml(design)}>{t("design_ui.studio.export_html")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant={chatOpen ? "secondary" : "ghost"} size="sm" data-design-chat-toggle aria-pressed={chatOpen} onClick={toggleChat}>
            <MessageSquare className="size-4" aria-hidden />{chatOpen ? t("design_ui.studio.chat_hide") : t("design_ui.studio.chat_show")}
          </Button>
        </span>
      </header>
      {!writable ? <p role="status" data-design-page-read-only className="flex flex-wrap items-center gap-x-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
        {t("design_ui.studio.page_read_only")} <PairDeviceHint />
      </p> : null}
      {exportError ? <p role="alert" data-design-export-error className="border-b border-border px-3 py-1.5 text-sm text-destructive">{exportError}</p> : null}
      {detail.isError ? <p role="alert" data-design-stale className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground">{t("design_ui.studio.stale", { message: designErrorText(detail.error) })}</p> : null}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <section aria-label={t("design_ui.studio.editor_label")} className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-auto p-3", chatOpen && "max-md:hidden")}>
          <Editor workspaceId={workspaceId} design={design} writable={writable} client={client} onChanged={refresh}
            chatOpen={chatOpen} onAskAgent={ask} revision={revision} reloadKey={revision} onToggleChat={toggleChat} presentSignal={presentSignal} />
        </section>
        {chatOpen ? <div className="flex min-h-0 flex-1 flex-col md:w-96 md:flex-none">
          <DesignChatPanel host={chat} sessionId={sessionId} busy={chatBusy} error={chatError} writable={writable}
            onStart={prompt => void start(prompt)}
            onNewChat={() => { setStartedSession(null); setFreshChat(true); setChatError(null); }}
            onClose={() => setChatOpen(false)} />
        </div> : null}
      </div>
    </main>
  </DesignClientContext>;
}

function DesignTitle({ title, writable, onSave }: { title: string; writable: boolean; onSave: (title: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!editing) setValue(title); }, [title, editing]);
  const commit = async () => {
    const next = value.trim();
    if (!next || next === title) { setEditing(false); setValue(title); return; }
    try { await onSave(next); setEditing(false); setError(null); }
    catch (cause) { setError(designErrorText(cause)); }
  };
  if (!editing) {
    return <h1 className="min-w-0 truncate text-sm font-semibold">
      {writable ? <button type="button" data-design-title onClick={() => setEditing(true)} title={t("design_ui.studio.rename")}
        className="max-w-full truncate rounded px-1 text-start hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">{title}</button>
        : <span data-design-title className="px-1">{title}</span>}
    </h1>;
  }
  return <span className="flex min-w-0 items-center gap-2">
    <Input data-design-title-input autoFocus aria-label={t("design_ui.studio.rename")} value={value} maxLength={DESIGN_LIMITS.titleChars}
      aria-invalid={error ? true : undefined} className="h-8 w-64 max-w-full"
      onChange={event => setValue(event.target.value)} onBlur={() => void commit()}
      onKeyDown={event => {
        if (event.key === "Enter") { event.preventDefault(); void commit(); }
        if (event.key === "Escape") { event.preventDefault(); setEditing(false); setValue(title); setError(null); }
      }} />
    {error ? <span role="alert" className="text-xs text-destructive">{error}</span> : null}
  </span>;
}

function PageSkeleton() {
  return <div aria-busy="true" aria-label={t("design_ui.studio.loading")} data-design-page-loading className="flex h-full flex-col gap-3 p-3">
    <Skeleton className="h-8 w-64 rounded-md" />
    <Skeleton className="min-h-64 w-full flex-1 rounded-xl" />
  </div>;
}

function PageError({ message, onRetry, onBack }: { message: string; onRetry: () => void; onBack: () => void }): ReactNode {
  return <div role="alert" data-design-page-error className="m-6 flex max-w-xl flex-col items-start gap-2 rounded-xl border border-border p-4">
    <p className="flex items-center gap-2 text-sm font-medium"><AlertTriangle className="size-4 text-destructive" aria-hidden />{t("design_ui.studio.page_error_title")}</p>
    <p className="text-sm text-muted-foreground">{message}</p>
    <span className="flex gap-2">
      <Button variant="outline" size="sm" onClick={onRetry}>{t("design_ui.studio.retry")}</Button>
      <Button variant="ghost" size="sm" onClick={onBack}>{t("design_ui.studio.back")}</Button>
    </span>
  </div>;
}

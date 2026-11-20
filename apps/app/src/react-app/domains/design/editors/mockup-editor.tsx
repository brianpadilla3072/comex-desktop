/** @jsxImportSource react */
import { useEffect, useId, useRef, useState } from "react";
import type { DesignManifest } from "@openwork/types/designs";
import { Minus, Monitor, Plus, Presentation, Send, Smartphone, Tablet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { t } from "@/i18n";

import { DesignFrame } from "../design-frame";
import {
  canAddPage, designFromReply, fitWidthScale, mockupAgentContext, mockupWidth, movePageId, MOCKUP_WIDTHS, nextZoom, pageAtWidth,
  presetForPage, renamePage, type MockupWidthId,
} from "./mockup-model";
import { MockupPresent } from "./mockup-present";
import { MockupScreens } from "./mockup-screens";
import { mockupTemplateHtml, type MockupTemplateId } from "./mockup-templates";
import type { MockupEditorProps } from "./mockup-types";
// TODO(orchestrator, after merging C): enable the comment/edit bar (three marked spots in this file).
// import { useDesignPicker } from "../design-picker";
// import { DesignCommentBar } from "../design-comment-bar";

export type { MockupEditorClient, MockupEditorProps } from "./mockup-types";

const WIDTH_ICONS = { desktop: Monitor, tablet: Tablet, phone: Smartphone } as const;
const isWidthId = (value: unknown): value is MockupWidthId => MOCKUP_WIDTHS.some(entry => entry.id === value);

export function MockupEditor(props: MockupEditorProps) {
  const { workspaceId, writable, client } = props;
  const [design, setDesign] = useState<DesignManifest>(props.design);
  const [currentId, setCurrentId] = useState<string | null>(props.design.pages[0]?.id ?? null);
  const [width, setWidth] = useState<MockupWidthId>(() => presetForPage(props.design.pages[0]));
  const [zoom, setZoom] = useState<"fit" | number>("fit");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** Bumped when the screen's files changed from here (comment/edit), so the frame re-renders. */
  const [frameVersion, setFrameVersion] = useState(0);
  const [asking, setAsking] = useState(false);
  const [askText, setAskText] = useState("");
  const [presenting, setPresenting] = useState(false);
  const [available, setAvailable] = useState(960);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const askId = useId();

  // The parent refetches the manifest after changes (ours or the agent's); follow it.
  useEffect(() => {
    setDesign(props.design);
  }, [props.design]);

  /** For the comment/edit bar: its edits change the page file, so the frame reloads and the parent refetches. */
  const onFilesChanged = () => {
    setFrameVersion(value => value + 1);
    props.onChanged();
  };
  // TODO(orchestrator, after merging C): replace the next line with
  // const picker = useDesignPicker({ workspaceId, design, client, writable, onAskAgent: props.onAskAgent, onChanged: onFilesChanged });
  void onFilesChanged;
  const frameReloadKey = `${props.reloadKey ?? design.updatedAt}:${frameVersion}`;

  const pages = design.pages;
  const currentIndex = Math.max(0, pages.findIndex(page => page.id === currentId));
  const current = pages[currentIndex] ?? null;

  useEffect(() => {
    if (current && current.id !== currentId) setCurrentId(current.id);
  }, [current, currentId]);

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const measure = () => {
      const value = element.getBoundingClientRect().width || element.clientWidth;
      if (value > 0) setAvailable(value);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const page = current ? pageAtWidth(current, width) : null;
  const scale = page ? (zoom === "fit" ? fitWidthScale(available, page.width) : zoom) : 1;

  const run = async (action: () => Promise<void>, failure: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await action();
    } catch {
      setNotice(failure);
    } finally {
      setBusy(false);
    }
  };

  const adopt = (reply: unknown): DesignManifest | null => {
    const next = designFromReply(reply);
    if (next) setDesign(next);
    props.onChanged();
    return next;
  };

  const addScreen = (template: MockupTemplateId, title?: string, html?: string, afterPageId = current?.id) => run(async () => {
    const before = new Set(pages.map(p => p.id));
    const name = title ?? (template === "blank" ? t("design_ui.mockup.untitled", { number: pages.length + 1 }) : t(`design_ui.mockup.template.${template}`));
    const reply = await client.addDesignPage(workspaceId, design.id, { title: name, afterPageId, html: html ?? mockupTemplateHtml(template, name) });
    const next = adopt(reply);
    const added = next?.pages.find(p => !before.has(p.id));
    if (added) setCurrentId(added.id);
  }, t("design_ui.mockup.error.add"));

  const moveScreen = (pageId: string, delta: number) => {
    const ids = movePageId(pages.map(p => p.id), pageId, delta);
    if (ids.join() === pages.map(p => p.id).join()) return;
    const previous = design;
    const byId = new Map(pages.map(p => [p.id, p]));
    setDesign({ ...design, pages: ids.flatMap(id => byId.get(id) ?? []) });
    void run(async () => {
      try {
        adopt(await client.reorderDesignPages(workspaceId, design.id, ids));
      } catch (error) {
        setDesign(previous);
        throw error;
      }
    }, t("design_ui.mockup.error.reorder"));
  };

  const renameScreen = (pageId: string, title: string) => {
    const renamed = renamePage(design, pageId, title);
    if (!renamed) return;
    const previous = design;
    setDesign(renamed);
    void run(async () => {
      try {
        if (client.updateDesignPage) adopt(await client.updateDesignPage(workspaceId, design.id, pageId, { title: title.trim() }));
        else adopt(await client.writeDesignFile(workspaceId, design.id, "design.json", `${JSON.stringify(renamed, null, 2)}\n`));
      } catch (error) {
        setDesign(previous);
        throw error;
      }
    }, t("design_ui.mockup.error.rename"));
  };

  const duplicateScreen = (pageId: string) => {
    const source = pages.find(p => p.id === pageId);
    if (!source) return;
    void run(async () => {
      const html = await (await client.readDesignFile(workspaceId, design.id, source.file)).text();
      const before = new Set(pages.map(p => p.id));
      const reply = await client.addDesignPage(workspaceId, design.id, { title: t("design_ui.mockup.copy_of", { title: source.title }).slice(0, 120), afterPageId: pageId, html });
      const added = adopt(reply)?.pages.find(p => !before.has(p.id));
      if (added) setCurrentId(added.id);
    }, t("design_ui.mockup.error.add"));
  };

  const deleteScreen = async (pageId: string) => {
    const target = pages.find(p => p.id === pageId);
    if (!target || pages.length <= 1) return;
    const confirmed = await confirmDialog({
      title: t("design_ui.mockup.delete_confirm", { title: target.title }),
      confirmLabel: t("design_ui.mockup.delete"),
      destructive: true,
    });
    if (!confirmed) return;
    const index = pages.findIndex(p => p.id === pageId);
    await run(async () => {
      const next = adopt(await client.deleteDesignPage(workspaceId, design.id, pageId));
      const remaining = (next ?? design).pages.filter(p => p.id !== pageId);
      if (!next) setDesign({ ...design, pages: remaining });
      if (pageId === currentId) setCurrentId(remaining[Math.min(index, remaining.length - 1)]?.id ?? null);
    }, t("design_ui.mockup.error.delete"));
  };

  const sendAsk = () => {
    const text = askText.trim();
    if (!text) return;
    props.onAskAgent(text, mockupAgentContext(design, current, width));
    setAskText("");
    setAsking(false);
  };

  const zoomLabel = `${Math.round(scale * 100)}%`;

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row" data-mockup-editor="">
      <aside className="flex max-h-48 shrink-0 flex-col border-b border-border p-2 md:max-h-none md:w-56 md:border-e md:border-b-0">
        <MockupScreens
          pages={pages}
          currentId={current?.id ?? null}
          writable={writable}
          busy={busy}
          canAdd={canAddPage(design)}
          onSelect={setCurrentId}
          onAdd={template => void addScreen(template)}
          onAskAgent={() => setAsking(true)}
          onRename={renameScreen}
          onMove={moveScreen}
          onDuplicate={duplicateScreen}
          onDelete={pageId => void deleteScreen(pageId)}
        />
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div role="toolbar" aria-label={t("design_ui.mockup.toolbar_label")} className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <ToggleGroup
            variant="segmented"
            size="sm"
            aria-label={t("design_ui.mockup.width_label")}
            value={[width]}
            onValueChange={(value: unknown[]) => {
              const next = value.find(isWidthId);
              if (next) {
                setWidth(next);
                setZoom("fit");
              }
            }}
          >
            {MOCKUP_WIDTHS.map(entry => {
              const Icon = WIDTH_ICONS[entry.id];
              return (
                <ToggleGroupItem key={entry.id} value={entry.id} data-mockup-width={entry.id} title={t("design_ui.mockup.width_px", { width: entry.width })}>
                  <Icon />
                  {t(`design_ui.mockup.width.${entry.id}`)}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
          <div role="group" aria-label={t("design_ui.mockup.zoom_label")} className="flex items-center gap-0.5">
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t("design_ui.mockup.zoom_out")} onClick={() => setZoom(nextZoom(scale, -1))}><Minus /></Button>
            <span className="min-w-12 text-center text-xs tabular-nums text-muted-foreground" data-mockup-zoom="">{zoomLabel}</span>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t("design_ui.mockup.zoom_in")} onClick={() => setZoom(nextZoom(scale, 1))}><Plus /></Button>
            <Button type="button" variant="ghost" size="xs" aria-pressed={zoom === "fit"} onClick={() => setZoom("fit")}>{t("design_ui.mockup.zoom_fit")}</Button>
          </div>
          <div className="ms-auto flex items-center gap-2">
            {notice ? <span role="alert" className="text-xs text-destructive">{notice}</span> : null}
            {/* TODO(orchestrator, after merging C): {page ? <DesignCommentBar picker={picker} /> : null} */}
            <Button type="button" variant="outline" size="sm" disabled={!pages.length} onClick={() => setPresenting(true)}>
              <Presentation />
              {t("design_ui.mockup.present")}
            </Button>
          </div>
        </div>
        <div ref={canvasRef} className="min-h-0 flex-1 overflow-auto bg-muted/30">
          {page ? (
            <div className="flex min-w-fit justify-center p-8">
              <div
                data-mockup-canvas={width}
                style={{ width: page.width * scale, height: page.height * scale }}
                className="shrink-0 overflow-hidden rounded-md bg-background shadow-[var(--dls-card-shadow)]"
              >
                <DesignFrame
                  key={`${page.id}:${width}`}
                  workspaceId={workspaceId}
                  designId={design.id}
                  page={page}
                  scale={scale}
                  interactive
                  reloadKey={frameReloadKey}
                  // TODO(orchestrator, after merging C): onFrameReady={picker.bindFrame(page)}
                />
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm text-muted-foreground">{t("design_ui.mockup.empty")}</p>
              {writable ? (
                <Button type="button" onClick={() => void addScreen("blank")} disabled={busy}>
                  <Plus />
                  {t("design_ui.mockup.add_first")}
                </Button>
              ) : null}
            </div>
          )}
        </div>
        <p className="sr-only" aria-live="polite">{page ? t("design_ui.mockup.viewing", { title: page.title, width: mockupWidth(width).width }) : ""}</p>
      </div>
      <Dialog open={asking} onOpenChange={open => setAsking(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("design_ui.mockup.ask_title")}</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-2"
            onSubmit={event => {
              event.preventDefault();
              sendAsk();
            }}
          >
            <label htmlFor={askId} className="sr-only">{t("design_ui.mockup.ask_title")}</label>
            <Textarea
              id={askId}
              value={askText}
              rows={4}
              maxLength={4_000}
              placeholder={t("design_ui.mockup.ask_placeholder")}
              onChange={event => setAskText(event.currentTarget.value)}
              onKeyDown={event => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  sendAsk();
                }
              }}
            />
            <DialogFooter>
              <Button type="submit" disabled={!askText.trim()}>
                <Send />
                {t("design_ui.mockup.ask_send")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {presenting && pages.length ? (
        <MockupPresent
          workspaceId={workspaceId}
          designId={design.id}
          pages={pages}
          startIndex={currentIndex}
          width={width}
          reloadKey={frameReloadKey}
          onClose={() => setPresenting(false)}
        />
      ) : null}
    </div>
  );
}

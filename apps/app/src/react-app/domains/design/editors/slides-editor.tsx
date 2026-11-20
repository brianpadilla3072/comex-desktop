/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";
import {
  ChevronDown, ChevronUp, Copy, Download, Ellipsis, Image as ImageIcon, PanelRight, Plus,
  Presentation, Shapes, Table, Trash2, Type, ZoomIn, ZoomOut,
} from "lucide-react";
import type { DesignManifest, DesignPage } from "@openwork/types/designs";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";
import { DesignFrame } from "../design-frame";
import { exportPdf, exportPng, exportPptx, SlidesExportError, type SlidesExportClient } from "./slides-export";
import {
  addedPageId, askAgentContext, assetPathForUpload, elementSnippet, imageSnippet, insertIntoBody, manifestWithNotes,
  movePageId, orderPages, resolveZoom, selectionAfterDelete, SLIDE_IMAGE_ACCEPT, SLIDE_SIZE, SLIDE_TEMPLATES,
  slideTemplateHtml, stepZoom, ZOOM_STEPS, type SlideElementKind, type SlidesClient, type SlideTemplate, type SlideZoom,
} from "./slides-model";
import { SlidesPresenter } from "./slides-present";
import { useDesignPicker } from "../design-picker";
import { DesignCommentBar } from "../design-comment-bar";

export type SlidesEditorProps = {
  workspaceId: string;
  design: DesignManifest;
  writable: boolean;
  client: SlidesClient & Partial<Pick<SlidesExportClient, "exportDesignPptx">>;
  onChanged: () => void;
  chatOpen: boolean;
  onAskAgent: (text: string, context?: string) => void;
  /** Shows the "Chat" toolbar toggle when the page lets the editor open/close the chat. */
  onToggleChat?: () => void;
  /** Increment to start presenting from the selected slide (the page header's "Presentar"). */
  presentSignal?: number;
};

const THUMB_WIDTH = 168;
const NOTES_SAVE_DELAY_MS = 800;

function errorText(error: unknown, fallback: string): string {
  if (error instanceof SlidesExportError) return t(`design_ui.slides.export.error.${error.code}`);
  return fallback;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

/** Speaker notes for one slide: saved into design.json shortly after typing stops and on blur. */
function SlideNotes({ page, writable, onSave }: { page: DesignPage; writable: boolean; onSave: (pageId: string, notes: string) => Promise<void> }) {
  const [draft, setDraft] = useState(page.notes ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const savedRef = useRef(page.notes ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const value = draftRef.current;
    if (value === savedRef.current) return;
    setState("saving");
    try {
      await onSave(page.id, value);
      savedRef.current = value;
      setState("saved");
    } catch {
      setState("error");
    }
  }, [onSave, page.id]);

  // Another page or an outside change (the agent) replaces the draft only when nothing is pending.
  useEffect(() => {
    if (draftRef.current === savedRef.current) { setDraft(page.notes ?? ""); savedRef.current = page.notes ?? ""; }
  }, [page.notes]);
  useEffect(() => () => { void flush(); }, [flush]);

  return (
    <section className="flex shrink-0 flex-col gap-1.5 border-t border-border px-4 py-3" aria-labelledby={`slide-notes-${page.id}`}>
      <div className="flex items-center justify-between gap-2">
        <label id={`slide-notes-${page.id}`} htmlFor={`slide-notes-input-${page.id}`} className="text-sm font-medium text-foreground">{t("design_ui.slides.notes.label")}</label>
        <span className="text-xs text-muted-foreground" aria-live="polite" data-slides-notes-state={state}>
          {state === "saving" ? t("design_ui.slides.notes.saving") : state === "saved" ? t("design_ui.slides.notes.saved") : state === "error" ? t("design_ui.slides.notes.error") : ""}
        </span>
      </div>
      <Textarea
        id={`slide-notes-input-${page.id}`}
        data-slides-notes
        value={draft}
        readOnly={!writable}
        maxLength={10_000}
        rows={3}
        placeholder={writable ? t("design_ui.slides.notes.placeholder") : t("design_ui.slides.read_only")}
        className="max-h-40 min-h-16 resize-y"
        onChange={event => {
          setDraft(event.target.value);
          draftRef.current = event.target.value;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => { void flush(); }, NOTES_SAVE_DELAY_MS);
        }}
        onBlur={() => { void flush(); }}
      />
    </section>
  );
}

export function SlidesEditor(props: SlidesEditorProps) {
  const { workspaceId, design, writable, client, onChanged, chatOpen, onAskAgent, onToggleChat, presentSignal } = props;
  const [orderOverride, setOrderOverride] = useState<string[] | null>(null);
  const pages = useMemo(() => orderPages(design.pages, orderOverride), [design.pages, orderOverride]);
  const ids = useMemo(() => pages.map(page => page.id), [pages]);
  const [selectedId, setSelectedId] = useState<string | null>(design.pages[0]?.id ?? null);
  const selected = pages.find(page => page.id === selectedId) ?? pages[0] ?? null;
  const selectedIndex = selected ? ids.indexOf(selected.id) : -1;
  const [zoom, setZoom] = useState<SlideZoom>("fit");
  const [stageBox, setStageBox] = useState({ width: 960, height: 540 });
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [presenting, setPresenting] = useState<number | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const thumbRefs = useRef(new Map<string, HTMLButtonElement>());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const designRef = useRef(design);
  designRef.current = design;

  // The server order wins once it arrives.
  const serverOrder = design.pages.map(page => page.id).join("\n");
  useEffect(() => { setOrderOverride(null); }, [serverOrder]);
  // A selected id the design does not list (yet, or anymore) falls back to the first slide
  // without being forgotten: a page just added appears selected once the design reloads.

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (rect) setStageBox({ width: rect.width, height: rect.height });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const lastSignal = useRef(presentSignal ?? 0);
  useEffect(() => {
    if (presentSignal === undefined || presentSignal === lastSignal.current) return;
    lastSignal.current = presentSignal;
    if (pages.length) setPresenting(Math.max(0, selectedIndex));
  }, [presentSignal, pages.length, selectedIndex]);

  const scale = selected ? resolveZoom(zoom, stageBox, selected) : 1;
  const zoomPercent = Math.round(scale * 100);

  const run = useCallback(async (label: string, action: () => Promise<void>, failure: string) => {
    setBusy(label);
    try {
      await action();
    } catch (error) {
      toast.error(errorText(error, failure));
    } finally {
      setBusy(null);
    }
  }, []);

  const select = useCallback((pageId: string, focus = false) => {
    setSelectedId(pageId);
    if (focus) requestAnimationFrame(() => thumbRefs.current.get(pageId)?.focus());
  }, []);

  const changed = useCallback(() => { setRevision(value => value + 1); onChanged(); }, [onChanged]);
  // Comentar / Editar on the main slide; `changed` bumps the frames' reloadKey after an edit.
  const picker = useDesignPicker({ workspaceId, design, client, writable, onAskAgent, onChanged: changed });

  const addSlide = (template: SlideTemplate) => run("add", async () => {
    const html = slideTemplateHtml(template, {
      title: t("design_ui.slides.template.sample_title"),
      subtitle: t("design_ui.slides.template.sample_subtitle"),
      body: t("design_ui.slides.template.sample_body"),
      left: t("design_ui.slides.template.sample_left"),
      right: t("design_ui.slides.template.sample_right"),
    });
    const before = designRef.current.pages;
    const result = await client.addDesignPage(workspaceId, design.id, { title: t(`design_ui.slides.template.${template}`), afterPageId: selected?.id, html });
    const added = addedPageId(before, result.pages);
    if (added) setSelectedId(added);
    changed();
  }, t("design_ui.slides.error.add"));

  const askAgent = () => {
    onAskAgent(
      selected ? t("design_ui.slides.ask_agent.after", { position: selectedIndex + 1, title: selected.title || String(selectedIndex + 1) }) : t("design_ui.slides.ask_agent.first"),
      askAgentContext(design, selected?.id ?? null),
    );
  };

  const duplicate = (page: DesignPage) => run("duplicate", async () => {
    const html = await (await client.readDesignFile(workspaceId, design.id, page.file)).text();
    const before = designRef.current.pages;
    const result = await client.addDesignPage(workspaceId, design.id, { title: t("design_ui.slides.copy_title", { title: page.title }), afterPageId: page.id, html });
    const added = addedPageId(before, result.pages);
    if (added && page.notes) {
      const manifest = await (await client.readDesignFile(workspaceId, design.id, "design.json")).text();
      await client.writeDesignFile(workspaceId, design.id, "design.json", manifestWithNotes(manifest, added, page.notes));
    }
    if (added) setSelectedId(added);
    changed();
  }, t("design_ui.slides.error.duplicate"));

  const remove = async (page: DesignPage) => {
    if (pages.length <= 1) { toast.error(t("design_ui.slides.error.last_slide")); return; }
    const confirmed = await confirmDialog({
      title: t("design_ui.slides.delete.title", { title: page.title || String(ids.indexOf(page.id) + 1) }),
      confirmLabel: t("design_ui.slides.delete.confirm"),
      destructive: true,
    });
    if (!confirmed) return;
    const next = selectionAfterDelete(ids, page.id);
    await run("delete", async () => {
      await client.deleteDesignPage(workspaceId, design.id, page.id);
      if (next) select(next, true);
      changed();
    }, t("design_ui.slides.error.delete"));
  };

  const move = (pageId: string, toIndex: number) => {
    const next = movePageId(ids, pageId, toIndex);
    if (next.join("\n") === ids.join("\n")) return;
    const previous = orderOverride;
    setOrderOverride(next);
    void run("reorder", async () => {
      try {
        await client.reorderDesignPages(workspaceId, design.id, next);
        onChanged();
      } catch (error) {
        setOrderOverride(previous);
        throw error;
      }
    }, t("design_ui.slides.error.reorder"));
  };

  const insertElement = (snippet: string) => {
    if (!selected) return;
    const page = selected;
    return run("insert", async () => {
      const html = await (await client.readDesignFile(workspaceId, design.id, page.file)).text();
      await client.writeDesignFile(workspaceId, design.id, page.file, insertIntoBody(html, snippet));
      changed();
    }, t("design_ui.slides.error.insert"));
  };

  const insertKind = (kind: SlideElementKind) => insertElement(elementSnippet(kind, {
    text: t("design_ui.slides.element.text_sample"),
    cell: (row, column) => (row === 0 ? t("design_ui.slides.element.table_header", { column: column + 1 }) : ""),
  }));

  const uploadImage = (file: File) => {
    const path = assetPathForUpload(file, randomSuffix());
    if (!path) { toast.error(t("design_ui.slides.error.image_type")); return; }
    if (!selected) return;
    const page = selected;
    void run("image", async () => {
      await client.writeDesignFile(workspaceId, design.id, path, file);
      const html = await (await client.readDesignFile(workspaceId, design.id, page.file)).text();
      const alt = file.name.replace(/\.[^.]*$/, "");
      await client.writeDesignFile(workspaceId, design.id, page.file, insertIntoBody(html, imageSnippet(path, alt)));
      changed();
    }, t("design_ui.slides.error.image"));
  };

  const saveNotes = useCallback(async (pageId: string, notes: string) => {
    const manifest = await (await client.readDesignFile(workspaceId, design.id, "design.json")).text();
    await client.writeDesignFile(workspaceId, design.id, "design.json", manifestWithNotes(manifest, pageId, notes));
    onChanged();
  }, [client, design.id, onChanged, workspaceId]);

  const exportAs = (format: "pdf" | "png" | "png-current" | "pptx") => run("export", async () => {
    const target = { workspaceId, design: { ...design, pages }, pageIds: format === "png-current" && selected ? [selected.id] : undefined };
    const deps = { client };
    if (format === "pdf") await exportPdf(target, deps);
    else if (format === "pptx") await exportPptx(target, deps);
    else await exportPng(target, deps);
  }, t("design_ui.slides.export.error.generic"));

  const onThumbKey = (event: KeyboardEvent<HTMLButtonElement>, page: DesignPage, index: number) => {
    const vertical = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (vertical && event.altKey && writable) {
      event.preventDefault();
      move(page.id, index + vertical);
      requestAnimationFrame(() => thumbRefs.current.get(page.id)?.focus());
      return;
    }
    if (vertical) {
      event.preventDefault();
      const target = ids[index + vertical];
      if (target) select(target, true);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const target = event.key === "Home" ? ids[0] : ids[ids.length - 1];
      if (target) select(target, true);
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && writable) {
      event.preventDefault();
      void remove(page);
    }
  };

  const onDragOver = (event: DragEvent<HTMLLIElement>, index: number) => {
    if (!dragId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    setDropIndex(after ? index + 1 : index);
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (dragId !== null && dropIndex !== null) {
      const from = ids.indexOf(dragId);
      move(dragId, dropIndex > from ? dropIndex - 1 : dropIndex);
    }
    setDragId(null);
    setDropIndex(null);
  };

  const readOnlyTitle = writable ? undefined : t("design_ui.slides.read_only");
  const thumbScale = THUMB_WIDTH / SLIDE_SIZE.width;

  return (
    <div className="flex h-full min-h-0 w-full flex-col" data-slides-editor>
      <div role="toolbar" aria-label={t("design_ui.slides.toolbar.label")} className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-3 py-1.5">
        <Button variant="ghost" size="sm" disabled={!writable || !selected || busy !== null} title={readOnlyTitle} onClick={() => insertKind("text")} data-slides-insert="text"><Type aria-hidden />{t("design_ui.slides.toolbar.text")}</Button>
        <Button variant="ghost" size="sm" disabled={!writable || !selected || busy !== null} title={readOnlyTitle} onClick={() => fileInputRef.current?.click()} data-slides-insert="image"><ImageIcon aria-hidden />{t("design_ui.slides.toolbar.image")}</Button>
        <input
          ref={fileInputRef}
          type="file"
          accept={SLIDE_IMAGE_ACCEPT}
          className="hidden"
          aria-hidden
          tabIndex={-1}
          data-slides-image-input
          onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) uploadImage(file);
          }}
        />
        <Button variant="ghost" size="sm" disabled={!writable || !selected || busy !== null} title={readOnlyTitle} onClick={() => insertKind("table")} data-slides-insert="table"><Table aria-hidden />{t("design_ui.slides.toolbar.table")}</Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" disabled={!writable || !selected || busy !== null} title={readOnlyTitle} data-slides-insert="shapes" />}>
            <Shapes aria-hidden />{t("design_ui.slides.toolbar.shapes")}<ChevronDown className="size-3.5" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => insertKind("rect")}>{t("design_ui.slides.shape.rect")}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => insertKind("ellipse")}>{t("design_ui.slides.shape.ellipse")}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => insertKind("line")}>{t("design_ui.slides.shape.line")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DesignCommentBar picker={picker} />
        <div className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Button variant="ghost" size="icon-sm" aria-label={t("design_ui.slides.zoom.out")} onClick={() => setZoom(stepZoom(scale, -1))}><ZoomOut aria-hidden /></Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="min-w-20 tabular-nums" aria-label={t("design_ui.slides.zoom.label", { percent: zoomPercent })} data-slides-zoom />}>
            {zoom === "fit" ? t("design_ui.slides.zoom.fit") : `${zoomPercent}%`}<ChevronDown className="size-3.5" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => setZoom("fit")}>{t("design_ui.slides.zoom.fit")}</DropdownMenuItem>
            <DropdownMenuSeparator />
            {ZOOM_STEPS.map(step => <DropdownMenuItem key={step} onClick={() => setZoom(step)}>{`${Math.round(step * 100)}%`}</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="icon-sm" aria-label={t("design_ui.slides.zoom.in")} onClick={() => setZoom(stepZoom(scale, 1))}><ZoomIn aria-hidden /></Button>
        <div className="ms-auto flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="sm" disabled={!pages.length || busy !== null} data-slides-export />}>
              <Download aria-hidden />{t("design_ui.slides.export.label")}<ChevronDown className="size-3.5" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => exportAs("pdf")}>{t("design_ui.slides.export.pdf")}</DropdownMenuItem>
              <DropdownMenuItem disabled={!client.exportDesignPptx} onClick={() => exportAs("pptx")}>{t("design_ui.slides.export.pptx")}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportAs("png-current")}>{t("design_ui.slides.export.png_current")}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportAs("png")}>{t("design_ui.slides.export.png_all")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" disabled={!pages.length} onClick={() => setPresenting(Math.max(0, selectedIndex))} data-slides-present>
            <Presentation aria-hidden />{t("design_ui.slides.toolbar.present")}
          </Button>
          {onToggleChat ? (
            <Button variant="ghost" size="sm" aria-pressed={chatOpen} onClick={onToggleChat} data-slides-chat>
              <PanelRight aria-hidden />{t("design_ui.slides.toolbar.chat")}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav aria-label={t("design_ui.slides.list.label")} className="flex w-56 shrink-0 flex-col border-e border-border max-md:w-40">
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="text-sm font-medium text-foreground">{t("design_ui.slides.list.count", { count: pages.length })}</span>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" disabled={!writable || busy !== null} aria-label={t("design_ui.slides.add.label")} title={readOnlyTitle ?? t("design_ui.slides.add.label")} data-slides-add />}>
                <Plus aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {SLIDE_TEMPLATES.map(template => (
                  <DropdownMenuItem key={template} onClick={() => addSlide(template)} data-slides-template={template}>{t(`design_ui.slides.template.${template}`)}</DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={askAgent} data-slides-ask-agent>{t("design_ui.slides.add.ask_agent")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <ol className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-3" onDragOver={event => { if (dragId) event.preventDefault(); }} onDrop={onDrop}>
            {pages.map((page, index) => {
              const active = page.id === selected?.id;
              return (
                <li
                  key={page.id}
                  draggable={writable}
                  data-slides-thumb={page.id}
                  className={`relative flex flex-col gap-1 rounded-lg p-1 ${dragId === page.id ? "opacity-50" : ""}`}
                  onDragStart={event => { setDragId(page.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", page.id); }}
                  onDragEnd={() => { setDragId(null); setDropIndex(null); }}
                  onDragOver={event => onDragOver(event, index)}
                >
                  {dropIndex === index && dragId ? <div className="h-0.5 rounded-full bg-primary" aria-hidden /> : null}
                  <div className="flex items-start gap-1.5">
                    <span className="w-5 pt-1 text-end text-xs tabular-nums text-muted-foreground" aria-hidden>{index + 1}</span>
                    <div className="group/thumb relative min-w-0 flex-1">
                      <button
                        type="button"
                        ref={node => { if (node) thumbRefs.current.set(page.id, node); else thumbRefs.current.delete(page.id); }}
                        aria-current={active ? "true" : undefined}
                        aria-label={t("design_ui.slides.list.item", { position: index + 1, title: page.title || String(index + 1) })}
                        aria-keyshortcuts="ArrowUp ArrowDown Alt+ArrowUp Alt+ArrowDown Delete"
                        className={`block w-full overflow-hidden rounded-md outline-none ring-offset-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-ring ${active ? "ring-2 ring-primary" : "ring-1 ring-border hover:ring-foreground/30"}`}
                        style={{ aspectRatio: `${SLIDE_SIZE.width} / ${SLIDE_SIZE.height}` }}
                        onClick={() => select(page.id)}
                        onKeyDown={event => onThumbKey(event, page, index)}
                      >
                        <div className="pointer-events-none" style={{ width: THUMB_WIDTH, height: SLIDE_SIZE.height * thumbScale }}>
                          <DesignFrame workspaceId={workspaceId} designId={design.id} page={page} scale={thumbScale} interactive={false} reloadKey={revision} />
                        </div>
                      </button>
                      {writable ? (
                        <div className="absolute end-1 top-1 opacity-0 transition-opacity duration-150 ease-out focus-within:opacity-100 group-hover/thumb:opacity-100 motion-reduce:transition-none">
                          <DropdownMenu>
                            <DropdownMenuTrigger render={<Button variant="secondary" size="icon-xs" aria-label={t("design_ui.slides.list.actions", { position: index + 1 })} data-slides-actions={page.id} />}>
                              <Ellipsis aria-hidden />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => duplicate(page)} data-slides-duplicate><Copy aria-hidden />{t("design_ui.slides.list.duplicate")}</DropdownMenuItem>
                              <DropdownMenuItem disabled={index === 0} onClick={() => move(page.id, index - 1)}><ChevronUp aria-hidden />{t("design_ui.slides.list.move_up")}</DropdownMenuItem>
                              <DropdownMenuItem disabled={index === pages.length - 1} onClick={() => move(page.id, index + 1)}><ChevronDown aria-hidden />{t("design_ui.slides.list.move_down")}</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onClick={() => { void remove(page); }} data-slides-delete><Trash2 aria-hidden />{t("design_ui.slides.list.delete")}</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  {dropIndex === index + 1 && index === pages.length - 1 && dragId ? <div className="h-0.5 rounded-full bg-primary" aria-hidden /> : null}
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div ref={stageRef} className={`relative min-h-0 flex-1 bg-muted/40 ${zoom === "fit" ? "overflow-hidden" : "overflow-auto"}`} data-slides-stage>
            {selected ? (
              <div className="flex min-h-full min-w-full items-center justify-center p-8" style={{ width: zoom === "fit" ? undefined : selected.width * scale + 64 }}>
                <div className="shrink-0 overflow-hidden rounded-sm shadow-[var(--dls-card-shadow)]" style={{ width: selected.width * scale, height: selected.height * scale }}>
                  <DesignFrame
                    workspaceId={workspaceId}
                    designId={design.id}
                    page={selected}
                    scale={scale}
                    interactive
                    reloadKey={revision}
                    onFrameReady={picker.bindFrame(selected)}
                  />
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                <p className="text-sm text-muted-foreground">{t("design_ui.slides.empty")}</p>
                {writable ? <Button size="sm" onClick={() => addSlide("title")}><Plus aria-hidden />{t("design_ui.slides.add.first")}</Button> : null}
              </div>
            )}
          </div>
          {selected ? <SlideNotes key={selected.id} page={selected} writable={writable} onSave={saveNotes} /> : null}
        </div>
      </div>

      {presenting !== null ? (
        <SlidesPresenter
          workspaceId={workspaceId}
          designId={design.id}
          pages={pages}
          startIndex={presenting}
          onExit={last => {
            setPresenting(null);
            const id = ids[last];
            if (id) select(id, true);
          }}
        />
      ) : null}
    </div>
  );
}

export default SlidesEditor;

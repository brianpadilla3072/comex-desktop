/** @jsxImportSource react */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { DESIGN_LIMITS, type Board } from "@openwork/types/designs";
import { Maximize, Minus, Plus, Send } from "lucide-react";

import { OpenworkServerError } from "@/app/lib/openwork-server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

import { boardAgentContext } from "./board-agent";
import { BoardCanvas } from "./board-canvas";
import { downloadFramePng, imageMimeType } from "./board-export";
import { BoardFrames } from "./board-frames";
import { BoardImageDialog, uploadAssetPath } from "./board-image-dialog";
import { useBoardImages } from "./board-images";
import {
  addElements, arrangeElements, BOARD_DEFAULT_SIZES, BOARD_TOOLS, canAddElements, createHistory, deleteElements, duplicateElements,
  elementBounds, emptyBoard, fitBounds, frames, LINE_HEIGHT, makeElement, moveElements, assignFrames, newElementId, parseBoard,
  pushHistory, redo, serializeBoard, setElementText, undo, unionBounds, updateStyle, wrapText, zoomAt, clampZoom,
  type ArrangeAction, type BoardHistory, type BoardStyle, type BoardTool, type Point, type Viewport,
} from "./board-model";
import { BoardStylePanel } from "./board-style-panel";
import { BoardToolbar, withShortcut } from "./board-toolbar";
import { BOARD_FILE, type BoardEditorProps } from "./board-types";

export type { BoardEditorProps, BoardEditorClient } from "./board-types";

const SAVE_DELAY_MS = 600;
const DEFAULT_SIZE = { width: 960, height: 640 };

type LoadState = "loading" | "ready" | "invalid" | "error";
type SaveState = "saved" | "pending" | "saving" | "error";

/** A board.json written without a viewport (e.g. by the agent) opens fitted to its content. */
const hasViewport = (text: string) => /"viewport"\s*:/.test(text);

/** Natural size of an image (SVG from its attributes, others decoded), capped to a comfortable size. */
export async function imageNaturalSize(blob: Blob, type: string | null): Promise<{ width: number; height: number }> {
  const fallback = BOARD_DEFAULT_SIZES.image;
  let size: { width: number; height: number } | null = null;
  try {
    if (type === "image/svg+xml") {
      const text = await blob.text();
      const root = /<svg\b[^>]*>/i.exec(text)?.[0] ?? "";
      const number = (name: string) => {
        const value = new RegExp(`\\s${name}="([0-9.]+)(px)?"`, "i").exec(root)?.[1];
        return value ? Number(value) : null;
      };
      const viewBox = /viewBox="[-0-9.]+[ ,]+[-0-9.]+[ ,]+([0-9.]+)[ ,]+([0-9.]+)"/i.exec(root);
      const width = number("width") ?? (viewBox ? Number(viewBox[1]) : null);
      const height = number("height") ?? (viewBox ? Number(viewBox[2]) : null);
      if (width && height) size = { width, height };
    } else if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(blob);
      size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
    }
  } catch {
    size = null;
  }
  if (!size || !size.width || !size.height) return fallback;
  const scale = Math.min(1, 480 / size.width, 480 / size.height);
  return { width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
}

export function BoardEditor(props: BoardEditorProps) {
  const { workspaceId, design, writable, client } = props;
  const read = useCallback((path: string) => client.readDesignFile(workspaceId, design.id, path), [client, workspaceId, design.id]);
  const reloadVersion = `${props.reloadKey ?? ""}:${design.updatedAt}`;

  const [history, setHistory] = useState<BoardHistory | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [draft, setDraft] = useState<Board | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [tool, setTool] = useState<BoardTool>("select");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [spacePan, setSpacePan] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [notice, setNotice] = useState<string | null>(null);
  const [imageAt, setImageAt] = useState<Point | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [ask, setAsk] = useState("");
  const [size, setSize] = useState(DEFAULT_SIZE);
  /** Counts outside changes applied to the board, so images rewritten alongside them are read again. */
  const [externalVersion, setExternalVersion] = useState(0);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const lastSavedText = useRef<string | null>(null);
  const loaded = useRef(false);
  const fitPending = useRef(false);
  const dirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyRef = useRef(history);
  historyRef.current = history;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const propsRef = useRef(props);
  propsRef.current = props;
  const statusId = useId();

  const present = history?.present ?? null;
  const shown = draft ?? present;
  // Not keyed on `design.updatedAt`: our own saves bump it and would re-read every image.
  const resolveImage = useBoardImages(shown, read, `${props.reloadKey ?? ""}:${externalVersion}`);

  // ---- Canvas size ----
  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [loadState]);

  useEffect(() => {
    if (!fitPending.current || !present) return;
    fitPending.current = false;
    const bounds = unionBounds(present.elements.map(elementBounds));
    if (bounds) setViewport(fitBounds(bounds, size));
  }, [present, size]);

  // ---- Load and reload (the agent may rewrite board.json; the selection survives) ----
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let text: string;
      try {
        text = await (await read(BOARD_FILE)).text();
      } catch (error) {
        if (cancelled || loaded.current) return;
        if (error instanceof OpenworkServerError && error.status === 404) {
          loaded.current = true;
          setHistory(createHistory(emptyBoard()));
          setLoadState("ready");
        } else setLoadState("error");
        return;
      }
      if (cancelled || text === lastSavedText.current) return;
      const parsed = parseBoard(text);
      if (!parsed) {
        if (!loaded.current) setLoadState("invalid");
        else setNotice(t("design_ui.board.notice.external_invalid"));
        return;
      }
      lastSavedText.current = text;
      if (!loaded.current) {
        loaded.current = true;
        setHistory(createHistory(parsed));
        if (!hasViewport(text) && parsed.elements.length) fitPending.current = true;
        else setViewport(parsed.viewport);
        setLoadState("ready");
        return;
      }
      // An outside change wins over a pending local save; undo brings the local version back.
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      dirty.current = false;
      setSaveState("saved");
      setDraft(null);
      setHistory(current => (current ? pushHistory(current, parsed) : createHistory(parsed)));
      setExternalVersion(value => value + 1);
      const ids = new Set(parsed.elements.map(e => e.id));
      setSelection(current => new Set([...current].filter(id => ids.has(id))));
      setEditingId(current => (current && ids.has(current) ? current : null));
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadVersion, read, loadAttempt]);

  // ---- Save ----
  const flush = useCallback(async () => {
    saveTimer.current = null;
    const current = historyRef.current?.present;
    if (!current || !dirty.current) return;
    const result = serializeBoard({ ...current, viewport: viewportRef.current });
    if (!result.ok) {
      setSaveState("error");
      setNotice(t(result.reason === "too_many_elements" ? "design_ui.board.notice.limit" : "design_ui.board.notice.invalid_save", { count: DESIGN_LIMITS.boardElements }));
      return;
    }
    dirty.current = false;
    if (result.text === lastSavedText.current) {
      setSaveState("saved");
      return;
    }
    const previous = lastSavedText.current;
    lastSavedText.current = result.text;
    setSaveState("saving");
    try {
      const { client: currentClient, workspaceId: ws, design: currentDesign } = propsRef.current;
      await currentClient.writeDesignFile(ws, currentDesign.id, BOARD_FILE, result.text);
      setSaveState(dirty.current ? "pending" : "saved");
      propsRef.current.onChanged();
    } catch {
      lastSavedText.current = previous;
      dirty.current = true;
      setSaveState("error");
    }
  }, []);

  const scheduleSave = useCallback(() => {
    if (!propsRef.current.writable) return;
    dirty.current = true;
    setSaveState("pending");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  }, [flush]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (dirty.current) void flush();
  }, [flush]);

  // ---- Mutations ----
  const commit = useCallback((next: Board, select?: string[]) => {
    setDraft(null);
    setHistory(current => (current ? pushHistory(current, next) : current));
    if (select) setSelection(new Set(select));
    scheduleSave();
  }, [scheduleSave]);

  const apply = (change: (board: Board) => Board, select?: string[]) => {
    if (!present || !writable) return;
    const next = change(present);
    if (next !== present) commit(next, select);
  };

  const keepExisting = (board: Board) => {
    const ids = new Set(board.elements.map(e => e.id));
    setSelection(current => new Set([...current].filter(id => ids.has(id))));
  };

  const onUndo = () => {
    if (!history?.past.length || !writable) return;
    const next = undo(history);
    setHistory(next);
    keepExisting(next.present);
    scheduleSave();
  };
  const onRedo = () => {
    if (!history?.future.length || !writable) return;
    const next = redo(history);
    setHistory(next);
    keepExisting(next.present);
    scheduleSave();
  };

  const onDelete = () => {
    apply(board => deleteElements(board, selection), []);
  };
  const onDuplicate = () => {
    if (!present || !writable || !selection.size) return;
    if (!canAddElements(present, selection.size)) {
      setNotice(t("design_ui.board.notice.limit", { count: DESIGN_LIMITS.boardElements }));
      return;
    }
    const result = duplicateElements(present, selection);
    if (result.ids.length) commit(result.board, result.ids);
  };
  const onArrange = (action: ArrangeAction) => apply(board => arrangeElements(board, selection, action));
  const onStyle = (patch: BoardStyle) => apply(board => updateStyle(board, selection, patch));
  const nudge = (dx: number, dy: number) => apply(board => assignFrames(moveElements(board, selection, dx, dy), selection));

  const onEditCommit = (id: string, value: string) => {
    setEditingId(null);
    apply(board => {
      const element = board.elements.find(e => e.id === id);
      if (!element) return board;
      if (element.type === "text" && !value.trim()) return deleteElements(board, [id]);
      let next = setElementText(board, id, value);
      if (element.type === "text") {
        const fontSize = element.style.fontSize ?? 24;
        const height = Math.max(1, wrapText(value, element.width, fontSize).length) * fontSize * LINE_HEIGHT;
        next = { ...next, elements: next.elements.map(e => (e.id === id ? { ...e, height: Math.round(height) } : e)) };
      }
      return next;
    });
  };

  // ---- Viewport ----
  const zoomBy = (factor: number) => setViewport(current => zoomAt(current, factor, { x: size.width / 2, y: size.height / 2 }));
  const fitAll = () => {
    if (!present) return;
    const bounds = unionBounds(present.elements.map(elementBounds));
    setViewport(bounds ? fitBounds(bounds, size) : { x: 0, y: 0, zoom: 1 });
  };
  const focusFrame = (id: string) => {
    const frame = present?.elements.find(e => e.id === id);
    if (!frame) return;
    setSelection(new Set([id]));
    setViewport(fitBounds(elementBounds(frame), size, 32, 4));
  };
  const zoomToSelection = () => {
    if (!present) return;
    const bounds = unionBounds(present.elements.filter(e => selection.has(e.id)).map(elementBounds));
    if (bounds) setViewport(fitBounds(bounds, size, 48, 4));
  };

  const downloadFrame = async (id: string) => {
    if (!present) return;
    setDownloading(id);
    try {
      await downloadFramePng(present, id, read, t("design_ui.board.frame_file_fallback"));
    } catch {
      setNotice(t("design_ui.board.notice.png_failed"));
    } finally {
      setDownloading(null);
    }
  };

  // ---- Images ----
  const placeImage = async (path: string, blob?: Blob) => {
    if (!present || !imageAt) return;
    if (!canAddElements(present)) {
      setNotice(t("design_ui.board.notice.limit", { count: DESIGN_LIMITS.boardElements }));
      return;
    }
    setImageBusy(true);
    setImageError(null);
    try {
      const source = blob ?? (await read(path));
      const natural = await imageNaturalSize(source, imageMimeType(path));
      const element = makeElement(
        { type: "image", src: path },
        { x: imageAt.x - natural.width / 2, y: imageAt.y - natural.height / 2, ...natural },
        newElementId(new Set(present.elements.map(e => e.id))),
      );
      commit(addElements(present, [element]), [element.id]);
      setImageAt(null);
      setTool("select");
    } catch {
      setImageError(t("design_ui.board.image.read_failed"));
    } finally {
      setImageBusy(false);
    }
  };

  const uploadImage = async (file: File) => {
    const path = uploadAssetPath(file.name, Math.random().toString(36).slice(2, 7));
    if (!path) {
      setImageError(t("design_ui.board.image.unsupported"));
      return;
    }
    if (file.size > DESIGN_LIMITS.assetBytes) {
      setImageError(t("design_ui.board.image.too_large", { size: Math.round(DESIGN_LIMITS.assetBytes / (1024 * 1024)) }));
      return;
    }
    setImageBusy(true);
    setImageError(null);
    try {
      await client.writeDesignFile(workspaceId, design.id, path, file);
      setUploaded(current => [...current, path]);
    } catch {
      setImageBusy(false);
      setImageError(t("design_ui.board.image.upload_failed"));
      return;
    }
    await placeImage(path, file);
  };

  const knownAssets = useMemo(() => {
    const fromBoard = present ? present.elements.flatMap(e => (e.type === "image" ? [e.src] : [])) : [];
    return [...new Set([...uploaded, ...fromBoard])].sort();
  }, [present, uploaded]);

  // ---- Keyboard ----
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (editingId || !present) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    const run = (action: () => void) => {
      handled();
      action();
    };
    if (event.key === " ") {
      if (!spacePan) setSpacePan(true);
      handled();
      return;
    }
    if (mod && key === "z") {
      if (event.shiftKey) onRedo();
      else onUndo();
      return handled();
    }
    if (mod && key === "y") return run(() => onRedo());
    if (mod && key === "d") return run(() => onDuplicate());
    if (mod && key === "a") return run(() => setSelection(new Set(present.elements.map(e => e.id))));
    if (mod && (key === "=" || key === "+")) return run(() => zoomBy(1.2));
    if (mod && key === "-") return run(() => zoomBy(1 / 1.2));
    if (mod && key === "0") return run(() => setViewport(current => zoomAt(current, 1 / current.zoom, { x: size.width / 2, y: size.height / 2 })));
    if (mod) return;
    if (event.shiftKey && event.code === "Digit1") return run(() => fitAll());
    if (event.shiftKey && event.code === "Digit2") return run(() => zoomToSelection());
    if (event.key === "Delete" || event.key === "Backspace") {
      if (selection.size) run(() => onDelete());
      return;
    }
    if (event.key === "Escape") {
      if (tool !== "select") setTool("select");
      else setSelection(new Set());
      return handled();
    }
    if (event.key === "Enter" && selection.size === 1) {
      const element = present.elements.find(e => selection.has(e.id));
      if (writable && element && (element.type === "text" || element.type === "sticky" || element.type === "frame")) return run(() => setEditingId(element.id));
    }
    if (event.key.startsWith("Arrow") && selection.size) {
      const step = event.shiftKey ? 10 : 1;
      const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      return run(() => nudge(dx, dy));
    }
    if (event.code === "BracketRight" && selection.size) return run(() => onArrange(event.shiftKey ? "front" : "forward"));
    if (event.code === "BracketLeft" && selection.size) return run(() => onArrange(event.shiftKey ? "back" : "backward"));
    const shortcut = BOARD_TOOLS.find(entry => entry.shortcut.toLowerCase() === key && !event.shiftKey && !event.altKey);
    if (shortcut && (writable || shortcut.id === "select" || shortcut.id === "hand")) {
      handled();
      setTool(shortcut.id);
    }
  };
  const onKeyUp = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === " ") setSpacePan(false);
  };

  const askAgent = () => {
    const text = ask.trim();
    if (!text || !present) return;
    props.onAskAgent(text, boardAgentContext(design, present, selection));
    setAsk("");
  };

  if (loadState !== "ready" || !present || !shown) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 p-4" data-board-state={loadState}>
        {loadState === "loading" ? (
          <>
            <Skeleton className="h-10 w-96 max-w-full" />
            <Skeleton className="min-h-0 flex-1" />
          </>
        ) : (
          <div role="alert" className="m-auto flex max-w-md flex-col items-center gap-3 text-center">
            <p className="text-sm text-foreground">{t(loadState === "invalid" ? "design_ui.board.load_invalid" : "design_ui.board.load_failed")}</p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => { setLoadState("loading"); setLoadAttempt(value => value + 1); }}>
                {t("design_ui.board.retry")}
              </Button>
              {loadState === "invalid" && writable ? (
                <Button type="button" onClick={() => props.onAskAgent(t("design_ui.board.repair_request"), boardAgentContext(design, emptyBoard(), new Set()))}>
                  {t("design_ui.board.repair")}
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    );
  }

  const selected = shown.elements.filter(e => selection.has(e.id));
  const frameList = frames(shown);
  const saveLabel = !writable ? t("design_ui.board.read_only")
    : saveState === "error" ? t("design_ui.board.save_failed")
    : saveState === "saved" ? t("design_ui.board.saved")
    : t("design_ui.board.saving");

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row" data-board-editor="">
      <aside aria-label={t("design_ui.board.frames_label")} className="hidden w-56 shrink-0 flex-col gap-1 overflow-y-auto border-e border-border p-2 lg:flex">
        <h3 className="px-2 py-1 text-xs font-medium text-muted-foreground">{t("design_ui.board.frames_label")}</h3>
        <BoardFrames frames={frameList} selection={selection} onSelect={id => setSelection(new Set([id]))} onFocus={focusFrame} onDownload={id => void downloadFrame(id)} downloading={downloading} />
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
          <BoardToolbar
            tool={tool}
            onTool={next => { setTool(next); setEditingId(null); }}
            writable={writable}
            canUndo={Boolean(history?.past.length)}
            canRedo={Boolean(history?.future.length)}
            onUndo={onUndo}
            onRedo={onRedo}
          />
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {notice ? (
              <span role="status" className="flex items-center gap-1 text-foreground">
                {notice}
                <Button type="button" variant="ghost" size="xs" onClick={() => setNotice(null)}>{t("design_ui.board.dismiss")}</Button>
              </span>
            ) : null}
            <span aria-live="polite" data-save-state={saveState} className={cn(saveState === "error" && "text-destructive")}>{saveLabel}</span>
            {saveState === "error" && writable ? (
              <Button type="button" variant="outline" size="xs" onClick={() => { dirty.current = true; void flush(); }}>{t("design_ui.board.retry")}</Button>
            ) : null}
          </div>
        </div>
        <div
          ref={canvasRef}
          tabIndex={0}
          role="application"
          aria-roledescription={t("design_ui.board.canvas_role")}
          aria-label={design.title}
          aria-describedby={statusId}
          className="relative min-h-0 flex-1 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onBlur={() => setSpacePan(false)}
          onPointerDown={event => {
            if (event.target instanceof Element && !event.target.closest("textarea,input")) canvasRef.current?.focus({ preventScroll: true });
          }}
        >
          <span id={statusId} className="sr-only">{t("design_ui.board.canvas_help", { count: shown.elements.length })}</span>
          <BoardCanvas
            board={shown}
            committed={present}
            viewport={viewport}
            onViewport={setViewport}
            size={size}
            selection={selection}
            onSelection={setSelection}
            tool={tool}
            onTool={setTool}
            writable={writable}
            spacePan={spacePan}
            editingId={editingId}
            onEdit={setEditingId}
            onEditCommit={onEditCommit}
            resolveImage={resolveImage}
            onPreview={setDraft}
            onCommit={commit}
            onPlaceImage={point => { setImageError(null); setImageAt(point); }}
            onLimit={() => setNotice(t("design_ui.board.notice.limit", { count: DESIGN_LIMITS.boardElements }))}
            frameLabel={t("design_ui.board.frame_default")}
          />
          <div role="group" aria-label={t("design_ui.board.zoom_label")} className="absolute end-3 bottom-3 flex items-center gap-0.5 rounded-xl bg-background p-1 shadow-[var(--dls-card-shadow)]">
            <Button type="button" variant="ghost" size="icon-xs" aria-label={t("design_ui.board.zoom_out")} title={withShortcut(t("design_ui.board.zoom_out"), "Ctrl+-")} disabled={viewport.zoom <= clampZoom(0)} onClick={() => zoomBy(1 / 1.2)}><Minus /></Button>
            <Button type="button" variant="ghost" size="xs" className="min-w-14 tabular-nums" aria-label={t("design_ui.board.zoom_reset")} title={withShortcut(t("design_ui.board.zoom_reset"), "Ctrl+0")} onClick={() => setViewport(current => zoomAt(current, 1 / current.zoom, { x: size.width / 2, y: size.height / 2 }))}>
              {Math.round(viewport.zoom * 100)}%
            </Button>
            <Button type="button" variant="ghost" size="icon-xs" aria-label={t("design_ui.board.zoom_in")} title={withShortcut(t("design_ui.board.zoom_in"), "Ctrl++")} disabled={viewport.zoom >= clampZoom(Infinity)} onClick={() => zoomBy(1.2)}><Plus /></Button>
            <Button type="button" variant="ghost" size="icon-xs" aria-label={t("design_ui.board.zoom_fit")} title={withShortcut(t("design_ui.board.zoom_fit"), "Shift+1")} onClick={fitAll}><Maximize /></Button>
          </div>
        </div>
        <form
          className="flex items-center gap-2 border-t border-border px-3 py-2"
          onSubmit={event => {
            event.preventDefault();
            askAgent();
          }}
        >
          <Input
            value={ask}
            aria-label={t("design_ui.board.ask_label")}
            placeholder={selection.size ? t("design_ui.board.ask_placeholder_selection", { count: selection.size }) : t("design_ui.board.ask_placeholder")}
            maxLength={4_000}
            onChange={event => setAsk(event.currentTarget.value)}
          />
          <Button type="submit" variant="outline" disabled={!ask.trim()}>
            <Send />
            {t("design_ui.board.ask")}
          </Button>
        </form>
      </div>
      {selected.length ? (
        <aside className="max-h-64 w-full shrink-0 overflow-y-auto border-t border-border p-3 md:max-h-none md:w-60 md:border-s md:border-t-0">
          <BoardStylePanel
            selected={selected}
            writable={writable}
            onStyle={onStyle}
            onArrange={onArrange}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
            onFocusFrame={focusFrame}
            onDownloadFrame={id => void downloadFrame(id)}
            downloading={downloading}
          />
        </aside>
      ) : null}
      <BoardImageDialog
        open={imageAt !== null}
        onOpenChange={open => { if (!open) setImageAt(null); }}
        knownAssets={knownAssets}
        busy={imageBusy}
        error={imageError}
        onUpload={file => void uploadImage(file)}
        onChoose={path => void placeImage(path)}
      />
    </div>
  );
}

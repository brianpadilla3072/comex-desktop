/** @jsxImportSource react */
import { createElement, useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { Board, BoardElement } from "@openwork/types/designs";

import { t } from "@/i18n";
import { cn } from "@/lib/utils";

import {
  addElements, assignFrames, boardToScreen, BOARD_DEFAULT_SIZES, BOARD_DEFAULT_STYLES, canAddElements, elementBounds, elementsInRect,
  frameTitleHit, hitTest, HANDLES, LINE_HEIGHT, makeElement, moveElements, newElementId, nextFrameTitle, normalizeBounds, panBy,
  pathData, pathFromStroke, resizeBounds, resizeElement, rotationFromPointer, screenToBoard, setRotation, visibleElements, visibleRect,
  zoomAt, type Bounds, type BoardTool, type Handle, type Point, type Viewport,
} from "./board-model";
import { elementNode, toReactProps, type ImageResolver, type SvgNode } from "./board-svg";

type CreateTool = "rect" | "ellipse" | "frame" | "sticky" | "text";

type Drag =
  | { kind: "pan"; startScreen: Point; startViewport: Viewport }
  | { kind: "move"; start: Point; startScreen: Point; startBoard: Board; ids: string[]; moved: boolean }
  | { kind: "marquee"; start: Point; current: Point; base: Set<string> }
  | { kind: "resize"; id: string; handle: Handle; start: Point; startBounds: Bounds; startBoard: Board; keepAspect: boolean }
  | { kind: "rotate"; id: string; startBoard: Board }
  | { kind: "create"; tool: CreateTool; start: Point; current: Point; startScreen: Point }
  | { kind: "pen"; points: Point[] };

export type BoardCanvasProps = {
  /** What is drawn: the committed board or a drag preview. */
  board: Board;
  /** The last committed board; drags start from it. */
  committed: Board;
  viewport: Viewport;
  onViewport: (viewport: Viewport) => void;
  size: { width: number; height: number };
  selection: ReadonlySet<string>;
  onSelection: (selection: Set<string>) => void;
  tool: BoardTool;
  onTool: (tool: BoardTool) => void;
  writable: boolean;
  /** Space held: the select tool pans while dragging. */
  spacePan: boolean;
  editingId: string | null;
  onEdit: (id: string | null) => void;
  onEditCommit: (id: string, value: string) => void;
  resolveImage: ImageResolver;
  onPreview: (board: Board | null) => void;
  onCommit: (next: Board, select?: string[]) => void;
  onPlaceImage: (point: Point) => void;
  onLimit: () => void;
  frameLabel: string;
};

const isHandle = (value: string | null): value is Handle => HANDLES.some(handle => handle === value);
const HANDLE_CURSORS: Record<Handle, string> = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };
const isCreateTool = (tool: BoardTool): tool is CreateTool => tool === "rect" || tool === "ellipse" || tool === "frame" || tool === "sticky" || tool === "text";

function renderNode(node: SvgNode, key: string | number): ReactNode {
  return createElement(node.tag, { key, ...toReactProps(node.attrs) }, node.text, ...(node.children ?? []).map((child, index) => renderNode(child, index)));
}

function handlePosition(b: Bounds, handle: Handle): Point {
  const x = handle.includes("w") ? b.x : handle.includes("e") ? b.x + b.width : b.x + b.width / 2;
  const y = handle.includes("n") ? b.y : handle.includes("s") ? b.y + b.height : b.y + b.height / 2;
  return { x, y };
}

export function BoardCanvas(props: BoardCanvasProps) {
  const { board, committed, viewport, size, selection, tool, writable, editingId } = props;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [, setFrameTick] = useState(0);
  const rerender = () => setFrameTick(value => value + 1);
  const prefix = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const latest = useRef(props);
  latest.current = props;

  // Wheel: ctrl/⌘ (and trackpad pinch) zooms at the pointer; otherwise it pans. Non-passive to keep the page still.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const current = latest.current;
      const rect = svg.getBoundingClientRect();
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      if (event.ctrlKey || event.metaKey) current.onViewport(zoomAt(current.viewport, Math.exp(-event.deltaY * 0.01), anchor));
      else current.onViewport(panBy(current.viewport, -event.deltaX, -event.deltaY));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const screenPoint = (event: { clientX: number; clientY: number }): Point => {
    const rect = svgRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    const screen = screenPoint(event);
    const point = screenToBoard(viewport, screen);
    const capture = () => {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic events (tests) have no active pointer to capture.
      }
    };
    if (event.button === 1 || tool === "hand" || props.spacePan) {
      dragRef.current = { kind: "pan", startScreen: screen, startViewport: viewport };
      capture();
      rerender();
      return;
    }
    const target = event.target instanceof Element ? event.target.closest("[data-handle]") : null;
    const handle = target?.getAttribute("data-handle") ?? null;
    const single = selection.size === 1 ? committed.elements.find(e => selection.has(e.id)) : undefined;
    if (writable && single && handle === "rotate") {
      dragRef.current = { kind: "rotate", id: single.id, startBoard: committed };
      capture();
      return;
    }
    if (writable && single && isHandle(handle)) {
      dragRef.current = { kind: "resize", id: single.id, handle, start: point, startBounds: elementBounds(single), startBoard: committed, keepAspect: single.type === "image" };
      capture();
      return;
    }
    const activeTool: BoardTool = writable ? tool : "select";
    if (activeTool === "select") {
      const hit = frameTitleHit(committed, point, viewport.zoom) ?? hitTest(committed, point, 4 / viewport.zoom);
      if (hit) {
        if (event.shiftKey) {
          const next = new Set(selection);
          if (next.has(hit.id)) next.delete(hit.id);
          else next.add(hit.id);
          props.onSelection(next);
          return;
        }
        const ids = selection.has(hit.id) ? [...selection] : [hit.id];
        if (!selection.has(hit.id)) props.onSelection(new Set(ids));
        if (writable) {
          dragRef.current = { kind: "move", start: point, startScreen: screen, startBoard: committed, ids, moved: false };
          capture();
        }
        return;
      }
      const base = event.shiftKey ? new Set(selection) : new Set<string>();
      if (!event.shiftKey && selection.size) props.onSelection(new Set());
      dragRef.current = { kind: "marquee", start: point, current: point, base };
      capture();
      rerender();
      return;
    }
    if (!canAddElements(committed)) {
      props.onLimit();
      return;
    }
    if (activeTool === "image") {
      props.onPlaceImage(point);
      return;
    }
    if (activeTool === "pen") {
      dragRef.current = { kind: "pen", points: [point] };
      capture();
      rerender();
      return;
    }
    if (isCreateTool(activeTool)) {
      dragRef.current = { kind: "create", tool: activeTool, start: point, current: point, startScreen: screen };
      capture();
      rerender();
    }
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const screen = screenPoint(event);
    const point = screenToBoard(viewport, screen);
    switch (drag.kind) {
      case "pan":
        props.onViewport({ ...drag.startViewport, x: drag.startViewport.x - (screen.x - drag.startScreen.x) / drag.startViewport.zoom, y: drag.startViewport.y - (screen.y - drag.startScreen.y) / drag.startViewport.zoom });
        return;
      case "move":
        if (!drag.moved && Math.hypot(screen.x - drag.startScreen.x, screen.y - drag.startScreen.y) < 3) return;
        drag.moved = true;
        props.onPreview(moveElements(drag.startBoard, drag.ids, point.x - drag.start.x, point.y - drag.start.y));
        return;
      case "resize":
        props.onPreview(resizeElement(drag.startBoard, drag.id, resizeBounds(drag.startBounds, drag.handle, point.x - drag.start.x, point.y - drag.start.y, drag.keepAspect || event.shiftKey)));
        return;
      case "rotate": {
        const element = drag.startBoard.elements.find(e => e.id === drag.id);
        if (element) props.onPreview(setRotation(drag.startBoard, drag.id, rotationFromPointer(elementBounds(element), point, event.shiftKey)));
        return;
      }
      case "marquee":
      case "create":
        drag.current = point;
        rerender();
        return;
      case "pen": {
        const last = drag.points[drag.points.length - 1];
        if (!last || Math.hypot(point.x - last.x, point.y - last.y) * viewport.zoom >= 1) {
          drag.points.push(point);
          rerender();
        }
      }
    }
  };

  const finish = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Not captured.
    }
    if (!drag) return;
    const screen = screenPoint(event);
    const point = screenToBoard(viewport, screen);
    switch (drag.kind) {
      case "pan":
        rerender();
        return;
      case "move":
        if (!drag.moved) return;
        props.onCommit(assignFrames(moveElements(drag.startBoard, drag.ids, point.x - drag.start.x, point.y - drag.start.y), drag.ids));
        return;
      case "resize":
        props.onCommit(assignFrames(resizeElement(drag.startBoard, drag.id, resizeBounds(drag.startBounds, drag.handle, point.x - drag.start.x, point.y - drag.start.y, drag.keepAspect || event.shiftKey)), [drag.id]));
        return;
      case "rotate": {
        const element = drag.startBoard.elements.find(e => e.id === drag.id);
        if (element) props.onCommit(setRotation(drag.startBoard, drag.id, rotationFromPointer(elementBounds(element), point, event.shiftKey)));
        return;
      }
      case "marquee": {
        const ids = elementsInRect(committed, normalizeBounds(drag.start, point));
        props.onSelection(new Set([...drag.base, ...ids]));
        rerender();
        return;
      }
      case "pen": {
        drag.points.push(point);
        const element = pathFromStroke(drag.points, newElementId(new Set(committed.elements.map(e => e.id))), undefined, 1.5 / viewport.zoom);
        if (element) props.onCommit(addElements(committed, [element]), []);
        rerender();
        return;
      }
      case "create": {
        const element = createdElement(drag.tool, drag.start, point, Math.hypot(screen.x - drag.startScreen.x, screen.y - drag.startScreen.y) < 4, committed, props.frameLabel);
        props.onCommit(addElements(committed, [element]), [element.id]);
        props.onTool("select");
        if (element.type === "text" || element.type === "sticky") props.onEdit(element.id);
        rerender();
      }
    }
  };

  const onDoubleClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (!writable) return;
    const point = screenToBoard(viewport, screenPoint(event));
    const title = frameTitleHit(committed, point, viewport.zoom);
    const hit = title ?? hitTest(committed, point, 4 / viewport.zoom);
    if (hit && (hit.type === "text" || hit.type === "sticky" || (hit.type === "frame" && title))) {
      props.onSelection(new Set([hit.id]));
      props.onEdit(hit.id);
    }
  };

  const view = visibleRect(viewport, size);
  const elements = visibleElements(board, view, new Set([...selection, ...(editingId ? [editingId] : [])]));
  const frameIndex = new Map(board.elements.filter(e => e.type === "frame").map((frame, index) => [frame.id, index]));
  const drag = dragRef.current;
  const resolveImage = props.resolveImage;
  const draw = (element: BoardElement) => {
    const shown = element.id === editingId && (element.type === "text" || element.type === "sticky") ? { ...element, text: "" } : element;
    return elementNode(shown, resolveImage);
  };
  const grid = 24 * viewport.zoom;

  return (
    <div className="relative size-full overflow-hidden">
      <svg
        ref={svgRef}
        className={cn(
          "block size-full touch-none select-none bg-muted/30",
          tool === "hand" || props.spacePan ? (drag?.kind === "pan" ? "cursor-grabbing" : "cursor-grab") : tool === "select" || !writable ? "cursor-default" : "cursor-crosshair",
        )}
        width={size.width}
        height={size.height}
        aria-hidden="true"
        data-board-canvas=""
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onDoubleClick={onDoubleClick}
      >
        <defs>
          {grid >= 6 ? (
            <pattern id={`${prefix}-grid`} width={grid} height={grid} patternUnits="userSpaceOnUse" x={-viewport.x * viewport.zoom} y={-viewport.y * viewport.zoom}>
              <circle cx={1} cy={1} r={1} className="fill-border" />
            </pattern>
          ) : null}
          {board.elements.flatMap(frame => (frame.type === "frame" ? [
            <clipPath key={frame.id} id={`${prefix}-clip-${frameIndex.get(frame.id) ?? 0}`}>
              <rect x={frame.x} y={frame.y} width={frame.width} height={frame.height} />
            </clipPath>,
          ] : []))}
        </defs>
        {grid >= 6 ? <rect width="100%" height="100%" fill={`url(#${prefix}-grid)`} /> : null}
        <g transform={`scale(${viewport.zoom}) translate(${-viewport.x} ${-viewport.y})`}>
          {elements.map(element => {
            const node = renderNode(draw(element), element.id);
            const clip = element.frameId !== null ? frameIndex.get(element.frameId) : undefined;
            return clip !== undefined ? <g key={element.id} clipPath={`url(#${prefix}-clip-${clip})`}>{node}</g> : node;
          })}
          {elements.flatMap(frame => (frame.type === "frame" && frame.id !== editingId ? [
            <text key={`title-${frame.id}`} x={frame.x} y={frame.y - 6 / viewport.zoom} fontSize={12 / viewport.zoom} className="fill-muted-foreground" fontFamily="inherit">
              {frame.title}
            </text>,
          ] : []))}
          {drag?.kind === "create" ? renderNode(elementNode(createdElement(drag.tool, drag.start, drag.current, false, committed, props.frameLabel), resolveImage), "creating") : null}
          {drag?.kind === "pen" && drag.points.length > 1 ? (
            <path
              d={pathData(drag.points.map((p): [number, number] => [p.x, p.y]))}
              fill="none"
              stroke={BOARD_DEFAULT_STYLES.path.stroke}
              strokeWidth={BOARD_DEFAULT_STYLES.path.strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
        </g>
        <SelectionOverlay board={board} selection={selection} viewport={viewport} writable={writable && !editingId} />
        {drag?.kind === "marquee" ? <MarqueeRect viewport={viewport} start={drag.start} current={drag.current} /> : null}
      </svg>
      {editingId ? <TextEditor board={board} id={editingId} viewport={viewport} onCommit={props.onEditCommit} onCancel={() => props.onEdit(null)} /> : null}
    </div>
  );
}

/** The element a create drag produces; a click (no drag) gives the default size. */
export function createdElement(tool: CreateTool, start: Point, end: Point, isClick: boolean, board: Board, frameLabel: string): BoardElement {
  const defaults = BOARD_DEFAULT_SIZES[tool];
  const fontSize = BOARD_DEFAULT_STYLES[tool].fontSize ?? 24;
  let bounds: Bounds;
  if (isClick) {
    bounds = tool === "text"
      ? { x: start.x, y: start.y, width: defaults.width, height: Math.round(fontSize * LINE_HEIGHT) }
      : { x: start.x - defaults.width / 2, y: start.y - defaults.height / 2, ...defaults };
  } else {
    bounds = normalizeBounds(start, end);
    if (tool === "text") bounds = { ...bounds, height: Math.max(bounds.height, Math.round(fontSize * LINE_HEIGHT)) };
  }
  const id = newElementId(new Set(board.elements.map(e => e.id)));
  switch (tool) {
    case "frame": return makeElement({ type: "frame", title: nextFrameTitle(board, frameLabel) }, bounds, id);
    case "text": return makeElement({ type: "text", text: "" }, bounds, id);
    case "sticky": return makeElement({ type: "sticky", text: "" }, bounds, id);
    case "rect": return makeElement({ type: "rect" }, bounds, id);
    case "ellipse": return makeElement({ type: "ellipse" }, bounds, id);
  }
}

function MarqueeRect(props: { viewport: Viewport; start: Point; current: Point }) {
  const a = boardToScreen(props.viewport, props.start);
  const b = boardToScreen(props.viewport, props.current);
  const r = normalizeBounds(a, b);
  return <rect data-marquee="" x={r.x} y={r.y} width={r.width} height={r.height} className="fill-primary/10 stroke-primary" strokeWidth={1} strokeDasharray="4 3" />;
}

function SelectionOverlay(props: { board: Board; selection: ReadonlySet<string>; viewport: Viewport; writable: boolean }) {
  const selected = props.board.elements.filter(e => props.selection.has(e.id));
  if (!selected.length) return null;
  const single = selected.length === 1 ? selected[0] : undefined;
  return (
    <g>
      {selected.map(element => {
        const topLeft = boardToScreen(props.viewport, element);
        const b = { x: topLeft.x, y: topLeft.y, width: element.width * props.viewport.zoom, height: element.height * props.viewport.zoom };
        const cx = b.x + b.width / 2;
        const cy = b.y + b.height / 2;
        const showHandles = props.writable && single?.id === element.id;
        return (
          <g key={element.id} transform={element.rotation ? `rotate(${element.rotation} ${cx} ${cy})` : undefined} data-selection={element.id}>
            <rect x={b.x} y={b.y} width={b.width} height={b.height} className="fill-none stroke-primary" strokeWidth={1.5} pointerEvents="none" />
            {showHandles ? HANDLES.map(handle => {
              const p = handlePosition(b, handle);
              return <rect key={handle} data-handle={handle} x={p.x - 4} y={p.y - 4} width={8} height={8} rx={2} className="fill-background stroke-primary" strokeWidth={1.5} style={{ cursor: HANDLE_CURSORS[handle] }} />;
            }) : null}
            {showHandles && element.type !== "frame" ? (
              <>
                <line x1={cx} y1={b.y} x2={cx} y2={b.y - 20} className="stroke-primary" strokeWidth={1} pointerEvents="none" />
                <circle data-handle="rotate" cx={cx} cy={b.y - 24} r={5} className="fill-background stroke-primary" strokeWidth={1.5} style={{ cursor: "grab" }} />
              </>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

function TextEditor(props: { board: Board; id: string; viewport: Viewport; onCommit: (id: string, value: string) => void; onCancel: () => void }) {
  const element = props.board.elements.find(e => e.id === props.id);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const done = useRef(false);
  useEffect(() => {
    done.current = false;
    const field = ref.current ?? titleRef.current;
    field?.focus();
    field?.select();
  }, [props.id]);
  if (!element || (element.type !== "text" && element.type !== "sticky" && element.type !== "frame")) return null;
  const commit = (value: string) => {
    if (done.current) return;
    done.current = true;
    props.onCommit(props.id, value);
  };
  const zoom = props.viewport.zoom;
  const topLeft = boardToScreen(props.viewport, element);
  if (element.type === "frame") {
    return (
      <input
        ref={titleRef}
        aria-label={t("design_ui.board.frame_title_label")}
        defaultValue={element.title}
        maxLength={120}
        className="absolute h-6 rounded-md border border-primary bg-background px-1.5 text-xs text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
        style={{ left: topLeft.x, top: topLeft.y - 28, width: Math.max(160, element.width * zoom) }}
        onBlur={event => commit(event.currentTarget.value)}
        onKeyDown={event => {
          event.stopPropagation();
          if (event.key === "Enter") commit(event.currentTarget.value);
          if (event.key === "Escape") {
            done.current = true;
            props.onCancel();
          }
        }}
      />
    );
  }
  const fontSize = (element.style.fontSize ?? 20) * zoom;
  const inset = element.type === "sticky" ? 16 * zoom : 0;
  return (
    <textarea
      ref={ref}
      aria-label={t(element.type === "sticky" ? "design_ui.board.sticky_text_label" : "design_ui.board.text_label")}
      defaultValue={element.text}
      maxLength={10_000}
      className="absolute resize-none overflow-hidden rounded-sm bg-transparent p-0 leading-[1.3] ring-2 ring-primary/50 focus-visible:outline-none focus-visible:ring-primary"
      style={{
        left: topLeft.x + inset, top: topLeft.y + inset, width: Math.max(40, element.width * zoom - inset * 2),
        height: Math.max(fontSize * LINE_HEIGHT, element.height * zoom - inset * 2), fontSize, color: element.style.color,
        transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined, fontFamily: "system-ui, sans-serif",
      }}
      onBlur={event => commit(event.currentTarget.value)}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) commit(event.currentTarget.value);
        if (event.key === "Escape") commit(event.currentTarget.value);
      }}
    />
  );
}

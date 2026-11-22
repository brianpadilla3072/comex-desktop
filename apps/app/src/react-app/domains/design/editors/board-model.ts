import { boardSchema, DESIGN_LIMITS, type Board, type BoardElement } from "@openwork/types/designs";

/**
 * Pure whiteboard model for designs of kind "board" (`board.json`, `boardSchema`). Every function
 * returns a new board; the editor keeps them in a small undo history. Coordinates are board units:
 * a viewport `{ x, y, zoom }` maps a board point p to the screen as `(p - (x, y)) * zoom`.
 *
 * Paths keep their points relative to the element's top-left corner, so moving a path only moves
 * x/y, and resizing scales the points. Frames are never nested; any other element belongs to the
 * frame that contains its center (`frameId`), and moving a frame moves its children.
 */

export type Point = { x: number; y: number };
export type Bounds = { x: number; y: number; width: number; height: number };
export type Viewport = Board["viewport"];
export type BoardElementType = BoardElement["type"];
export type BoardStyle = BoardElement["style"];

export type BoardTool = "select" | "hand" | "text" | "frame" | "sticky" | "pen" | "rect" | "ellipse" | "image";

/** Tools in toolbar order, with their single-key shortcut. */
export const BOARD_TOOLS: ReadonlyArray<{ id: BoardTool; shortcut: string }> = [
  { id: "select", shortcut: "V" },
  { id: "hand", shortcut: "H" },
  { id: "frame", shortcut: "F" },
  { id: "text", shortcut: "T" },
  { id: "sticky", shortcut: "N" },
  { id: "pen", shortcut: "P" },
  { id: "rect", shortcut: "R" },
  { id: "ellipse", shortcut: "O" },
  { id: "image", shortcut: "I" },
];

/** Board content colors. They are part of the person's drawing (stored in board.json), not app chrome. */
export const BOARD_PALETTE = [
  "#1f2933", "#52606d", "#9aa5b1", "#ffffff",
  "#d64545", "#f0b429", "#3ebd93", "#2186eb",
  "#7b61ff", "#ff8a65", "#fff3c4", "#e3f8ff",
] as const;

export const BOARD_DEFAULT_STYLES: Record<BoardElementType, BoardStyle> = {
  frame: { fill: "#ffffff", stroke: "#cbd2d9", strokeWidth: 1 },
  rect: { fill: "#e3f8ff", stroke: "#2186eb", strokeWidth: 2 },
  ellipse: { fill: "#e3f8ff", stroke: "#2186eb", strokeWidth: 2 },
  text: { color: "#1f2933", fontSize: 24 },
  sticky: { fill: "#fff3c4", color: "#1f2933", fontSize: 20 },
  path: { stroke: "#1f2933", strokeWidth: 3 },
  image: {},
};

export const BOARD_DEFAULT_SIZES: Record<BoardElementType, { width: number; height: number }> = {
  frame: { width: 960, height: 600 },
  rect: { width: 200, height: 120 },
  ellipse: { width: 160, height: 160 },
  text: { width: 320, height: 40 },
  sticky: { width: 220, height: 220 },
  path: { width: 0, height: 0 },
  image: { width: 320, height: 240 },
};

export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 8;
/** Above this many elements the canvas renders only what intersects the viewport. */
export const BOARD_CULL_THRESHOLD = 300;

export function emptyBoard(): Board {
  return { format: "openwork.board", version: 1, elements: [], viewport: { x: 0, y: 0, zoom: 1 } };
}

/** Reads board.json text; null when it is not a valid board. */
export function parseBoard(text: string): Board | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = boardSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export type SerializeResult = { ok: true; text: string } | { ok: false; reason: "too_many_elements" | "invalid" };

/** Validates with `boardSchema` and returns the text written to board.json. */
export function serializeBoard(board: Board): SerializeResult {
  if (board.elements.length > DESIGN_LIMITS.boardElements) return { ok: false, reason: "too_many_elements" };
  const parsed = boardSchema.safeParse(board);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  return { ok: true, text: `${JSON.stringify(parsed.data, null, 2)}\n` };
}

export function canAddElements(board: Board, count = 1): boolean {
  return board.elements.length + count <= DESIGN_LIMITS.boardElements;
}

let idCounter = 0;
/** Short unique id that fits `boardElementSchema.id`. */
export function newElementId(existing: ReadonlySet<string> = new Set()): string {
  for (;;) {
    idCounter += 1;
    const id = `el-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    if (!existing.has(id)) return id;
  }
}

function idSet(board: Board): Set<string> {
  return new Set(board.elements.map(element => element.id));
}

export function normalizeBounds(a: Point, b: Point): Bounds {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

export function elementBounds(element: BoardElement): Bounds {
  return { x: element.x, y: element.y, width: element.width, height: element.height };
}

export function unionBounds(list: Bounds[]): Bounds | null {
  if (!list.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of list) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function intersects(a: Bounds, b: Bounds): boolean {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}

export function containsBounds(outer: Bounds, inner: Bounds): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

export function containsPoint(b: Bounds, p: Point): boolean {
  return p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
}

export function center(b: Bounds): Point {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Frames first (they are backgrounds), then the rest in stored order. */
export function renderOrder(board: Board): BoardElement[] {
  return [...board.elements.filter(e => e.type === "frame"), ...board.elements.filter(e => e.type !== "frame")];
}

export function frames(board: Board): Extract<BoardElement, { type: "frame" }>[] {
  return board.elements.flatMap(element => (element.type === "frame" ? [element] : []));
}

/** Title for a new frame: "<n> · <label>", n one more than the frames already on the board. */
export function nextFrameTitle(board: Board, label: string): string {
  return `${frames(board).length + 1} · ${label}`;
}

type NewElementInput =
  | { type: "frame"; title: string }
  | { type: "rect" }
  | { type: "ellipse" }
  | { type: "text"; text: string }
  | { type: "sticky"; text: string }
  | { type: "path"; points: [number, number][] }
  | { type: "image"; src: string };

/** Builds an element with default style; the caller supplies bounds (board units). */
export function makeElement(input: NewElementInput, bounds: Bounds, id: string, style?: BoardStyle): BoardElement {
  const base = {
    id,
    x: bounds.x,
    y: bounds.y,
    width: Math.max(0, bounds.width),
    height: Math.max(0, bounds.height),
    rotation: 0,
    style: { ...BOARD_DEFAULT_STYLES[input.type], ...style },
    frameId: null,
  };
  switch (input.type) {
    case "frame": return { ...base, type: "frame", title: input.title };
    case "rect": return { ...base, type: "rect" };
    case "ellipse": return { ...base, type: "ellipse" };
    case "text": return { ...base, type: "text", text: input.text };
    case "sticky": return { ...base, type: "sticky", text: input.text };
    case "path": return { ...base, type: "path", points: input.points };
    case "image": return { ...base, type: "image", src: input.src };
  }
}

/** Adds elements (respecting the cap) and assigns their frame. Frames go before other elements. */
export function addElements(board: Board, elements: BoardElement[]): Board {
  if (!canAddElements(board, elements.length)) return board;
  return assignFrames({ ...board, elements: [...board.elements, ...elements] }, elements.map(e => e.id));
}

/** The frame (topmost) containing the center of `bounds`, ignoring `excludeId`. */
export function frameAt(board: Board, bounds: Bounds, excludeId?: string): string | null {
  const c = center(bounds);
  const list = frames(board);
  for (let i = list.length - 1; i >= 0; i--) {
    const frame = list[i];
    if (frame && frame.id !== excludeId && containsPoint(elementBounds(frame), c)) return frame.id;
  }
  return null;
}

/**
 * Recomputes `frameId` for the given elements (non-frames: the frame containing their center).
 * For a frame in the list, its children and every loose element are re-checked, so a frame dropped
 * over loose elements adopts them and a frame shrunk past a child releases it.
 */
export function assignFrames(board: Board, ids: Iterable<string>): Board {
  const target = new Set(ids);
  const movedFrames = new Set(board.elements.filter(e => e.type === "frame" && target.has(e.id)).map(e => e.id));
  return {
    ...board,
    elements: board.elements.map(element => {
      if (element.type === "frame") return element.frameId === null ? element : { ...element, frameId: null };
      const affected = target.has(element.id) || (movedFrames.size > 0 && (element.frameId === null || movedFrames.has(element.frameId)));
      if (!affected) return element;
      const frameId = frameAt(board, elementBounds(element));
      return frameId === element.frameId ? element : { ...element, frameId };
    }),
  };
}

/** Selected ids plus the children of selected frames. */
export function withFrameChildren(board: Board, ids: Iterable<string>): Set<string> {
  const result = new Set(ids);
  const frameIds = new Set(board.elements.filter(e => e.type === "frame" && result.has(e.id)).map(e => e.id));
  for (const element of board.elements) if (element.frameId && frameIds.has(element.frameId)) result.add(element.id);
  return result;
}

export function moveElements(board: Board, ids: Iterable<string>, dx: number, dy: number): Board {
  if (!dx && !dy) return board;
  const moving = withFrameChildren(board, ids);
  return {
    ...board,
    elements: board.elements.map(element => (moving.has(element.id) ? { ...element, x: element.x + dx, y: element.y + dy } : element)),
  };
}

/** Sets the bounds of one element. Paths scale their points; frames do not resize their children. */
export function resizeElement(board: Board, id: string, bounds: Bounds): Board {
  const next = { x: bounds.x, y: bounds.y, width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) };
  return {
    ...board,
    elements: board.elements.map(element => {
      if (element.id !== id) return element;
      if (element.type === "path") {
        const sx = element.width > 0 ? next.width / element.width : 1;
        const sy = element.height > 0 ? next.height / element.height : 1;
        return { ...element, ...next, points: element.points.map(([px, py]): [number, number] => [round(px * sx), round(py * sy)]) };
      }
      return { ...element, ...next };
    }),
  };
}

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** New bounds after dragging a resize handle by (dx, dy). Flips are clamped to a 1-unit minimum. */
export function resizeBounds(start: Bounds, handle: Handle, dx: number, dy: number, keepAspect = false): Bounds {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle.includes("w")) left = Math.min(left + dx, right - 1);
  if (handle.includes("e")) right = Math.max(right + dx, left + 1);
  if (handle.includes("n")) top = Math.min(top + dy, bottom - 1);
  if (handle.includes("s")) bottom = Math.max(bottom + dy, top + 1);
  let width = right - left;
  let height = bottom - top;
  if (keepAspect && start.width > 0 && start.height > 0 && handle.length === 2) {
    const ratio = start.width / start.height;
    if (width / height > ratio) height = width / ratio;
    else width = height * ratio;
    if (handle.includes("w")) left = right - width;
    if (handle.includes("n")) top = bottom - height;
  }
  return { x: round(left), y: round(top), width: round(width), height: round(height) };
}

/** Rotation in degrees for a pointer at `p` around the element's center (0 = handle straight up). */
export function rotationFromPointer(bounds: Bounds, p: Point, snap = false): number {
  const c = center(bounds);
  let degrees = (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI + 90;
  if (snap) degrees = Math.round(degrees / 15) * 15;
  degrees = ((degrees % 360) + 360) % 360;
  return round(degrees);
}

export function setRotation(board: Board, id: string, rotation: number): Board {
  return { ...board, elements: board.elements.map(e => (e.id === id ? { ...e, rotation } : e)) };
}

/** Removes elements; removing a frame removes what it contains. */
export function deleteElements(board: Board, ids: Iterable<string>): Board {
  const removing = withFrameChildren(board, ids);
  if (!removing.size) return board;
  return { ...board, elements: board.elements.filter(e => !removing.has(e.id)) };
}

/** Copies elements (and the children of copied frames) with new ids, offset by `offset`. */
export function duplicateElements(board: Board, ids: Iterable<string>, offset = 24): { board: Board; ids: string[] } {
  const selected = new Set(ids);
  const copying = withFrameChildren(board, selected);
  const source = board.elements.filter(e => copying.has(e.id));
  if (!source.length || !canAddElements(board, source.length)) return { board, ids: [] };
  const taken = idSet(board);
  const remap = new Map<string, string>();
  for (const element of source) {
    const id = newElementId(taken);
    taken.add(id);
    remap.set(element.id, id);
  }
  const copies = source.map(element => ({
    ...element,
    id: remap.get(element.id) ?? element.id,
    x: element.x + offset,
    y: element.y + offset,
    frameId: element.frameId ? remap.get(element.frameId) ?? element.frameId : null,
  }));
  const next = { ...board, elements: [...board.elements, ...copies] };
  const topLevel = source.filter(e => selected.has(e.id)).map(e => remap.get(e.id) ?? e.id);
  // Loose copies may land in another frame; copies inside a copied frame keep it.
  const loose = copies.filter(e => !(e.frameId && [...remap.values()].includes(e.frameId))).map(e => e.id);
  return { board: assignFrames(next, loose), ids: topLevel };
}

export type ArrangeAction = "front" | "forward" | "backward" | "back";

/** Changes stacking order of the selected elements (frames stay behind everything else when rendered). */
export function arrangeElements(board: Board, ids: Iterable<string>, action: ArrangeAction): Board {
  const selected = new Set(ids);
  const list = [...board.elements];
  if (!list.some(e => selected.has(e.id))) return board;
  if (action === "front") return { ...board, elements: [...list.filter(e => !selected.has(e.id)), ...list.filter(e => selected.has(e.id))] };
  if (action === "back") return { ...board, elements: [...list.filter(e => selected.has(e.id)), ...list.filter(e => !selected.has(e.id))] };
  if (action === "forward") {
    for (let i = list.length - 2; i >= 0; i--) {
      const current = list[i];
      const above = list[i + 1];
      if (current && above && selected.has(current.id) && !selected.has(above.id)) {
        list[i] = above;
        list[i + 1] = current;
      }
    }
  } else {
    for (let i = 1; i < list.length; i++) {
      const current = list[i];
      const below = list[i - 1];
      if (current && below && selected.has(current.id) && !selected.has(below.id)) {
        list[i] = below;
        list[i - 1] = current;
      }
    }
  }
  return { ...board, elements: list };
}

export function updateStyle(board: Board, ids: Iterable<string>, patch: BoardStyle): Board {
  const selected = new Set(ids);
  return { ...board, elements: board.elements.map(e => (selected.has(e.id) ? { ...e, style: { ...e.style, ...patch } } : e)) };
}

/** Changes the text of a text/sticky element or the title of a frame. */
export function setElementText(board: Board, id: string, value: string): Board {
  return {
    ...board,
    elements: board.elements.map(element => {
      if (element.id !== id) return element;
      if (element.type === "frame") return { ...element, title: value.slice(0, 120) };
      if (element.type === "text" || element.type === "sticky") return { ...element, text: value.slice(0, 10_000) };
      return element;
    }),
  };
}

/** Topmost element under `p`: loose and framed elements first (stored order, last on top), then frames. */
export function hitTest(board: Board, p: Point, tolerance = 0): BoardElement | null {
  const ordered = renderOrder(board);
  for (let i = ordered.length - 1; i >= 0; i--) {
    const element = ordered[i];
    if (!element) continue;
    const b = elementBounds(element);
    const padded = { x: b.x - tolerance, y: b.y - tolerance, width: b.width + tolerance * 2, height: b.height + tolerance * 2 };
    if (containsPoint(padded, rotatePoint(p, center(b), -element.rotation))) return element;
  }
  return null;
}

/** Hit on a frame's title label, drawn above its top-left corner (screen-sized, so it depends on zoom). */
export function frameTitleHit(board: Board, p: Point, zoom: number): BoardElement | null {
  const labelHeight = 22 / zoom;
  for (const frame of frames(board).reverse()) {
    if (p.x >= frame.x && p.x <= frame.x + frame.width && p.y >= frame.y - labelHeight && p.y < frame.y) return frame;
  }
  return null;
}

export function rotatePoint(p: Point, c: Point, degrees: number): Point {
  if (!degrees) return p;
  const r = (degrees * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** Ids of the elements fully inside the marquee (frames' children are reachable by selecting the frame). */
export function elementsInRect(board: Board, rect: Bounds): string[] {
  return board.elements.filter(e => containsBounds(rect, elementBounds(e))).map(e => e.id);
}

/** Ramer–Douglas–Peucker simplification of a freehand stroke. */
export function simplifyPath(points: Point[], tolerance = 1.5): Point[] {
  if (points.length <= 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return points;
  let maxDistance = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const point = points[i];
    if (!point) continue;
    const distance = distanceToSegment(point, first, last);
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }
  if (maxDistance <= tolerance) return [first, last];
  const left = simplifyPath(points.slice(0, index + 1), tolerance);
  const right = simplifyPath(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** A freehand stroke in board units → a path element (points relative to its top-left corner). */
export function pathFromStroke(points: Point[], id: string, style?: BoardStyle, tolerance = 1.5): BoardElement | null {
  const simplified = simplifyPath(points, tolerance).slice(0, 5_000);
  const bounds = unionBounds(simplified.map(p => ({ x: p.x, y: p.y, width: 0, height: 0 })));
  if (!bounds || simplified.length < 2) return null;
  const relative = simplified.map((p): [number, number] => [round(p.x - bounds.x), round(p.y - bounds.y)]);
  return makeElement({ type: "path", points: relative }, { ...bounds, width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) }, id, style);
}

/** SVG path data for a path element's points (relative coordinates). */
export function pathData(points: [number, number][]): string {
  return points.map(([x, y], index) => `${index ? "L" : "M"}${x} ${y}`).join(" ");
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---- Viewport ----

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

export function screenToBoard(viewport: Viewport, p: Point): Point {
  return { x: viewport.x + p.x / viewport.zoom, y: viewport.y + p.y / viewport.zoom };
}

export function boardToScreen(viewport: Viewport, p: Point): Point {
  return { x: (p.x - viewport.x) * viewport.zoom, y: (p.y - viewport.y) * viewport.zoom };
}

/** Zooms by `factor` keeping the board point under the screen point `anchor` fixed. */
export function zoomAt(viewport: Viewport, factor: number, anchor: Point): Viewport {
  const zoom = clampZoom(viewport.zoom * factor);
  const before = screenToBoard(viewport, anchor);
  return { zoom, x: before.x - anchor.x / zoom, y: before.y - anchor.y / zoom };
}

export function panBy(viewport: Viewport, screenDx: number, screenDy: number): Viewport {
  return { ...viewport, x: viewport.x - screenDx / viewport.zoom, y: viewport.y - screenDy / viewport.zoom };
}

/** Viewport that shows `bounds` centered in a screen of `size`, with `padding` screen pixels. */
export function fitBounds(bounds: Bounds | null, size: { width: number; height: number }, padding = 48, maxZoom = 1): Viewport {
  if (!bounds || size.width <= 0 || size.height <= 0) return { x: 0, y: 0, zoom: 1 };
  const availableWidth = Math.max(1, size.width - padding * 2);
  const availableHeight = Math.max(1, size.height - padding * 2);
  const zoom = clampZoom(Math.min(maxZoom, availableWidth / Math.max(1, bounds.width), availableHeight / Math.max(1, bounds.height)));
  const c = center(bounds);
  return { zoom, x: c.x - size.width / 2 / zoom, y: c.y - size.height / 2 / zoom };
}

export function visibleRect(viewport: Viewport, size: { width: number; height: number }): Bounds {
  return { x: viewport.x, y: viewport.y, width: size.width / viewport.zoom, height: size.height / viewport.zoom };
}

/** Elements to render: everything on small boards, only what intersects the view on large ones. */
export function visibleElements(board: Board, view: Bounds, keep: ReadonlySet<string> = new Set()): BoardElement[] {
  const ordered = renderOrder(board);
  if (ordered.length <= BOARD_CULL_THRESHOLD) return ordered;
  return ordered.filter(e => keep.has(e.id) || intersects(view, rotatedBounds(e)));
}

/** Axis-aligned bounds of a possibly rotated element. */
export function rotatedBounds(element: BoardElement): Bounds {
  const b = elementBounds(element);
  if (!element.rotation) return b;
  const c = center(b);
  const corners = [
    { x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height },
  ].map(p => rotatePoint(p, c, element.rotation));
  const xs = corners.map(p => p.x);
  const ys = corners.map(p => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

// ---- Text layout (shared by the canvas and the PNG export, so both wrap the same way) ----

/** Approximate glyph width as a share of the font size; no DOM measuring, so it is deterministic. */
const GLYPH_WIDTH = 0.56;

export function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  const perLine = Math.max(1, Math.floor(maxWidth / (fontSize * GLYPH_WIDTH)));
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let rest = word;
      while (rest.length > perLine) {
        if (line) {
          lines.push(line);
          line = "";
        }
        lines.push(rest.slice(0, perLine));
        rest = rest.slice(perLine);
      }
      const candidate = line ? `${line} ${rest}` : rest;
      if (candidate.length > perLine) {
        lines.push(line);
        line = rest;
      } else line = candidate;
    }
    lines.push(line);
  }
  return lines;
}

export const STICKY_PADDING = 16;
export const LINE_HEIGHT = 1.3;

// ---- Undo history ----

export type BoardHistory = { past: Board[]; present: Board; future: Board[] };
const HISTORY_LIMIT = 100;

export function createHistory(board: Board): BoardHistory {
  return { past: [], present: board, future: [] };
}

/** Records `next` as a new step (no-op when unchanged). */
export function pushHistory(history: BoardHistory, next: Board, previous: Board = history.present): BoardHistory {
  if (next === previous) return history.present === next ? history : { ...history, present: next };
  return { past: [...history.past, previous].slice(-HISTORY_LIMIT), present: next, future: [] };
}

export function undo(history: BoardHistory): BoardHistory {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redo(history: BoardHistory): BoardHistory {
  const next = history.future[0];
  if (!next) return history;
  return { past: [...history.past, history.present], present: next, future: history.future.slice(1) };
}

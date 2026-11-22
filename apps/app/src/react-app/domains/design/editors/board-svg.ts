import type { Board, BoardElement } from "@openwork/types/designs";

import { center, elementBounds, LINE_HEIGHT, pathData, renderOrder, STICKY_PADDING, wrapText } from "./board-model";

/**
 * One description of how each board element is drawn, used by both the React canvas and the
 * PNG export (serialized to an SVG string), so a downloaded frame looks like the canvas.
 * Attribute names are SVG names (kebab case); `toReactProps` converts them for React.
 */
export type SvgNode = { tag: string; attrs: Record<string, string | number>; children?: SvgNode[]; text?: string };

/** Maps an image element's `src` (a path inside the design folder) to a URL the renderer may load. */
export type ImageResolver = (src: string) => string | null;

export const BOARD_FONT = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

function styleAttrs(element: BoardElement): Record<string, string | number> {
  const attrs: Record<string, string | number> = {};
  if (element.style.opacity !== undefined && element.style.opacity < 1) attrs.opacity = element.style.opacity;
  return attrs;
}

function textNode(element: BoardElement, text: string, inset: number): SvgNode {
  const fontSize = element.style.fontSize ?? 20;
  const lines = wrapText(text, Math.max(1, element.width - inset * 2), fontSize);
  return {
    tag: "text",
    attrs: { "font-family": BOARD_FONT, "font-size": fontSize, fill: element.style.color ?? "#1f2933" },
    children: lines.map((line, index) => ({
      tag: "tspan",
      attrs: { x: element.x + inset, y: round(element.y + inset + fontSize * (LINE_HEIGHT * index + 1) - fontSize * 0.15) },
      text: line,
    })),
  };
}

/** The drawing of one element (no selection chrome). */
export function elementNode(element: BoardElement, resolveImage: ImageResolver): SvgNode {
  const { x, y, width, height } = elementBounds(element);
  const fill = element.style.fill ?? "none";
  const stroke = element.style.stroke ?? "none";
  const strokeWidth = element.style.strokeWidth ?? 0;
  let body: SvgNode[];
  switch (element.type) {
    case "frame":
    case "rect":
      body = [{ tag: "rect", attrs: { x, y, width, height, fill, stroke, "stroke-width": strokeWidth } }];
      break;
    case "ellipse":
      body = [{ tag: "ellipse", attrs: { cx: x + width / 2, cy: y + height / 2, rx: width / 2, ry: height / 2, fill, stroke, "stroke-width": strokeWidth } }];
      break;
    case "text":
      body = [textNode(element, element.text, 0)];
      break;
    case "sticky":
      body = [
        { tag: "rect", attrs: { x, y, width, height, rx: 6, fill: element.style.fill ?? "#fff3c4", stroke, "stroke-width": strokeWidth } },
        textNode(element, element.text, STICKY_PADDING),
      ];
      break;
    case "path":
      body = [{
        tag: "path",
        attrs: {
          d: pathData(element.points), transform: `translate(${x} ${y})`, fill: "none",
          stroke: element.style.stroke ?? "#1f2933", "stroke-width": element.style.strokeWidth ?? 3, "stroke-linecap": "round", "stroke-linejoin": "round",
        },
      }];
      break;
    case "image": {
      const href = resolveImage(element.src);
      body = href
        ? [{ tag: "image", attrs: { href, x, y, width, height, preserveAspectRatio: "xMidYMid meet" } }]
        : [{ tag: "rect", attrs: { x, y, width, height, fill: "#f5f7fa", stroke: "#9aa5b1", "stroke-width": 1, "stroke-dasharray": "6 4" } }];
      break;
    }
  }
  const attrs: Record<string, string | number> = { "data-element-id": element.id, ...styleAttrs(element) };
  if (element.rotation) {
    const c = center(element);
    attrs.transform = `rotate(${element.rotation} ${round(c.x)} ${round(c.y)})`;
  }
  return { tag: "g", attrs, children: body };
}

// ---- String serialization ----

const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function nodeToString(node: SvgNode): string {
  const attrs = Object.entries(node.attrs).map(([key, value]) => ` ${key}="${escapeXml(String(value))}"`).join("");
  const inner = `${node.text !== undefined ? escapeXml(node.text) : ""}${(node.children ?? []).map(nodeToString).join("")}`;
  return `<${node.tag}${attrs}>${inner}</${node.tag}>`;
}

/** Image `src` values used by the frame's children (to inline before exporting). */
export function frameImageSources(board: Board, frameId: string): string[] {
  return [...new Set(board.elements.flatMap(e => (e.type === "image" && e.frameId === frameId ? [e.src] : [])))];
}

/**
 * The frame as a standalone SVG document: the frame background and its children, cropped to the
 * frame. `dataUrls` maps image sources to data URLs (an SVG drawn into a canvas cannot load
 * anything else); missing images draw as a dashed placeholder.
 */
export function serializeFrameSvg(board: Board, frameId: string, dataUrls: ReadonlyMap<string, string>): string | null {
  const frame = board.elements.find(e => e.id === frameId && e.type === "frame");
  if (!frame) return null;
  const resolve: ImageResolver = src => {
    const url = dataUrls.get(src);
    return url && url.startsWith("data:") ? url : null;
  };
  const children = renderOrder(board).filter(e => e.type !== "frame" && e.frameId === frameId);
  const width = Math.max(1, Math.round(frame.width));
  const height = Math.max(1, Math.round(frame.height));
  const body = [elementNode({ ...frame, rotation: 0 }, resolve), ...children.map(e => elementNode(e, resolve))].map(nodeToString).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="${frame.x} ${frame.y} ${frame.width} ${frame.height}">${body}</svg>`;
}

// ---- React ----

const kebabToCamel = (name: string) => (name.startsWith("data-") ? name : name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()));

export function toReactProps(attrs: Record<string, string | number>): Record<string, string | number> {
  const props: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(attrs)) props[kebabToCamel(key)] = value;
  return props;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

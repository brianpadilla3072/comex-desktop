import type { Board, BoardElement, DesignManifest } from "@openwork/types/designs";

import { frames } from "./board-model";

/**
 * What the board editor tells the agent with "Pedir al agente". The text is model-facing (not
 * shown to the person), so it stays in English like the rest of the agent guidance.
 *
 * Expectations for the agent (A's design guidance should say the same):
 * - The board is `board.json` in the design folder (`boardSchema`). Keep every existing element and
 *   its id; add elements with new unique ids (max 64 chars); keep at most 5000 elements.
 * - Illustrations are SVG files written to `assets/<name>.svg` (self-contained: no external
 *   references, no scripts, no fonts from the network). Add them to the board as
 *   `{ "type": "image", "src": "assets/<name>.svg", x, y, width, height, frameId }`.
 * - An element belongs to a frame when its center is inside the frame and `frameId` is the frame id.
 *   Frames are titled "<n> · <name>" and numbered in order of creation.
 * - Rewrite board.json as a whole valid document; the editor reloads it and keeps the selection.
 */
export const BOARD_AGENT_RULES = [
  "Edit board.json in the design folder (format openwork.board v1). Keep existing elements and ids; new elements need new unique ids.",
  "Element types: frame (title), rect, ellipse, text (text), sticky (text), path (points relative to x,y), image (src).",
  "Draw illustrations as self-contained SVG files in assets/<name>.svg (no external references or scripts) and add an image element with src \"assets/<name>.svg\".",
  "An element inside a frame has frameId set to that frame's id and its center inside the frame bounds.",
  "Write the whole board.json as valid JSON; at most 5000 elements.",
].join("\n");

function describe(element: BoardElement, frameNumbers: ReadonlyMap<string, number>): string {
  const bounds = `x=${Math.round(element.x)} y=${Math.round(element.y)} w=${Math.round(element.width)} h=${Math.round(element.height)}`;
  const frame = element.frameId ? ` in frame ${frameNumbers.get(element.frameId) ?? "?"} (${element.frameId})` : "";
  const label = element.type === "frame" ? ` "${element.title}"`
    : element.type === "text" || element.type === "sticky" ? ` "${element.text.slice(0, 120).replace(/\s+/g, " ")}"`
    : element.type === "image" ? ` src=${element.src}`
    : "";
  return `- ${element.type} ${element.id}${label} ${bounds}${frame}`;
}

/** Context sent with a request: where the board is, its frames, and what the person selected. */
export function boardAgentContext(design: Pick<DesignManifest, "id" | "title">, board: Board, selection: ReadonlySet<string>): string {
  const list = frames(board);
  const frameNumbers = new Map(list.map((frame, index) => [frame.id, index + 1]));
  const selected = board.elements.filter(e => selection.has(e.id)).slice(0, 40);
  const lines = [
    `Whiteboard "${design.title}": proyecto/diseno/${design.id}/board.json (${board.elements.length} elements).`,
    list.length
      ? `Frames:\n${list.map((frame, index) => `- ${index + 1}. "${frame.title}" id=${frame.id} x=${Math.round(frame.x)} y=${Math.round(frame.y)} w=${Math.round(frame.width)} h=${Math.round(frame.height)}`).join("\n")}`
      : "Frames: none.",
    selected.length ? `Selected:\n${selected.map(e => describe(e, frameNumbers)).join("\n")}` : "Selected: nothing.",
    BOARD_AGENT_RULES,
  ];
  return lines.join("\n\n");
}

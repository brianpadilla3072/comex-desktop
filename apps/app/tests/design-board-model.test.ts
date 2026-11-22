import { describe, expect, test } from "bun:test";
import { boardSchema, DESIGN_LIMITS, type Board, type BoardElement } from "@openwork/types/designs";

import {
  addElements, arrangeElements, assignFrames, createHistory, deleteElements, duplicateElements, elementsInRect, emptyBoard, fitBounds,
  frameTitleHit, hitTest, makeElement, moveElements, nextFrameTitle, parseBoard, pathFromStroke, pushHistory, redo, resizeBounds,
  resizeElement, rotationFromPointer, screenToBoard, boardToScreen, serializeBoard, setElementText, simplifyPath, undo, updateStyle,
  visibleElements, wrapText, zoomAt, BOARD_CULL_THRESHOLD,
} from "../src/react-app/domains/design/editors/board-model";
import { boardAgentContext } from "../src/react-app/domains/design/editors/board-agent";
import { frameImageSources, serializeFrameSvg } from "../src/react-app/domains/design/editors/board-svg";
import { blobToDataUrl, frameSvgDocument, framePngFileName, imageMimeType } from "../src/react-app/domains/design/editors/board-export";
import { uploadAssetPath, validAssetPath } from "../src/react-app/domains/design/editors/board-image-dialog";

const frame = (id: string, x: number, y: number, width = 400, height = 300, title = "1 · Relevamiento") =>
  makeElement({ type: "frame", title }, { x, y, width, height }, id);
const rect = (id: string, x: number, y: number, width = 100, height = 50) => makeElement({ type: "rect" }, { x, y, width, height }, id);

function board(...elements: BoardElement[]): Board {
  return addElements(emptyBoard(), elements);
}

const find = (b: Board, id: string) => {
  const element = b.elements.find(e => e.id === id);
  if (!element) throw new Error(`missing ${id}`);
  return element;
};

describe("frames and membership", () => {
  test("an element created inside a frame belongs to it; outside it is loose", () => {
    const b = board(frame("f1", 0, 0), rect("inside", 50, 50), rect("outside", 600, 50));
    expect(find(b, "inside").frameId).toBe("f1");
    expect(find(b, "outside").frameId).toBeNull();
  });

  test("a frame drawn over loose elements adopts them", () => {
    const loose = board(rect("a", 50, 50));
    const framed = addElements(loose, [frame("f1", 0, 0)]);
    expect(find(framed, "a").frameId).toBe("f1");
  });

  test("moving a frame moves its children; moving a child out releases it", () => {
    const b = board(frame("f1", 0, 0), rect("child", 50, 50), rect("loose", 600, 600));
    const moved = assignFrames(moveElements(b, ["f1"], 100, 20), ["f1"]);
    expect(find(moved, "f1")).toMatchObject({ x: 100, y: 20 });
    expect(find(moved, "child")).toMatchObject({ x: 150, y: 70, frameId: "f1" });
    expect(find(moved, "loose")).toMatchObject({ x: 600, y: 600, frameId: null });
    const out = assignFrames(moveElements(moved, ["child"], 900, 0), ["child"]);
    expect(find(out, "child").frameId).toBeNull();
  });

  test("shrinking a frame past a child releases it", () => {
    const b = board(frame("f1", 0, 0), rect("child", 300, 200));
    const shrunk = assignFrames(resizeElement(b, "f1", { x: 0, y: 0, width: 200, height: 150 }), ["f1"]);
    expect(find(shrunk, "child").frameId).toBeNull();
  });

  test("deleting a frame deletes its children", () => {
    const b = board(frame("f1", 0, 0), rect("child", 50, 50), rect("loose", 600, 600));
    expect(deleteElements(b, ["f1"]).elements.map(e => e.id)).toEqual(["loose"]);
  });

  test("frame titles are numbered", () => {
    expect(nextFrameTitle(board(frame("f1", 0, 0)), "Marco")).toBe("2 · Marco");
  });

  test("the frame title label is hit above the frame", () => {
    const b = board(frame("f1", 100, 100));
    expect(frameTitleHit(b, { x: 120, y: 90 }, 1)?.id).toBe("f1");
    expect(frameTitleHit(b, { x: 120, y: 110 }, 1)).toBeNull();
  });
});

describe("element operations", () => {
  test("resize handles and aspect lock", () => {
    const start = { x: 0, y: 0, width: 100, height: 50 };
    expect(resizeBounds(start, "se", 20, 10)).toEqual({ x: 0, y: 0, width: 120, height: 60 });
    expect(resizeBounds(start, "nw", 20, 10)).toEqual({ x: 20, y: 10, width: 80, height: 40 });
    expect(resizeBounds(start, "e", -500, 0).width).toBe(1);
    expect(resizeBounds(start, "se", 100, 0, true)).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });

  test("resizing a path scales its points", () => {
    const path = pathFromStroke([{ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }], "p1");
    if (!path) throw new Error("no path");
    const b = resizeElement(board(path), "p1", { x: 0, y: 0, width: 200, height: 50 });
    const resized = find(b, "p1");
    expect(resized.type === "path" ? resized.points : []).toEqual([[0, 0], [100, 50], [200, 0]]);
  });

  test("rotation follows the pointer around the center and snaps with shift", () => {
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    expect(rotationFromPointer(bounds, { x: 50, y: -50 })).toBe(0);
    expect(rotationFromPointer(bounds, { x: 150, y: 50 })).toBe(90);
    expect(rotationFromPointer(bounds, { x: 150, y: 40 }, true)).toBe(90);
  });

  test("duplicate copies a frame with its children under new ids", () => {
    const b = board(frame("f1", 0, 0), rect("child", 50, 50));
    const result = duplicateElements(b, ["f1"], 1000);
    expect(result.ids).toHaveLength(1);
    expect(result.board.elements).toHaveLength(4);
    const copyFrame = find(result.board, result.ids[0] ?? "");
    const copyChild = result.board.elements.find(e => e.id !== "child" && e.type === "rect");
    expect(copyFrame.x).toBe(1000);
    expect(copyChild?.frameId).toBe(copyFrame.id);
  });

  test("arrange moves the selection in the stacking order", () => {
    const b = board(rect("a", 0, 0), rect("b", 0, 0), rect("c", 0, 0));
    const ids = (x: Board) => x.elements.map(e => e.id).join("");
    expect(ids(arrangeElements(b, ["a"], "front"))).toBe("bca");
    expect(ids(arrangeElements(b, ["c"], "back"))).toBe("cab");
    expect(ids(arrangeElements(b, ["a"], "forward"))).toBe("bac");
    expect(ids(arrangeElements(b, ["c"], "backward"))).toBe("acb");
  });

  test("style, text and hit testing", () => {
    const text = makeElement({ type: "text", text: "Hola" }, { x: 0, y: 0, width: 100, height: 30 }, "t1");
    let b = board(frame("f1", 0, 0, 500, 500), text);
    b = updateStyle(b, ["t1"], { color: "#d64545", fontSize: 32 });
    b = setElementText(b, "t1", "Chau");
    expect(find(b, "t1")).toMatchObject({ text: "Chau", style: { color: "#d64545", fontSize: 32 } });
    expect(hitTest(b, { x: 10, y: 10 })?.id).toBe("t1");
    expect(hitTest(b, { x: 300, y: 300 })?.id).toBe("f1");
    expect(hitTest(b, { x: 900, y: 900 })).toBeNull();
  });

  test("marquee selects only what it fully contains", () => {
    const b = board(rect("a", 10, 10, 20, 20), rect("b", 100, 100, 50, 50));
    expect(elementsInRect(b, { x: 0, y: 0, width: 120, height: 120 })).toEqual(["a"]);
  });

  test("the element cap is respected", () => {
    const full: Board = { ...emptyBoard(), elements: Array.from({ length: DESIGN_LIMITS.boardElements }, (_, i) => rect(`r${i}`, i, 0)) };
    expect(addElements(full, [rect("extra", 0, 0)])).toBe(full);
    expect(duplicateElements(full, ["r1"]).ids).toEqual([]);
    expect(serializeBoard({ ...full, elements: [...full.elements, rect("extra", 0, 0)] })).toEqual({ ok: false, reason: "too_many_elements" });
  });
});

describe("pen, text layout and viewport", () => {
  test("simplification drops collinear points and keeps corners", () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ x: i, y: 0 }));
    expect(simplifyPath(line)).toEqual([{ x: 0, y: 0 }, { x: 49, y: 0 }]);
    const corner = [...line, ...Array.from({ length: 50 }, (_, i) => ({ x: 49, y: i + 1 }))];
    expect(simplifyPath(corner)).toHaveLength(3);
  });

  test("a stroke becomes a path with points relative to its corner", () => {
    const path = pathFromStroke([{ x: 10, y: 20 }, { x: 60, y: 80 }, { x: 110, y: 20 }], "p1");
    expect(path).toMatchObject({ type: "path", x: 10, y: 20, width: 100, height: 60, points: [[0, 0], [50, 60], [100, 0]] });
    expect(pathFromStroke([{ x: 1, y: 1 }], "p2")).toBeNull();
  });

  test("text wraps by words and breaks long words", () => {
    expect(wrapText("uno dos tres", 60, 20)).toEqual(["uno", "dos", "tres"]);
    expect(wrapText("a\n\nb", 500, 20)).toEqual(["a", "", "b"]);
    expect(wrapText("abcdefghij", 34, 20)).toEqual(["abc", "def", "ghi", "j"]);
  });

  test("zoom keeps the point under the pointer; fit centers bounds", () => {
    const viewport = { x: 0, y: 0, zoom: 1 };
    const anchor = { x: 200, y: 100 };
    const before = screenToBoard(viewport, anchor);
    const zoomed = zoomAt(viewport, 2, anchor);
    expect(zoomed.zoom).toBe(2);
    expect(boardToScreen(zoomed, before)).toEqual(anchor);
    const fit = fitBounds({ x: 0, y: 0, width: 1000, height: 500 }, { width: 600, height: 400 }, 50);
    expect(fit.zoom).toBe(0.5);
    expect(boardToScreen(fit, { x: 500, y: 250 })).toEqual({ x: 300, y: 200 });
  });

  test("large boards render only what intersects the view, plus the selection", () => {
    const many: Board = { ...emptyBoard(), elements: Array.from({ length: BOARD_CULL_THRESHOLD + 10 }, (_, i) => rect(`r${i}`, i * 200, 0)) };
    const shown = visibleElements(many, { x: 0, y: 0, width: 500, height: 500 }, new Set(["r100"]));
    expect(shown.map(e => e.id)).toEqual(["r0", "r1", "r2", "r100"]);
    const small = board(rect("a", 5000, 5000));
    expect(visibleElements(small, { x: 0, y: 0, width: 10, height: 10 })).toHaveLength(1);
  });
});

describe("history and persistence", () => {
  test("undo and redo walk the history; a new step clears redo", () => {
    const a = emptyBoard();
    const b = board(rect("r1", 0, 0));
    const c = addElements(b, [rect("r2", 10, 10)]);
    let history = pushHistory(pushHistory(createHistory(a), b), c);
    history = undo(history);
    expect(history.present).toBe(b);
    history = undo(history);
    expect(history.present).toBe(a);
    expect(undo(history)).toBe(history);
    history = redo(history);
    expect(history.present).toBe(b);
    history = pushHistory(history, a);
    expect(history.future).toEqual([]);
    expect(redo(history)).toBe(history);
  });

  test("serialize → parse round-trips through boardSchema", () => {
    const path = pathFromStroke([{ x: 0, y: 0 }, { x: 40, y: 40 }], "p1");
    if (!path) throw new Error("no path");
    const original = board(
      frame("f1", 0, 0),
      rect("r1", 10, 10),
      makeElement({ type: "ellipse" }, { x: 20, y: 20, width: 30, height: 30 }, "e1"),
      makeElement({ type: "text", text: "Título" }, { x: 30, y: 30, width: 100, height: 30 }, "t1"),
      makeElement({ type: "sticky", text: "Idea" }, { x: 40, y: 40, width: 100, height: 100 }, "s1"),
      makeElement({ type: "image", src: "assets/logo.svg" }, { x: 50, y: 50, width: 64, height: 64 }, "i1"),
      path,
    );
    const result = serializeBoard({ ...original, viewport: { x: 5, y: 6, zoom: 1.5 } });
    if (!result.ok) throw new Error(result.reason);
    expect(boardSchema.safeParse(JSON.parse(result.text)).success).toBe(true);
    const parsed = parseBoard(result.text);
    expect(parsed?.elements).toEqual(original.elements);
    expect(parsed?.viewport).toEqual({ x: 5, y: 6, zoom: 1.5 });
  });

  test("invalid board.json is rejected", () => {
    expect(parseBoard("{")).toBeNull();
    expect(parseBoard(JSON.stringify({ format: "openwork.board", version: 2, elements: [] }))).toBeNull();
    expect(parseBoard(JSON.stringify({ format: "openwork.board", version: 1, elements: [{ id: "x", type: "image", src: "../fuera.svg", x: 0, y: 0, width: 1, height: 1 }] }))).toBeNull();
    const bad = { ...emptyBoard(), elements: [{ ...rect("r", 0, 0), width: -5 }] };
    expect(serializeBoard(bad)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("frame PNG export", () => {
  const exportBoard = () => board(
    frame("f1", 100, 100, 400, 300, "2 · Ideas <clave>"),
    makeElement({ type: "sticky", text: "Precio & plazo" }, { x: 120, y: 120, width: 200, height: 200 }, "s1"),
    makeElement({ type: "image", src: "assets/ilustracion.svg" }, { x: 300, y: 150, width: 100, height: 100 }, "i1"),
    rect("outside", 900, 900),
  );

  test("the SVG is cropped to the frame, escapes text and only holds the frame's children", () => {
    const svg = serializeFrameSvg(exportBoard(), "f1", new Map([["assets/ilustracion.svg", "data:image/svg+xml;base64,PHN2Zy8+"]]));
    if (!svg) throw new Error("no svg");
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('width="400" height="300" viewBox="100 100 400 300"');
    expect(svg).toContain("Precio &amp; plazo");
    expect(svg).toContain('href="data:image/svg+xml;base64,PHN2Zy8+"');
    expect(svg).not.toContain('data-element-id="outside"');
    expect(svg).not.toContain("<clave>");
    expect(new DOMParserLike(svg).wellFormed).toBe(true);
  });

  test("images that are not data URLs become placeholders (no external loads)", () => {
    const svg = serializeFrameSvg(exportBoard(), "f1", new Map([["assets/ilustracion.svg", "https://example.com/x.svg"]]));
    expect(svg).not.toContain("example.com");
    expect(svg).toContain('stroke-dasharray="6 4"');
    expect(serializeFrameSvg(exportBoard(), "missing", new Map())).toBeNull();
  });

  test("images are read from the design folder and inlined", async () => {
    const reads: string[] = [];
    const svg = await frameSvgDocument(exportBoard(), "f1", async path => {
      reads.push(path);
      return new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: "text/plain" });
    });
    expect(reads).toEqual(["assets/ilustracion.svg"]);
    expect(svg).toContain(`href="${await blobToDataUrl(new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>']), "image/svg+xml")}"`);
    expect(frameImageSources(exportBoard(), "f1")).toEqual(["assets/ilustracion.svg"]);
  });

  test("file names and asset paths are safe", () => {
    expect(framePngFileName("1 · Relevamiento de campo", "marco")).toBe("1-relevamiento-de-campo.png");
    expect(framePngFileName("···", "marco")).toBe("marco.png");
    expect(imageMimeType("assets/a.SVG")).toBe("image/svg+xml");
    expect(imageMimeType("assets/a.txt")).toBeNull();
    expect(uploadAssetPath("Foto Año.JPEG", "ab12")).toBe("assets/foto-ano-ab12.jpg");
    expect(uploadAssetPath("notas.txt", "ab12")).toBeNull();
    expect(validAssetPath("assets/logo.png")).toBe(true);
    expect(validAssetPath("../logo.png")).toBe(false);
    expect(validAssetPath("assets/.oculto.png")).toBe(false);
  });
});

test("the agent context names the board file, frames and selection", () => {
  const b = board(frame("f1", 0, 0, 400, 300, "1 · Relevamiento"), frame("f2", 500, 0, 400, 300, "2 · Ideas"), makeElement({ type: "sticky", text: "Llamar al cliente" }, { x: 520, y: 20, width: 100, height: 100 }, "s1"));
  const context = boardAgentContext({ id: "pizarra-1", title: "Pizarra" }, b, new Set(["s1"]));
  expect(context).toContain("proyecto/diseno/pizarra-1/board.json");
  expect(context).toContain('2. "2 · Ideas" id=f2');
  expect(context).toContain('sticky s1 "Llamar al cliente"');
  expect(context).toContain("in frame 2 (f2)");
  expect(context).toContain("assets/<name>.svg");
});

/** Minimal well-formedness check: every opened tag closes in order. */
class DOMParserLike {
  wellFormed: boolean;
  constructor(xml: string) {
    const stack: string[] = [];
    let ok = true;
    for (const match of xml.matchAll(/<(\/?)([a-zA-Z]+)[^>]*?(\/?)>/g)) {
      const [, closing, name, selfClosing] = match;
      if (selfClosing) continue;
      if (closing) ok = ok && stack.pop() === name;
      else if (name) stack.push(name);
    }
    this.wellFormed = ok && stack.length === 0;
  }
}

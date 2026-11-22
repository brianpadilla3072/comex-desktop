import type { Board } from "@openwork/types/designs";

import { frameImageSources, serializeFrameSvg } from "./board-svg";

/** Reads a file of the design folder (the client's `readDesignFile`, bound to the design). */
export type DesignFileReader = (path: string) => Promise<Blob>;

const IMAGE_TYPES: Record<string, string> = {
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
};

/** MIME type for an asset path, by extension; null when it is not an image the board shows. */
export function imageMimeType(path: string): string | null {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_TYPES[extension] ?? null;
}

export async function blobToDataUrl(blob: Blob, type = blob.type): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return `data:${type || "application/octet-stream"};base64,${btoa(binary)}`;
}

/** Reads every image of the frame and returns them as data URLs (unreadable ones are skipped). */
export async function frameImageDataUrls(board: Board, frameId: string, read: DesignFileReader): Promise<Map<string, string>> {
  const entries = await Promise.all(frameImageSources(board, frameId).map(async (src): Promise<[string, string] | null> => {
    const type = imageMimeType(src);
    if (!type) return null;
    try {
      return [src, await blobToDataUrl(await read(src), type)];
    } catch {
      return null;
    }
  }));
  return new Map(entries.flatMap(entry => (entry ? [entry] : [])));
}

/** The frame's SVG with its images inlined; null when the frame no longer exists. */
export async function frameSvgDocument(board: Board, frameId: string, read: DesignFileReader): Promise<string | null> {
  return serializeFrameSvg(board, frameId, await frameImageDataUrls(board, frameId, read));
}

/** Draws an SVG document into a canvas at `scale` and returns a PNG. Browser only. */
export async function rasterizeSvg(svg: string, width: number, height: number, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("board_png_render_failed"));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("board_png_render_failed");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error("board_png_render_failed"))), "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** File name for a frame's PNG: the title without the number prefix, safe for any file system. */
export function framePngFileName(title: string, fallback: string): string {
  const cleaned = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return `${cleaned || fallback}.png`;
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** Serializes, rasterizes and downloads one frame as PNG. */
export async function downloadFramePng(board: Board, frameId: string, read: DesignFileReader, fallbackName: string): Promise<void> {
  const frame = board.elements.find(e => e.id === frameId && e.type === "frame");
  const svg = await frameSvgDocument(board, frameId, read);
  if (!frame || frame.type !== "frame" || !svg) throw new Error("board_frame_missing");
  const png = await rasterizeSvg(svg, frame.width, frame.height);
  downloadBlob(png, framePngFileName(frame.title, fallbackName));
}

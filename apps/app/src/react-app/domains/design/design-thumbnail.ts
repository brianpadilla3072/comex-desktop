import { useEffect, useRef } from "react";
import type { DesignManifest, DesignPage } from "@/app/lib/designs";
import type { DesignClient } from "./design-client";
import { desktopRenderer } from "./editors/slides-export";
import { selfContainedPageHtml } from "./editors/slides-inline";

/**
 * Gallery previews. A page is HTML in a sandboxed frame, and the browser cannot photograph a
 * frame by itself; the desktop app can (it renders pages offscreen for the PDF/PNG export). That
 * renderer registers itself here with `setDesignThumbnailCapturer`; on the web nothing is
 * registered, no preview is captured and the gallery shows the kind's mark instead.
 */
export type DesignThumbnailCapturer = (input: { workspaceId: string; designId: string; page: DesignPage }) => Promise<Blob | null>;

// Owner: the app window; set once by the desktop renderer bridge, read by every open design page.
let capturer: DesignThumbnailCapturer | null = null;
export function setDesignThumbnailCapturer(next: DesignThumbnailCapturer | null) { capturer = next; }
export const designThumbnailCapturer = () => capturer;

const SETTLE_MS = 2_500;

/**
 * After the design's content changed (its `revision`), and once it settled, capture the first
 * page and store it as `thumbnail.png`. Only with owner access and a registered capturer.
 */
export function useDesignThumbnailRefresh(input: { client: Pick<DesignClient, "putDesignThumbnail">; workspaceId: string; design: DesignManifest | null; revision: number; writable: boolean; onSaved?: () => void }) {
  const { client, workspaceId, design, revision, writable, onSaved } = input;
  const captured = useRef<string | null>(null);
  const saved = useRef(onSaved);
  saved.current = onSaved;
  const first = design?.pages[0] ?? null;
  const key = design && first ? `${design.id}:${first.file}:${revision}` : null;
  useEffect(() => {
    const capture = designThumbnailCapturer();
    if (!key || !design || !first || !writable || !capture) return;
    // A design without a preview gets one at once; otherwise only after a change.
    if (captured.current === null && design.thumbnail !== null) { captured.current = key; return; }
    if (captured.current === key) return;
    const timer = setTimeout(() => {
      captured.current = key;
      void capture({ workspaceId, designId: design.id, page: first })
        .then(png => png ? client.putDesignThumbnail(workspaceId, design.id, png).then(() => saved.current?.()) : undefined)
        .catch(() => undefined);
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [key, design, first, writable, client, workspaceId]);
}

/**
 * In the desktop app, register the offscreen renderer (the one the PDF/PNG export uses) as the
 * thumbnail capturer for this client. No-op on the web. Returns the unregister function.
 */
export function registerDesktopThumbnailCapturer(client: Pick<DesignClient, "readDesignFile">): () => void {
  const render = desktopRenderer();
  if (!render) return () => undefined;
  const capturerForClient: DesignThumbnailCapturer = async ({ workspaceId, designId, page }) => {
    const read = (path: string) => client.readDesignFile(workspaceId, designId, path);
    const html = await selfContainedPageHtml(await (await read(page.file)).text(), page.file, read);
    const result = await render({ format: "png", pages: [{ html, width: page.width, height: page.height }] });
    const bytes = result.ok ? result.files[0] : undefined;
    if (!bytes) return null;
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return new Blob([copy.buffer], { type: "image/png" });
  };
  setDesignThumbnailCapturer(capturerForClient);
  return () => { if (capturer === capturerForClient) setDesignThumbnailCapturer(null); };
}

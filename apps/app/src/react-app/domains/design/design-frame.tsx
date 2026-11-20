/** @jsxImportSource react */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";

import type { DesignPage } from "@/app/lib/designs";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

import { useDesignClient, type DesignClient } from "./design-client";
import { buildFrameDocument, fitScale } from "./design-frame-model";

/**
 * One page of a design, rendered in a sandboxed iframe.
 *
 * - `sandbox="allow-same-origin"` and nothing else: no script of the page ever runs (no
 *   `allow-scripts`), forms, popups and navigation are blocked, and the app can still read the
 *   frame's DOM (`onFrameReady`), which the comment/edit picker needs to point at elements.
 *   Same origin without scripts is safe: only the app's own code touches that document.
 * - No network: the document is rebuilt with `buildFrameDocument` (relative assets become blob
 *   or data URLs, absolute ones are dropped) and carries the server's strict CSP as a <meta>.
 * - It reloads when the page, the design or `reloadKey` change, and scales to fit its box unless
 *   `scale` is given.
 */
export function DesignFrame({ workspaceId, designId, page, scale, interactive = false, className, onFrameReady, reloadKey, client: clientProp, title }: {
  workspaceId: string;
  designId: string;
  page: DesignPage;
  /** Fixed scale; absent fits the page in the available box. */
  scale?: number;
  /** Lets pointer and keyboard reach the page (editing, picking); off for thumbnails. */
  interactive?: boolean;
  className?: string;
  onFrameReady?: (iframe: HTMLIFrameElement) => void;
  /** Change it to read the page again (after the agent or an editor changed files). */
  reloadKey?: string | number;
  /** Defaults to the design page's client (`DesignClientContext`). */
  client?: DesignClient;
  /** Accessible name of the frame; the page title by default. */
  title?: string;
}) {
  const contextClient = useDesignClient();
  const client = clientProp ?? contextClient;
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [doc, setDoc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [fitted, setFitted] = useState(0);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    let urls: string[] = [];
    setFailed(false);
    const read = (path: string) => client.readDesignFile(workspaceId, designId, path);
    void read(page.file)
      .then(blob => blob.text())
      .then(html => buildFrameDocument(html, page.file, read))
      .then(built => {
        if (cancelled) { for (const url of built.urls) URL.revokeObjectURL(url); return; }
        urls = built.urls;
        setDoc(built.html);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      // The previous document keeps showing until the next one is ready; its URLs go after a beat.
      const stale = urls;
      setTimeout(() => { for (const url of stale) URL.revokeObjectURL(url); }, 1_000);
    };
  }, [client, workspaceId, designId, page.file, reloadKey]);

  useLayoutEffect(() => {
    if (scale !== undefined) return;
    const element = box.current;
    if (!element) return;
    const update = () => setFitted(fitScale({ width: element.clientWidth, height: element.clientHeight }, page, true));
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [scale, page.width, page.height]);

  const effective = scale ?? fitted;
  const label = title ?? (page.title || t("design_ui.studio.page_fallback", { id: page.id }));

  return <div ref={box} data-design-frame={page.id} className={cn("relative flex min-h-0 min-w-0 items-center justify-center overflow-hidden", className)}>
    {failed ? <div role="alert" data-design-frame-error className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
      <AlertTriangle className="size-4 text-destructive" aria-hidden />{t("design_ui.studio.frame_failed")}
    </div> : doc === null ? <Skeleton data-design-frame-loading className="h-full w-full rounded-md" aria-label={t("design_ui.studio.loading")} />
      : <div className="relative shrink-0 overflow-hidden bg-white shadow-sm ring-1 ring-border" style={{ width: page.width * effective, height: page.height * effective }}>
        <iframe
          ref={frame}
          title={label}
          data-design-frame-iframe
          sandbox="allow-same-origin"
          referrerPolicy="no-referrer"
          srcDoc={doc}
          tabIndex={interactive ? 0 : -1}
          aria-hidden={interactive ? undefined : true}
          onLoad={() => { if (frame.current) onFrameReady?.(frame.current); }}
          className={cn("absolute left-0 top-0 origin-top-left border-0", !interactive && "pointer-events-none")}
          style={{ width: page.width, height: page.height, transform: `scale(${effective})` }}
        />
      </div>}
  </div>;
}

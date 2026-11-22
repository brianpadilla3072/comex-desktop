import { useCallback, useEffect, useRef, useState } from "react";
import type { Board } from "@openwork/types/designs";

import { imageMimeType, type DesignFileReader } from "./board-export";
import type { ImageResolver } from "./board-svg";

/**
 * Loads the board's images from the design folder as blob URLs (the canvas never points at a
 * path or the network). `version` changes when files may have changed outside the editor, which
 * drops the cache so an illustration the agent rewrote shows its new content.
 */
export function useBoardImages(board: Board | null, read: DesignFileReader, version: string | number): ImageResolver {
  const urls = useRef(new Map<string, string>());
  const pending = useRef(new Set<string>());
  const [, setLoaded] = useState(0);
  const versionRef = useRef(version);
  versionRef.current = version;

  useEffect(() => {
    const cache = urls.current;
    return () => {
      for (const url of cache.values()) URL.revokeObjectURL(url);
      cache.clear();
      pending.current.clear();
    };
  }, [version]);

  const sources = board ? [...new Set(board.elements.flatMap(e => (e.type === "image" ? [e.src] : [])))] : [];
  const key = sources.join("\n");

  useEffect(() => {
    for (const src of key ? key.split("\n") : []) {
      const type = imageMimeType(src);
      if (!type || urls.current.has(src) || pending.current.has(src)) continue;
      pending.current.add(src);
      void read(src)
        .then(blob => {
          // A reply for files that changed meanwhile is stale; the new version reads them again.
          if (versionRef.current !== version) return;
          pending.current.delete(src);
          // An SVG must be served as SVG for <image> to draw it, whatever the response said.
          const typed = blob.type === type ? blob : new Blob([blob], { type });
          urls.current.set(src, URL.createObjectURL(typed));
          setLoaded(value => value + 1);
        })
        .catch(() => {
          if (versionRef.current === version) pending.current.delete(src);
        });
    }
  }, [key, read, version]);

  return useCallback((src: string) => urls.current.get(src) ?? null, []);
}

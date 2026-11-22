/** A render owns its pending DOM writes. Cache ownership belongs to the chat. */
export function hydrateLocalImages(
  root: HTMLElement,
  cache: Map<string, Promise<string | null>>,
  load: (href: string, node: Element, decode: boolean) => Promise<string | null>,
) {
  let cancelled = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const nodes = new Set<HTMLImageElement>();
  const listeners = new Map<HTMLImageElement, () => void>();
  for (const image of root.querySelectorAll<HTMLImageElement>("img[data-openwork-image-path]")) {
    if (image.dataset.openworkImageState) continue;
    nodes.add(image);
    const href = image.dataset.openworkImagePath ?? "";
    const decode = image.dataset.openworkPathDecode === "true";
    const key = `${decode}:${href}`;
    const attempt = (number: number) => {
      if (cancelled || !image.isConnected) return;
      image.dataset.openworkImageState = "loading";
      let pending = cache.get(key);
      if (!pending) {
        pending = load(href, image, decode).catch(() => null);
        cache.set(key, pending);
      }
      void pending.then(url => {
        if (cancelled || !image.isConnected) return;
        if (!url) {
          if (cache.get(key) === pending) cache.delete(key);
          delete image.dataset.openworkImageState;
          if (number < 3) {
            const timer = setTimeout(() => { timers.delete(timer); attempt(number + 1); }, 500 * (number + 1));
            timers.add(timer);
          }
          return;
        }
        const loaded = () => {
          if (cancelled) return;
          image.dataset.openworkImageState = "loaded";
          const box = image.closest("[data-openwork-image]");
          const preview = image.closest("[data-openwork-image-preview]");
          if (box && preview) box.replaceWith(preview);
        };
        listeners.set(image, loaded);
        image.addEventListener("load", loaded, { once: true });
        image.src = url;
        if (image.complete && image.naturalWidth > 0) loaded();
      });
    };
    attempt(0);
  }
  return () => {
    cancelled = true;
    for (const timer of timers) clearTimeout(timer);
    for (const [image, listener] of listeners) image.removeEventListener("load", listener);
    for (const image of nodes) if (image.dataset.openworkImageState === "loading") delete image.dataset.openworkImageState;
  };
}

export function releaseLocalImages(root: HTMLElement | null, cache: Map<string, Promise<string | null>>) {
  for (const image of root?.querySelectorAll("img[data-openwork-image-path]") ?? []) {
    image.removeAttribute("src");
    image.removeAttribute("data-openwork-image-state");
  }
  for (const pending of cache.values()) void pending.then(url => { if (url) URL.revokeObjectURL(url); });
  cache.clear();
}

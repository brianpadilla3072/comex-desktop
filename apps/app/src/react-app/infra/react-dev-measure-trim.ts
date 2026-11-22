/**
 * React 19 development builds log every component render to the User Timing
 * buffer with `performance.measure` (component names start with U+200B; track
 * entries are named "Update", "Mount", "Cascading Update", ...), each with a
 * props diff attached. Browsers keep measures until something clears them, so a
 * development window that streams a few chats grows its renderer by hundreds of
 * MB (measured: 570k entries, ~650 MB of native heap after ~10 minutes with 10
 * chats). Production builds never record them.
 *
 * In development, forget React's measures every few seconds. The DevTools
 * Performance panel records its own trace and does not read this buffer. Our
 * own `openwork.*` measures are kept.
 */
export const REACT_DEV_MEASURE_TRIM_MS = 15_000;

const OWN_MEASURE_PREFIX = "openwork.";

type MeasureBuffer = Pick<Performance, "clearMeasures">;
type ObserverConstructor = new (callback: (list: { getEntries(): readonly { name: string }[] }) => void) => {
  observe(options: { type: string; buffered?: boolean }): void;
  disconnect(): void;
};
type Scheduler = {
  setInterval: (callback: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
};

export type ReactDevMeasureTrimOptions = {
  performance?: MeasureBuffer;
  Observer?: ObserverConstructor;
  scheduler?: Scheduler;
  intervalMs?: number;
};

/** Starts the trim; returns a stop function. A no-op where User Timing is missing. */
export function startReactDevMeasureTrim(options: ReactDevMeasureTrimOptions = {}): () => void {
  // An explicitly passed `undefined` means "not supported here" (tests); otherwise use the page's.
  const buffer = "performance" in options ? options.performance : typeof performance === "undefined" ? undefined : performance;
  const Observer = "Observer" in options ? options.Observer : typeof PerformanceObserver === "undefined" ? undefined : PerformanceObserver;
  const scheduler: Scheduler = options.scheduler ?? {
    setInterval: (callback, ms) => globalThis.setInterval(callback, ms),
    clearInterval: (handle) => {
      if (typeof handle === "number") globalThis.clearInterval(handle);
    },
  };
  if (!buffer || typeof buffer.clearMeasures !== "function" || !Observer) return () => {};

  // clearMeasures() takes one name at a time; React uses a few hundred names.
  const seen = new Set<string>();
  const observer = new Observer((list) => {
    for (const entry of list.getEntries()) {
      if (!entry.name.startsWith(OWN_MEASURE_PREFIX)) seen.add(entry.name);
    }
  });
  try {
    observer.observe({ type: "measure", buffered: true });
  } catch {
    return () => {};
  }
  const trim = () => {
    for (const name of seen) buffer.clearMeasures(name);
    seen.clear();
  };
  const handle = scheduler.setInterval(trim, options.intervalMs ?? REACT_DEV_MEASURE_TRIM_MS);
  return () => {
    scheduler.clearInterval(handle);
    observer.disconnect();
    trim();
  };
}

/** Coalesce a burst without moving the deadline on every token. Latest state is read at flush time. */
export function createCompanionBatch(publish: () => void, delay = 250) {
  let timer: ReturnType<typeof setTimeout> | undefined, disposed = false;
  const flush = () => { clearTimeout(timer); timer = undefined; if (!disposed) publish(); };
  return {
    request(urgent = false) { if (disposed) return; if (urgent) flush(); else if (!timer) timer = setTimeout(flush, delay); },
    dispose() { disposed = true; clearTimeout(timer); timer = undefined; },
  };
}

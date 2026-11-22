import { resolve } from "node:path";

/**
 * One queue per key for read-modify-write of a shared file (an `index.json`). Without it, two
 * requests read the same version and the second write drops the first one's change. Callers must
 * never nest two operations on the same key: the inner one would wait for the outer forever.
 */
const queues = new Map<string, Promise<unknown>>();

export function withFileLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const current = previous.then(work, work);
  const settled = current.then(() => undefined, () => undefined);
  queues.set(key, settled);
  void settled.then(() => { if (queues.get(key) === settled) queues.delete(key); });
  return current;
}

/** The lock key of a project data family (`fuentes`, `salidas`, `artefactos`). */
export const familyLock = (directory: string, family: string) => `${resolve(directory)}\u0000${family}`;

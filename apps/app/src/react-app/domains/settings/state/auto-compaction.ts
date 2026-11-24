/**
 * Auto compaction is on unless a configuration explicitly turns it off.
 * OpenCode v2 uses the same default; the app must not send `auto: false` just
 * because a workspace has no `compaction` block yet.
 */
export function autoCompactionEnabled(compaction: unknown): boolean {
  if (typeof compaction !== "object" || compaction === null || !("auto" in compaction)) return true;
  return Reflect.get(compaction, "auto") !== false;
}

import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

// `session-pins.v1.json` and its backup. Same limits as pins() below.
const sessionPinsFileSchema = z.object({
  version: z.literal(1),
  pinnedIds: z.array(z.string().min(1).max(512)).max(100_000),
});

function pins(value) {
  if (!Array.isArray(value) || value.length > 100_000 || value.some(id => typeof id !== "string" || !id || id.length > 512)) {
    throw new Error("Invalid session pins");
  }
  return [...new Set(value)];
}

/** Small, profile-local journal. No session content or engine access. */
export function createSessionPins(directory) {
  const file = path.join(directory, "session-pins.v1.json");
  const backup = `${file}.backup`;
  function read() {
    let failed = false;
    for (const candidate of [file, backup]) {
      try {
        const value = sessionPinsFileSchema.parse(JSON.parse(readFileSync(candidate, "utf8")));
        return [...new Set(value.pinnedIds)];
      } catch (error) {
        if (error?.code !== "ENOENT") failed = true;
      }
    }
    // Never turn an unreadable/corrupt journal into an apparently empty one.
    if (failed) throw new Error("Session pins could not be recovered");
    return null;
  }
  function atomicWrite(destination, value) {
    const temporary = `${destination}.tmp`;
    const fd = openSync(temporary, "w", 0o600);
    try { writeFileSync(fd, value, "utf8"); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, destination);
    // Windows does not expose directory fsync through Node. File contents are
    // still flushed before atomic replacement, which survives process death.
    if (process.platform !== "win32") {
      const dir = openSync(directory, "r");
      try { fsyncSync(dir); } finally { closeSync(dir); }
    }
  }
  function save(value) {
    const encoded = JSON.stringify({ version: 1, pinnedIds: value });
    // Both contain the latest acknowledged state. The backup also recovers a
    // malformed primary; an interrupted, unacknowledged write may recover old or new.
    atomicWrite(backup, encoded);
    atomicWrite(file, encoded);
    return value;
  }
  return {
    read,
    update({ previous, next }) {
      const before = pins(previous);
      const after = pins(next);
      const current = read();
      if (current === null) return save(after);
      const removed = new Set(before.filter(id => !after.includes(id)));
      const added = after.filter(id => !before.includes(id));
      const retained = current.filter(id => !removed.has(id));
      // Apply intent, never a stale whole-renderer snapshot. Missing inventory
      // and unrelated sidebar writes cannot remove another renderer's pins.
      const combined = [...new Set([...retained, ...added])];
      const ordered = [...after.filter(id => combined.includes(id)), ...combined.filter(id => !after.includes(id))];
      return JSON.stringify(current) === JSON.stringify(ordered) && existsSync(file) ? current : save(ordered);
    },
  };
}

export function registerSessionPins({ ipcMain, directory, isTrusted }) {
  const journal = createSessionPins(directory);
  for (const { channel, operation } of [
    { channel: "openwork:session-pins:read", operation: () => journal.read() },
    { channel: "openwork:session-pins:update", operation: payload => journal.update(payload) },
  ]) {
    ipcMain.on(channel, (event, payload) => {
      try {
        if (!isTrusted(event)) throw new Error("Untrusted session pin request");
        event.returnValue = { ok: true, pins: operation(payload) };
      } catch {
        // Fixed error only, no paths, raw state or session identifiers in logs.
        event.returnValue = { ok: false, error: "Session pins could not be saved or recovered" };
      }
    });
  }
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { recoverJournal, parseRecoveryJournal } from "../src/recover-journal.js";
import { createWorkspaceKvStore } from "../src/workspace-kv-store.js";
import type { ServerConfig } from "../src/types.js";

test("invalid and newer records are separated without losing compatible siblings", () => {
  assert.deepEqual(parseRecoveryJournal('[{"id":"a"},{"id":7},{"id":"b"}]', z.object({ id: z.string() })), { records: [{ id: "a" }, { id: "b" }], rejected: 1 });
  assert.deepEqual(parseRecoveryJournal('malformed fixture', z.object({ id: z.string() })), { records: [], rejected: 1 });
  assert.deepEqual(parseRecoveryJournal('[1,2,3]', z.number(), 2), { records: [1, 2], rejected: 1 });
});
test("the exact original is quarantined privately before compatible entries may replace it", async () => {
  const root = await mkdtemp(join(tmpdir(), "journal-recovery-"));
  const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "fixture", hostToken: "fixture", approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [], authorizedRoots: [], readOnly: false, startedAt: 0, tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false, configPath: join(root, "server.json") };
  const raw = '[{"id":"a"},{"future":true}]';
  try {
    const records = await recoverJournal(config, "test", raw, z.object({ id: z.string() }));
    assert.equal(records.length, 1);
    const { createHash } = await import("node:crypto");
    const quarantine = createWorkspaceKvStore<string>({ tableName: "recovery_quarantine", valueColumn: "raw_json", parse: value => value, serialize: value => value });
    assert.equal(await quarantine.get(config, `test:${createHash("sha256").update(raw).digest("hex")}`), raw);
  } finally { await rm(root, { recursive: true, force: true }); }
});

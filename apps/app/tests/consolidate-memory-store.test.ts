import { test } from "node:test";
import assert from "node:assert/strict";
import { useConsolidateMemoryStore } from "../src/react-app/domains/session/comex/consolidate-memory-store";

test("consolidate memory store opens and closes", () => {
  const store = useConsolidateMemoryStore.getState();
  store.close();
  assert.equal(store.open, false);
  store.openFor("ws_1", "ses_1");
  const after = useConsolidateMemoryStore.getState();
  assert.equal(after.open, true);
  assert.equal(after.workspaceId, "ws_1");
  assert.equal(after.sessionId, "ses_1");
  after.close();
  const closed = useConsolidateMemoryStore.getState();
  assert.equal(closed.open, false);
  assert.equal(closed.workspaceId, null);
  assert.equal(closed.sessionId, null);
});
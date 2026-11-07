import assert from "node:assert/strict";
import { test } from "node:test";
import { useSessionActivityStore } from "../src/react-app/domains/session/status/session-activity-store";
import { resourceScope, useWorkspaceResources } from "../src/react-app/domains/session/chat/workspace-resource-store";

test("only a confirmed compaction end records completion", () => {
  const store = useSessionActivityStore.getState();
  store.setCompacting("feedback-test", "chat", true);
  assert.equal(useSessionActivityStore.getState().recordsByWorkspaceId["feedback-test"]?.chat?.status, "compacting");
  store.setCompacting("feedback-test", "chat", false);
  assert.equal(useSessionActivityStore.getState().recordsByWorkspaceId["feedback-test"]?.chat?.lastCompactedAt, undefined);
  store.setCompacting("feedback-test", "chat", false, true);
  const receipt = useSessionActivityStore.getState().recordsByWorkspaceId["feedback-test"]?.chat?.lastCompactedAt;
  assert.ok(receipt && receipt <= Date.now());
  assert.equal(useSessionActivityStore.getState().recordsByWorkspaceId["feedback-test"]?.other?.lastCompactedAt, undefined);
  store.removeSession("feedback-test", "chat");
  assert.equal(useSessionActivityStore.getState().recordsByWorkspaceId["feedback-test"]?.chat, undefined);
});

test("agent tabs preserve the parent and select children without opening duplicate tabs", () => {
  useWorkspaceResources.setState({ workspaces: {} });
  const store = useWorkspaceResources.getState();
  const scope = resourceScope("http://localhost:1", "workspace", "account");
  const first = store.open(scope, "agents", "child-a", "parent");
  assert.equal(store.open(scope, "agents", "child-b", "parent"), first);
  const tab = useWorkspaceResources.getState().workspaces[scope]?.tabs[0];
  assert.equal(tab?.title, "Subagentes");
  assert.equal(tab?.path, "child-b");
  assert.equal(tab?.ownerSessionId, "parent");
  assert.notEqual(store.open(scope, "agents", undefined, "other-parent"), first);
  assert.equal(store.open(scope, "agents", undefined, "parent"), first);
  assert.equal(useWorkspaceResources.getState().workspaces[scope]?.tabs.find(item => item.id === first)?.path, undefined);
});

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { resourceAddress, resourcePagePath, resourceScope, useWorkspaceResources } from "../src/react-app/domains/session/chat/workspace-resource-store";

beforeEach(() => useWorkspaceResources.setState({ workspaces: {} }));

test("project and account switches never expose another scope's tabs or drafts", () => {
  const a = resourceScope("http://localhost:1", "workspace", "account-a");
  const b = resourceScope("http://localhost:1", "workspace", "account-b");
  const c = resourceScope("http://localhost:1", "another-workspace", "account-a");
  const store = useWorkspaceResources.getState();
  const id = store.open(a, "page");
  store.update(a, id, { draft: "Private draft" });
  store.open(b, "new");
  assert.equal(useWorkspaceResources.getState().workspaces[a]?.tabs[0]?.draft, "Private draft");
  assert.ok(!useWorkspaceResources.getState().workspaces[b]?.tabs.some(tab => tab.id === id));
  assert.equal(useWorkspaceResources.getState().workspaces[c], undefined);
});

test("same-named files in worktrees retain distinct conversation identities", () => {
  const store = useWorkspaceResources.getState();
  const root = store.open("scope", "artifact", "notes.md", "one", "workspace");
  const child = store.open("scope", "artifact", "notes.md", "one", "conversation");
  const other = store.open("scope", "artifact", "notes.md", "two", "conversation");
  assert.notEqual(root, child);
  assert.notEqual(child, other);
  assert.equal(store.open("scope", "artifact", "notes.md", "one", "conversation"), child);
  assert.equal(useWorkspaceResources.getState().workspaces.scope?.tabs.length, 3);
});

test("closing an inactive tool preserves the selected page and its draft", () => {
  const store = useWorkspaceResources.getState();
  const a = store.open("scope", "new");
  const b = store.open("scope", "page");
  store.update("scope", b, { draft: "Still editing" });
  store.close("scope", a);
  assert.equal(useWorkspaceResources.getState().workspaces.scope?.activeId, b);
  assert.equal(useWorkspaceResources.getState().workspaces.scope?.tabs[0]?.draft, "Still editing");
  store.select("scope", null);
  assert.equal(useWorkspaceResources.getState().workspaces.scope?.tabs[0]?.draft, "Still editing");
});

test("address entry distinguishes web navigation from script and local-file schemes", () => {
  assert.equal(resourceAddress("localhost:5178"), "http://localhost:5178/");
  assert.equal(resourceAddress("example.com/notes"), "https://example.com/notes");
  assert.equal(resourceAddress("research notes"), "https://www.google.com/search?q=research%20notes");
  for (const url of ["javascript:alert(1)", "data:text/html,test", "file:///etc/passwd", ""]) assert.equal(resourceAddress(url), null);
});

test("page names stay relative to the owning workspace", () => {
  assert.equal(resourcePagePath("paginas/Notas"), "paginas/Notas.md");
  assert.equal(resourcePagePath("paginas/Notas.md"), "paginas/Notas.md");
  for (const path of ["../notes.md", "/tmp/notes.md", "pages/../../notes", "C:\\notes.md", ""]) assert.equal(resourcePagePath(path), null);
});

test("sources reuse their conversation tab and remain separate between chats", () => {
  const store = useWorkspaceResources.getState();
  const scope = resourceScope("http://localhost:1", "workspace", "account");
  const first = store.open(scope, "sources", undefined, "chat-a");
  assert.equal(store.open(scope, "sources", undefined, "chat-a"), first);
  const second = store.open(scope, "sources", undefined, "chat-b");
  assert.notEqual(first, second);
  const tabs = useWorkspaceResources.getState().workspaces[scope]?.tabs;
  assert.equal(tabs?.length, 2);
  assert.equal(tabs?.[0]?.title, "Fuentes");
  assert.equal(tabs?.[1]?.ownerSessionId, "chat-b");
  store.close(scope, second);
  assert.equal(useWorkspaceResources.getState().workspaces[scope]?.activeId, first);
});

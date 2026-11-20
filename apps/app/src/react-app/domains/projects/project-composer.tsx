/** @jsxImportSource react */
import { useState } from "react";

import { NewTaskComposer, type NewTaskComposerContext, type NewTaskComposerProps } from "@/react-app/domains/session/chat/new-task-composer";
import { useComposerStateStore } from "@/react-app/domains/session/surface/composer-state-store";

/**
 * "Nueva sesión en <proyecto>": the app's own new-session composer (model picker and permission
 * mode included), fixed to the project's workspace. Sending creates the session there and opens it.
 * Its draft has its own owner, so it never overwrites the workspace's regular new-session draft.
 */
export function ProjectComposer({ workspaceId, context, onRunTask }: { workspaceId: string; context: NewTaskComposerContext; onRunTask: NewTaskComposerProps["onRunTask"] }) {
  const owner = `project-page:${workspaceId}`;
  const [draft, setDraft] = useState(() => useComposerStateStore.getState().sessions[owner]?.draft ?? "");
  // No destination menu: the project is the destination.
  return <NewTaskComposer flush draft={draft} onDraftChange={setDraft} onRunTask={onRunTask} busy={false}
    context={{ ...context, workspaceOptions: undefined, draftOwnerKey: owner, draftSessionId: owner, destination: { workspaceId } }} />;
}

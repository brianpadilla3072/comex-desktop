/** @jsxImportSource react */
import { useState } from "react";

import { NewTaskComposer, type NewTaskComposerContext } from "@/react-app/domains/session/chat/new-task-composer";
import { useComposerStateStore } from "@/react-app/domains/session/surface/composer-state-store";

/**
 * The first message of a design's chat: the app's own new-session composer (model picker and
 * permission mode included), fixed to the design's project. Its draft has its own owner per
 * design, so it never overwrites the workspace's regular new-session draft.
 */
export function DesignChatStarter({ workspaceId, designId, context, busy, onStart }: {
  workspaceId: string;
  designId: string;
  context: NewTaskComposerContext;
  busy: boolean;
  onStart: (prompt: string) => void;
}) {
  const owner = `design-chat:${workspaceId}:${designId}`;
  const [draft, setDraft] = useState(() => useComposerStateStore.getState().sessions[owner]?.draft ?? "");
  return <NewTaskComposer flush draft={draft} onDraftChange={setDraft} busy={busy}
    onRunTask={prompt => { if (prompt.trim()) onStart(prompt); }}
    context={{ ...context, workspaceOptions: undefined, draftOwnerKey: owner, draftSessionId: owner, destination: { workspaceId } }} />;
}

import { createContext, useContext } from "react";

// Answers "which chat's side panel shows items from this chat". Outside a
// session page it is the chat itself.
const PanelSessionContext = createContext<(chatSessionId: string) => string>((chatSessionId) => chatSessionId);

export const PanelSessionProvider = PanelSessionContext.Provider;

export function usePanelSessionFor(chatSessionId: string): string {
  return useContext(PanelSessionContext)(chatSessionId);
}

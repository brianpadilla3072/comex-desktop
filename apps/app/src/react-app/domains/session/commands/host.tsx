import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
import type { ArchiveSessionOutcome } from "../sidebar/use-session-archive";
const Host = createContext<{ archive: (sessionId: string) => Promise<ArchiveSessionOutcome> } | null>(null);
export function ChatCommandHost({ archive, children }: { archive: (sessionId: string) => Promise<ArchiveSessionOutcome>; children: ReactNode }) { const current = useRef(archive); current.current = archive; const value = useMemo(() => ({ archive: (id: string) => current.current(id) }), []); return <Host.Provider value={value}>{children}</Host.Provider>; }
export function useChatCommandHost() { return useContext(Host); }

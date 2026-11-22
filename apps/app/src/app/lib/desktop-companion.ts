import type { CompanionCommand, CompanionPreferences, CompanionRecentSession, CompanionResult, CompanionSnapshot, CompanionState } from "@openwork/types/desktop-companion";

declare global {
  interface Window {
    __OPENWORK_COMPANION_HOST__?: {
      state: () => Promise<{ enabled: boolean; expanded?: boolean }>;
      onView: (callback: (expanded: boolean) => void) => () => void;
      onEnabled?: (callback: (enabled: boolean) => void) => () => void;
      publish: (snapshot: CompanionSnapshot) => void;
      clear: (target: string) => void;
      onCommand: (callback: (command: CompanionCommand) => void) => () => void;
      reply: (id: string, result: CompanionResult) => void;
      recentSessions: (sessions: CompanionRecentSession[]) => void;
      onSelectSession: (callback: (key: string) => void) => () => void;
      onReadSession: (callback: (key: string, responseAt: number) => void) => () => void;
    };
    __OPENWORK_COMPANION__?: {
      state: () => Promise<CompanionState | null>;
      onState: (callback: (state: Partial<CompanionState>) => void) => () => void;
      view: (value: { expanded?: boolean; height?: number; focus?: boolean }) => Promise<boolean>;
      command: (value: CompanionCommand) => Promise<CompanionResult>;
      openMain: () => Promise<boolean>;
      preferences: (value: CompanionPreferences) => Promise<boolean>;
      selectSession: (key: string) => Promise<boolean>;
      readSession: (key: string) => Promise<boolean>;
    };
  }
}

export type { CompanionAction, CompanionCommand, CompanionFile, CompanionPreferences, CompanionRecentSession, CompanionResult, CompanionSnapshot, CompanionState } from "@openwork/types/desktop-companion";

import type { CompanionCommand, CompanionPreferences, CompanionResult, CompanionSnapshot, CompanionState } from "@openwork/types/desktop-companion";

declare global {
  interface Window {
    __OPENWORK_COMPANION_HOST__?: {
      state: () => Promise<{ enabled: boolean }>;
      publish: (snapshot: CompanionSnapshot) => void;
      clear: (target: string) => void;
      onCommand: (callback: (command: CompanionCommand) => void) => () => void;
      reply: (id: string, result: CompanionResult) => void;
    };
    __OPENWORK_COMPANION__?: {
      state: () => Promise<CompanionState | null>;
      onState: (callback: (state: CompanionState) => void) => () => void;
      view: (value: { expanded: boolean; height?: number; focus?: boolean }) => Promise<boolean>;
      command: (value: CompanionCommand) => Promise<CompanionResult>;
      openMain: () => Promise<boolean>;
      preferences: (value: CompanionPreferences) => Promise<boolean>;
    };
  }
}

export type { CompanionAction, CompanionCommand, CompanionFile, CompanionPreferences, CompanionResult, CompanionSnapshot, CompanionState } from "@openwork/types/desktop-companion";

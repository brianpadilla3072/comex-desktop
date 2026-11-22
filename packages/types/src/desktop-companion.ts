/** Bounded, credential-free view of one existing conversation. No engine credentials cross this bridge. */
export type CompanionSnapshot = {
  target: string;
  sessionId: string;
  workspaceId?: string;
  scope?: string;
  responseAt?: number;
  title: string;
  project: string;
  model: string;
  state: "idle" | "working" | "waiting" | "offline" | "error";
  canSend: boolean;
  messages: { id: string; role: string; text: string }[];
  activity: string[];
  permission: { id: string; title: string; detail: string; busy: boolean } | null;
  question: { id: string; busy: boolean; questions: { text: string; multiple: boolean; custom: boolean; options: string[] }[] } | null;
};

export type CompanionFile = { name: string; type: string; data: string };
export type CompanionAction =
  | { kind: "send"; text: string; files: CompanionFile[] }
  | { kind: "stop" }
  | { kind: "permission"; requestId: string; reply: "once" | "reject" }
  | { kind: "question"; requestId: string; answers: string[][] | null };
export type CompanionCommand = { id: string; target: string; action: CompanionAction };
export type CompanionResult = { ok: boolean; error?: string; uncertain?: boolean };
export type CompanionPreferences = { mascot: "sprout" | "ember" | "image"; image: string; motion: boolean; openOnHover: boolean; autoClose: number; alerts: boolean };
export type CompanionRecentSession = {
  key: string;
  workspaceId: string;
  sessionId: string;
  title: string;
  status: "idle" | "waiting" | "unread";
  selected: boolean;
  responseAt: number;
  readAt: number;
};
export type CompanionState = { enabled: boolean; visible?: boolean; connected: boolean; expanded: boolean; snapshot: CompanionSnapshot | null; preferences: CompanionPreferences; updatedAt: number; recentSessions: CompanionRecentSession[]; recentsUpdatedAt: number };

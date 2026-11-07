import { Archive, GitFork, Minimize2, Share2, PenLine, Activity, Pin, FileText, Columns2, Plug, Cat, type LucideIcon } from "lucide-react";
import type { ChatCommandId } from "./catalog";
export const CHAT_COMMAND_ICONS: Record<ChatCommandId, LucideIcon> = { archive: Archive, fork: GitFork, compact: Minimize2, share: Share2, draw: PenLine, status: Activity, pin: Pin, init: FileText, side: Columns2, mcp: Plug, pet: Cat };

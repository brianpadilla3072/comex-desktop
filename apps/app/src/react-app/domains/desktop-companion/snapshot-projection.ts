import type { UIMessage } from "ai";
import type { CompanionSnapshot } from "@/app/lib/desktop-companion";
import { assistantResponseTime } from "../session/status/session-activity-store";

export function latestCompanionResponseTime(messages: UIMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) { const at = assistantResponseTime(messages[i]); if (at > 0) return at; }
  return 0;
}

/** Walk backwards and stop at the transport limits, without joining a whole large answer first. */
export function companionMessages(messages: UIMessage[]): CompanionSnapshot["messages"] {
  const result: CompanionSnapshot["messages"] = [];
  for (let i = messages.length - 1; i >= 0 && result.length < 8; i--) {
    const message = messages[i]; if (message.role !== "user" && message.role !== "assistant") continue;
    let text = "";
    for (let j = message.parts.length - 1; j >= 0; j--) {
      const part = message.parts[j]; if (part.type !== "text") continue;
      const remaining = 6000 - text.length - (text ? 1 : 0); if (remaining <= 0) break;
      text = part.text.slice(-remaining) + (text ? "\n" + text : "");
    }
    result.unshift({ id: message.id, role: message.role, text });
  }
  return result;
}

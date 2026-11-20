import { OpenworkServerError } from "@/app/lib/openwork-server";

export const WORKSPACE_SERVER_UNAVAILABLE_MESSAGE =
  "OpenWork server is unavailable. Start or reconnect the server before creating a workspace.";

/**
 * The error to show when creating a local workspace failed. A real server
 * response (for example, the project belongs to another application) reaches
 * the person as is. Network failures, timeouts and non-JSON replies mean the
 * server is unreachable, so they get the generic message.
 */
export function workspaceCreateError(failure: unknown): Error {
  if (failure instanceof OpenworkServerError && failure.message.trim()) return failure;
  return new Error(WORKSPACE_SERVER_UNAVAILABLE_MESSAGE);
}

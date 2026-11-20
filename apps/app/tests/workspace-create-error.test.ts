import { expect, test } from "bun:test";

import { OpenworkServerError } from "../src/app/lib/openwork-server";
import { WORKSPACE_SERVER_UNAVAILABLE_MESSAGE, workspaceCreateError } from "../src/react-app/shell/workspace-create-error";

// Creating a workspace used to say "server unavailable" for every failure,
// hiding real answers such as "this project belongs to another application".
test("a real server answer reaches the person unchanged", () => {
  const answer = new OpenworkServerError(409, "project_already_bound", "Este proyecto pertenece a otra aplicación.");
  expect(workspaceCreateError(answer)).toBe(answer);
  const invalid = new OpenworkServerError(422, "invalid_specialist_pack", "La carpeta .opencode del proyecto no es válida.");
  expect(workspaceCreateError(invalid).message).toBe("La carpeta .opencode del proyecto no es válida.");
});

// The opposite regression: once real answers were shown, a dropped connection
// surfaced the browser's raw "Failed to fetch" instead of the friendly message.
test("network failures, timeouts and unreadable replies keep the server-unavailable message", () => {
  for (const failure of [
    new TypeError("Failed to fetch"),
    new Error("Request timed out after 30000ms"),
    new SyntaxError("Unexpected token '<', \"<html>\" is not valid JSON"),
    new OpenworkServerError(502, "request_failed", "  "),
    null,
    "boom",
  ]) {
    expect(workspaceCreateError(failure).message).toBe(WORKSPACE_SERVER_UNAVAILABLE_MESSAGE);
  }
});

import { expect, test } from "bun:test";
import type { UIMessage } from "ai";
import { abortedMarker, resolveAdmissionOutcome } from "../src/react-app/domains/session/surface/session-admission-outcome";

// Hive QA (w2-6, w5-7): stopping a run on purpose showed "No se pudo confirmar si esto terminó",
// a recovery card meant for runs whose outcome is unknown.
const user: UIMessage = { id: "msg_user", role: "user", parts: [{ type: "text", text: "Hola" }], metadata: { opencode: { created: 1 } } };
const base = { statusType: "idle", sending: false, hasActiveQuestion: false, hasActivePermission: false, hasSessionError: false } as const;

test("an unanswered message is still unresolved", () => {
  expect(resolveAdmissionOutcome({ ...base, messages: [user] })).toBe("unresolved");
});

test("a reply the person stopped settles the admission, also after a reload", () => {
  const stopped: UIMessage = { id: "msg_reply", role: "assistant", parts: [], metadata: { opencode: { parentID: "msg_user", ...abortedMarker({ error: { name: "MessageAbortedError" } }) } } };
  expect(resolveAdmissionOutcome({ ...base, messages: [user, stopped] })).toBe("settled");
  const otherError: UIMessage = { id: "msg_reply", role: "assistant", parts: [], metadata: { opencode: { parentID: "msg_user", ...abortedMarker({ error: { name: "APIError" } }) } } };
  expect(resolveAdmissionOutcome({ ...base, messages: [user, otherError] })).toBe("unresolved");
  expect(abortedMarker({})).toEqual({});
});

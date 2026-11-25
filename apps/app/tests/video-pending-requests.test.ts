/**
 * A request sent from the video panel has no project until the agent creates
 * `video-projects/<slug>/`. These tests keep the reminder of that request (and
 * the conversation working on it) from being lost.
 */
import { afterAll, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const ownsDom = !GlobalRegistrator.isRegistered;
if (ownsDom) GlobalRegistrator.register({ url: "http://localhost/" });

const {
  listPendingVideoRequests,
  addPendingVideoRequest,
  removePendingVideoRequest,
  prunePendingVideoRequests,
} = await import("../src/react-app/domains/video/video-pending-requests");

beforeEach(() => {
  localStorage.clear();
});

afterAll(async () => {
  if (ownsDom) await GlobalRegistrator.unregister();
});

test("guarda el pedido y lo devuelve del más nuevo al más viejo", () => {
  addPendingVideoRequest({ sessionId: "ses_a", idea: "gatos", at: 1 });
  addPendingVideoRequest({ sessionId: "ses_b", idea: "meteoritos", at: 2 });
  expect(listPendingVideoRequests().map((entry) => entry.sessionId)).toEqual(["ses_b", "ses_a"]);
});

test("el mismo pedido no se duplica si se vuelve a abrir", () => {
  addPendingVideoRequest({ sessionId: "ses_a", idea: "gatos", at: 1 });
  addPendingVideoRequest({ sessionId: "ses_a", idea: "gatos y perros", at: 2 });
  const entries = listPendingVideoRequests();
  expect(entries).toHaveLength(1);
  expect(entries[0]?.idea).toBe("gatos y perros");
});

test("descartar quita sólo ese pedido", () => {
  addPendingVideoRequest({ sessionId: "ses_a", idea: "gatos", at: 1 });
  addPendingVideoRequest({ sessionId: "ses_b", idea: "meteoritos", at: 2 });
  expect(removePendingVideoRequest("ses_a").map((entry) => entry.sessionId)).toEqual(["ses_b"]);
});

test("cuando el proyecto ya existe, el pedido deja de ofrecerse", () => {
  addPendingVideoRequest({ sessionId: "ses_a", idea: "gatos", at: 1 });
  addPendingVideoRequest({ sessionId: "ses_b", idea: "meteoritos", at: 2 });
  const left = prunePendingVideoRequests(["ses_a"]);
  expect(left.map((entry) => entry.sessionId)).toEqual(["ses_b"]);
});

test("sin proyectos conocidos no se pierde ningún pedido", () => {
  addPendingVideoRequest({ sessionId: "ses_a", idea: "gatos", at: 1 });
  expect(prunePendingVideoRequests([])).toHaveLength(1);
});

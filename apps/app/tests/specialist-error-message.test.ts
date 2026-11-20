import { expect, test } from "bun:test";

import { OpenworkServerError } from "../src/app/lib/openwork-server";
import { SPECIALIST_DESKTOP_ONLY_MESSAGE, specialistErrorMessage } from "../src/react-app/domains/specialists/error-message";

// From the browser, every specialist write answered with the server's raw
// English "Invalid host token", which tells the person nothing.
test("a missing desktop privilege becomes a clear Spanish message", () => {
  const denied = new OpenworkServerError(401, "unauthorized", "Invalid host token");
  expect(specialistErrorMessage(denied, "No se pudo guardar.")).toBe(SPECIALIST_DESKTOP_ONLY_MESSAGE);
});

test("other server answers and local errors keep their own message, with the fallback for empty ones", () => {
  expect(specialistErrorMessage(new OpenworkServerError(409, "project_already_bound", "Ese proyecto pertenece a otra aplicación."), "x")).toBe("Ese proyecto pertenece a otra aplicación.");
  expect(specialistErrorMessage(new Error("Algo concreto"), "x")).toBe("Algo concreto");
  expect(specialistErrorMessage(new Error("  "), "No se pudo crear.")).toBe("No se pudo crear.");
  expect(specialistErrorMessage("boom", "No se pudo crear.")).toBe("No se pudo crear.");
});

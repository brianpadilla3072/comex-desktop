import { afterEach, expect, test } from "bun:test";

import { setLocale } from "../src/i18n";
import { presentOpencodeSessionError } from "../src/react-app/domains/session/sync/session-error";

// Hive QA (w2-4, w5-8): session error cards were hard-coded English inside the Spanish UI.
afterEach(() => { setLocale("en"); });

const rateLimited = { name: "APIError", data: { message: "Too many requests", statusCode: 429 } };

test("session error cards follow the selected language", () => {
  setLocale("en");
  const english = presentOpencodeSessionError(rateLimited);
  expect(english.kind).toBe("rate-limited");
  expect(english.title).toBe("This model is receiving too many requests");
  setLocale("es");
  const spanish = presentOpencodeSessionError(rateLimited);
  expect(spanish.title).toBe("Este modelo está recibiendo demasiadas solicitudes");
  expect(spanish.description).toBe("Espera un momento y vuelve a intentarlo, o elige otro modelo.");
});

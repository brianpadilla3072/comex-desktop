import { expect, test } from "bun:test";

import en from "../src/i18n/locales/en";
import es from "../src/i18n/locales/es";

const enEntries: Record<string, string> = en;
const esEntries: Record<string, string> = es;

// Keys that intentionally have no Spanish entry and fall back to English.
// Keep this list small and explain every entry.
const ENGLISH_ONLY = new Set([
  // Sent to the model, not shown to people: the tool names and wording stay in
  // English so the instruction behaves the same in every locale.
  "composer.connect_skill_prompt",
]);

test("every English key has a Spanish translation", () => {
  const missing = Object.keys(enEntries).filter((key) => !ENGLISH_ONLY.has(key) && !(key in esEntries));
  expect(missing).toEqual([]);
});

test("the English-only allowlist only names real keys that Spanish leaves out", () => {
  for (const key of ENGLISH_ONLY) {
    expect(key in enEntries).toBe(true);
    expect(key in esEntries).toBe(false);
  }
});

test("Spanish uses tú, never voseo", () => {
  // Letter-aware boundaries: `\b` treats accented letters as non-word characters,
  // so it would flag "Conectándote" as "conectá".
  const voseo = /(?<!\p{L})(tenés|podés|querés|sabés|hacé|revisá|elegí|probá|volvé|escribí|pegá|usá|decí|mirá|conectá|seleccioná|agregá|creá|guardá)(?!\p{L})/iu;
  const offenders = Object.entries(esEntries).filter(([, value]) => voseo.test(value)).map(([key]) => key);
  expect(offenders).toEqual([]);
});

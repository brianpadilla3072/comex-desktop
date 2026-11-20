import { expect, test } from "bun:test";

import en from "../src/i18n/locales/en";
import es from "../src/i18n/locales/es";

// Any `{...}`, so a mangled placeholder such as "{entorno de ejecuciónWorkspaceId}" is caught too.
const placeholders = (value: string) => [...value.matchAll(/\{[^{}]*\}/g)].map((match) => match[0]).sort();
const enEntries: Record<string, string> = en;
const esEntries: Record<string, string> = es;

// The composer, model picker, sidebar and status bar showed English labels
// ("Select model", "Model no longer available", "Retry", "Workspaces") inside
// a Spanish app. These sections must stay fully translated.
const MAIN_SURFACES = ["composer", "models", "model_picker", "model_behavior", "workspace_list", "workspace", "common", "dashboard", "app", "status", "settings", "session", "session_management"];
// Sent to the model, not shown to people: stays in English on purpose.
const MODEL_FACING = new Set(["composer.connect_skill_prompt"]);

test("every key of the main surfaces has a Spanish translation", () => {
  const missing = Object.keys(enEntries).filter((key) => MAIN_SURFACES.includes(key.split(".")[0] ?? "") && !MODEL_FACING.has(key) && !(key in esEntries));
  expect(missing).toEqual([]);
});

test("Spanish strings keep the English placeholders and never add unknown keys", () => {
  const unknown = Object.keys(esEntries).filter((key) => !(key in enEntries));
  expect(unknown).toEqual([]);
  const mismatched = Object.keys(esEntries).filter((key) => placeholders(esEntries[key] ?? "").join() !== placeholders(enEntries[key] ?? "").join());
  expect(mismatched).toEqual([]);
});

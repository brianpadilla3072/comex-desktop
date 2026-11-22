import { expect, test } from "bun:test";

import type { ModelOption } from "../src/app/types";
import { currentLocale, setLocale } from "../src/i18n";
import { MODEL_GROUP_IDS, modelGroupLabel, modelGroups } from "../src/react-app/domains/models/model-catalog";

function option(providerID: string, modelID: string, description: string): ModelOption {
  return { providerID, modelID, title: modelID, description, behaviorTitle: "Effort", behaviorLabel: "Default", behaviorDescription: "", behaviorValue: null, isFree: false };
}

const options = [option("anthropic", "opus", "Anthropic"), option("anthropic", "sonnet", "Anthropic"), option("openai", "gpt", "OpenAI")];
const names = (groups: ReturnType<typeof modelGroups>) => Object.fromEntries(groups.map((group) => [group.value, group.items.map((item) => item.modelID)]));

test("a recent model still shows under its provider", () => {
  expect(names(modelGroups(options, [], [{ providerID: "anthropic", modelID: "opus" }]))).toEqual({
    recent: ["opus"],
    Anthropic: ["opus", "sonnet"],
    OpenAI: ["gpt"],
  });
});

test("a pinned model is listed once, in Pinned, and not repeated in Recent", () => {
  const pinned = { providerID: "anthropic", modelID: "opus" };
  expect(names(modelGroups(options, [pinned], [pinned]))).toEqual({
    pinned: ["opus"],
    Anthropic: ["sonnet"],
    OpenAI: ["gpt"],
  });
});

test("group ids stay stable while their labels follow the language", () => {
  const previous = currentLocale();
  setLocale("es");
  try {
    const pinned = { providerID: "anthropic", modelID: "opus" };
    const groups = modelGroups(options, [pinned], [{ providerID: "openai", modelID: "gpt" }]);
    expect(groups.map((group) => group.value)).toEqual([MODEL_GROUP_IDS.pinned, MODEL_GROUP_IDS.recent, "Anthropic", "OpenAI"]);
    expect(groups.map((group) => modelGroupLabel(group.value))).toEqual(["Fijados", "Recientes", "Anthropic", "OpenAI"]);
  } finally {
    setLocale(previous);
  }
  expect(modelGroupLabel(MODEL_GROUP_IDS.pinned)).toBe("Pinned");
});

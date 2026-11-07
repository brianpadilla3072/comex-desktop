import type { GuideSnapshot } from "@openwork/types/model-guide";
import type { ModelGroup } from "./model-catalog";

const PERSONAL_GROUPS = new Set(["Pinned", "Recent", "Smart", "OpenWork Models", "Saved selection", "Search results"]);

/** Stable partition within each billing/provider group. Never override pins, recents or search relevance. */
export function prioritizeAssessedModels(groups: readonly ModelGroup[], snapshot?: GuideSnapshot): ModelGroup[] {
  if (!snapshot) return [...groups];
  const assessed = new Set(snapshot.catalog.models.filter(model => model.reasoning).map(model => JSON.stringify([model.providerID, model.modelID])));
  const estimated = new Set(snapshot.catalog.models.filter(model => model.reasoningEstimate).map(model => JSON.stringify([model.providerID, model.modelID])));
  return groups.map(group => {
    if (PERSONAL_GROUPS.has(group.value)) return group;
    const known: ModelGroup["items"] = []; const approximate: ModelGroup["items"] = []; const unknown: ModelGroup["items"] = [];
    for (const model of group.items) {
      const key = JSON.stringify([model.providerID, model.modelID]);
      (assessed.has(key) ? known : estimated.has(key) ? approximate : unknown).push(model);
    }
    return { ...group, items: [...known, ...approximate, ...unknown] };
  });
}

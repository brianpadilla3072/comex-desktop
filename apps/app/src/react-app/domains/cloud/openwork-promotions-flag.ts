// Fail closed until the authenticated server returns an explicit true.
// Local storage and old shell preferences cannot turn operator-disabled ads on.
export const openWorkModelsPromoChangedEvent = "openwork-openwork-models-promo-changed";
let enabled = false;
const listeners = new Set<() => void>();
export const getOpenworkPromotionsEnabled = () => enabled;
export function setOpenworkPromotionsEnabled(value: boolean): void {
  if (enabled === value) return;
  enabled = value;
  for (const listener of listeners) listener();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(openWorkModelsPromoChangedEvent));
}
export function subscribeOpenworkPromotions(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** A server feature flag as the app reads it: `known` stays false until the server answered. */
export type FlagAvailability = { enabled: boolean; known: boolean };

/**
 * A destination gated by a server flag stays reachable until the server says
 * the flag is off. While the read is pending (right after startup) the entry
 * shows and works, and the page shows its own loading state; the route then
 * redirects home only when the server answered "off".
 */
export function flaggedDestinationReachable(flag: FlagAvailability): boolean {
  return flag.enabled || !flag.known;
}

/** The sidebar handler for a flagged destination, or undefined to hide the entry. */
export function flaggedDestinationHandler(flag: FlagAvailability, open: () => void): (() => void) | undefined {
  return flaggedDestinationReachable(flag) ? open : undefined;
}

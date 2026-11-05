import { parseFeatureEnvironment, resolveFeature } from "@openwork/features";

/** The local Comex distribution has no organization or required cloud account.
 * Resolve the registry using the same operator locks as self-hosted OpenWork. */
export function comexWorkspaceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("comexWorkspace", { ...context, rollouts: {}, overrides: {} }).enabled;
}

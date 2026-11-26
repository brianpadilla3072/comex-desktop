import { parseFeatureEnvironment, resolveFeature } from "@openwork/features";

export function desktopLocalWebEnabled(env = process.env) {
  const context = parseFeatureEnvironment(env);
  return !context.problems.some(problem => problem.fatal)
    && resolveFeature("desktopLocalWeb", { ...context, rollouts: {}, overrides: {} }).enabled;
}

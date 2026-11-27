import { parseFeatureEnvironment, resolveFeature } from "@openwork/features";
import { z } from "zod";

const webPortSchema = z.coerce.number().int().min(1).max(65535);

export function desktopLocalWebEnabled(env = process.env) {
  const context = parseFeatureEnvironment(env);
  return !context.problems.some(problem => problem.fatal)
    && resolveFeature("desktopLocalWeb", { ...context, rollouts: {}, overrides: {} }).enabled;
}

/** Stable per-installation endpoint for mobile bookmarks; no machine paths or IPs. */
export function desktopLocalWebPort(env = process.env) {
  if (!desktopLocalWebEnabled(env)) return null;
  return webPortSchema.parse(env.OPENWORK_DESKTOP_WEB_PORT ?? 44129);
}

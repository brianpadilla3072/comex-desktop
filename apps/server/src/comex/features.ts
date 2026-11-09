import { parseFeatureEnvironment, resolveFeature } from "@openwork/features";

/** The local Comex distribution has no organization or required cloud account.
 * Resolve the registry using the same operator locks as self-hosted OpenWork. */
export function comexWorkspaceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("comexWorkspace", { ...context, rollouts: {}, overrides: {} }).enabled;
}

/** Operator-controlled boolean, off by default in the Comex distribution. */
export function openworkPromotionsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("openworkPromotions", { ...context, rollouts: {}, overrides: {} }).enabled;
}

export function specialistApplicationsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("specialistApplications", { ...context, rollouts: {}, overrides: {} }).enabled;
}

export function specialistIntegrationsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("specialistIntegrations", { ...context, rollouts: {}, overrides: {} }).enabled;
}

export function conversationNavigatorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("conversationNavigator", { ...context, rollouts: {}, overrides: {} }).enabled;
}

export function agentActivityMapEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("agentActivityMap", { ...context, rollouts: {}, overrides: {} }).enabled;
}

export function comexContinuityEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("comexContinuity", { ...context, rollouts: {}, overrides: {} }).enabled;
}

export function comexGitWorkspaceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("comexGitWorkspace", { ...context, rollouts: {}, overrides: {} }).enabled;
}

export function comexModelGuideEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("comexModelGuide", { ...context, rollouts: {}, overrides: {} }).enabled;
}

export function comexScopedMemoryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("comexScopedMemory", { ...context, rollouts: {}, overrides: {} }).enabled;
}

export function comexChatCommandsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("comexChatCommands", { ...context, rollouts: {}, overrides: {} }).enabled;
}

export function specialistLibraryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("specialistLibrary", { ...context, rollouts: {}, overrides: {} }).enabled;
}

export function scheduledTasksEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("scheduledTasks", { ...context, rollouts: {}, overrides: {} }).enabled;
}

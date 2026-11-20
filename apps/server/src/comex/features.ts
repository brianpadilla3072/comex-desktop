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

export function specialistAppPortabilityEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("specialistAppPortability", { ...context, rollouts: {}, overrides: {} }).enabled;
}

export function specialistAppZipBundleEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("specialistAppZipBundle", { ...context, rollouts: {}, overrides: {} }).enabled;
}

export function comexSpanishLocaleEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("comexSpanishLocale", { ...context, rollouts: {}, overrides: {} }).enabled;
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

export function taskDryRunEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("taskDryRun", { ...context, rollouts: {}, overrides: {} }).enabled;
}

export function sourcesLocalFilesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("sourcesLocalFiles", { ...context, rollouts: {}, overrides: {} }).enabled;
}

export function specialistDatasetsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("specialistDatasets", { ...context, rollouts: {}, overrides: {} }).enabled;
}

export function specialistSourcesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("specialistSources", { ...context, rollouts: {}, overrides: {} }).enabled;
}

export function specialistPanelsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("specialistPanels", { ...context, rollouts: {}, overrides: {} }).enabled;
}

export function specialistPanelAppsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("specialistPanelApps", { ...context, rollouts: {}, overrides: {} }).enabled;
}

export function studioOutputsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("studioOutputs", { ...context, rollouts: {}, overrides: {} }).enabled;
}

/** Operator-controlled artifact shell in the session panel, off by default. */
export function comexArtifactsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("comexArtifacts", { ...context, rollouts: {}, overrides: {} }).enabled;
}

export function agentEcosystemEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("agentEcosystem", { ...context, rollouts: {}, overrides: {} }).enabled;
}

export function remoteDevicePairingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("remoteDevicePairing", { ...context, rollouts: {}, overrides: {} }).enabled;
}

/** `openwork-server web` keeps manual approvals because the web app answers them. */
export function webApprovalsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("webApprovals", { ...context, rollouts: {}, overrides: {} }).enabled;
}

/** Isolated task copies with per-file review (docs/features/task-isolation-review). Off by
 *  default: it changes where scheduled runs write. */
export function taskIsolationReviewEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("taskIsolationReview", { ...context, rollouts: {}, overrides: {} }).enabled;
}

/** Owner-only folder browser so the web app can create workspaces (docs/features/web-folder-browser). */
export function webFolderBrowserEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("webFolderBrowser", { ...context, rollouts: {}, overrides: {} }).enabled;
}

/** Browser notifications for finished or failed turns in the web app (`webNotifications`). */
export function webNotificationsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("webNotifications", { ...context, rollouts: {}, overrides: {} }).enabled;
}

export function commandCenterEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("commandCenter", { ...context, rollouts: {}, overrides: {} }).enabled;
}

/** Results inbox of finished scheduled runs (docs/features/results-inbox). */
export function resultsInboxEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("resultsInbox", { ...context, rollouts: {}, overrides: {} }).enabled;
}

/** Localized startup screen with early Reload (docs/features/startup-screen-polish). */
export function startupScreenPolishEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("startupScreenPolish", { ...context, rollouts: {}, overrides: {} }).enabled;
}

/** Engine v1 starts on demand while v2 serves chats and stops when idle (docs/features/lazy-v1-engine). */
export function lazyV1EngineEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("lazyV1Engine", { ...context, rollouts: {}, overrides: {} }).enabled;
}

/** Settings › Apariencia › "Animaciones de actividad" switch (docs/features/activity-animations-toggle). */
export function activityAnimationsToggleEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("activityAnimationsToggle", { ...context, rollouts: {}, overrides: {} }).enabled;
}

/** Cmd/Ctrl+K finds individual settings and opens the page at them (docs/features/palette-setting-search). */
export function paletteSettingSearchEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  if (context.problems.some(problem => problem.fatal)) return false;
  return resolveFeature("paletteSettingSearch", { ...context, rollouts: {}, overrides: {} }).enabled;
}

/**
 * Runtime mirror of the `comexTaskSound` registry feature. The desktop config
 * provider refreshes it every 15 seconds, so killing the feature also silences
 * a preference that was already turned on. Modules outside React read it here.
 */
let taskSoundFeatureEnabled = false;

export function setTaskSoundFeatureEnabled(value: boolean): void {
  taskSoundFeatureEnabled = value;
}

export function isTaskSoundFeatureEnabled(): boolean {
  return taskSoundFeatureEnabled;
}

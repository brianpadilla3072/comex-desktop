export const TASK_SOUND_PREFERENCE_VALUES = [
  "off",
  "chime",
  "bell",
  "pop",
  "marimba",
  "soft",
  "custom",
] as const;

export type TaskSoundPreference = (typeof TASK_SOUND_PREFERENCE_VALUES)[number];

export const DEFAULT_TASK_SOUND_PREFERENCE: TaskSoundPreference = "off";

export function isTaskSoundPreference(value: unknown): value is TaskSoundPreference {
  return value === "off"
    || value === "chime"
    || value === "bell"
    || value === "pop"
    || value === "marimba"
    || value === "soft"
    || value === "custom";
}

/** `on` was the single-toggle value before sound choices existed. */
export function migrateTaskSoundPreference(value: unknown): TaskSoundPreference {
  if (value === "on") return "chime";
  return isTaskSoundPreference(value) ? value : DEFAULT_TASK_SOUND_PREFERENCE;
}

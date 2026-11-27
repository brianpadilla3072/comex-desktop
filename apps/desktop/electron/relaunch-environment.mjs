import { z } from "zod";
import { BLANK_SLATE_PATH_ENV_KEYS } from "./blank-slate-profile.mjs";

const keys = [...BLANK_SLATE_PATH_ENV_KEYS, "OPENCODE_TEST_HOME", "OPENCODE_CONFIGDIR"];
const snapshotSchema = z.object({ version: z.literal(1), paths: z.record(z.string(), z.string().nullable()) }).strict();

/** Capture launcher paths before the embedded server layers its child environment. */
export function captureRelaunchEnvironment(env) {
  return snapshotSchema.parse({ version: 1, paths: Object.fromEntries(keys.map(key => [key, env[key] ?? null])) });
}

/** Pure, versioned plan: null means remove the variable, not the string "null". */
export function desktopRelaunchPlan(snapshot, userDataPath) {
  const parsed = snapshotSchema.parse(snapshot);
  const profile = z.string().min(1).parse(userDataPath);
  return { version: 1, paths: Object.fromEntries(keys.map(key => [key, key === "OPENWORK_ELECTRON_USERDATA" ? profile : parsed.paths[key] ?? null])) };
}

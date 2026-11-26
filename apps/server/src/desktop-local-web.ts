import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { parseFeatureEnvironment, resolveFeature } from "@openwork/features";
import { ApiError } from "./errors.js";

export const desktopWebBootstrapSchema = z.object({ token: z.string().min(1), desktopWeb: z.object({ version: z.literal(1) }).strict() }).strict();
export const desktopWebRequestSchema = z.object({ root: z.string().min(1) }).strict();
export const desktopWebReceiptSchema = z.object({ version: z.literal(1), ready: z.literal(true) }).strict();

export function desktopLocalWebEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const context = parseFeatureEnvironment(env);
  return !context.problems.some(problem => problem.fatal)
    && resolveFeature("desktopLocalWeb", { ...context, rollouts: {}, overrides: {} }).enabled;
}

export function desktopWebAllowed(host: string, enabled: boolean): boolean {
  return enabled && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host);
}

export async function prepareDesktopWebRoot(input: unknown, host: string): Promise<string> {
  if (!desktopWebAllowed(host, desktopLocalWebEnabled())) throw new ApiError(403, "desktop_web_disabled", "Local web access requires an enabled feature and a loopback server.");
  const request = desktopWebRequestSchema.safeParse(input);
  if (!request.success || !isAbsolute(request.data.root)) throw new ApiError(400, "desktop_web_invalid_root", "The web bundle requires an absolute directory.");
  try {
    const root = await realpath(request.data.root);
    if (!(await stat(join(root, "index.html"))).isFile()) throw new Error();
    return root;
  } catch { throw new ApiError(503, "desktop_web_bundle_missing", "The local web bundle is unavailable."); }
}

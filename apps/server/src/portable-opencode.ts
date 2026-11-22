const PORTABLE_OPENCODE_TOP_LEVEL_KEYS = [
  "agent",
  "command",
  "instructions",
  "mcp",
  "permission",
  "plugin",
  "share",
  "tools",
  "watcher",
] as const;

function cloneJson(value: unknown): unknown {
  const copy: unknown = JSON.parse(JSON.stringify(value));
  return copy;
}

export function sanitizePortableOpencodeConfig(opencode: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const source = opencode && typeof opencode === "object" && !Array.isArray(opencode) ? opencode : {};
  const next: Record<string, unknown> = {};

  for (const key of PORTABLE_OPENCODE_TOP_LEVEL_KEYS) {
    if (!(key in source)) continue;
    next[key] = cloneJson(source[key]);
  }

  return next;
}

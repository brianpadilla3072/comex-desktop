/**
 * Read-only tokens (viewer, collaborator) may see configuration but never credentials: provider
 * API keys, MCP header tokens, environment values. Owners and the desktop host get the raw view.
 */
export const REDACTED = "[redacted]";

const SECRET_KEY = /^(?:api[_-]?key|apikey|key|token|access[_-]?token|refresh[_-]?token|secret|client[_-]?secret|password|passwd|authorization|cookie|bearer)$/i;
const SECRET_CONTAINER = /^(?:headers|environment|env)$/i;

export function canSeeSecrets(actor: { type?: string; scope?: string } | undefined): boolean {
  return actor?.type === "host" || actor?.scope === "owner";
}

/** Deep copy with secret values replaced. Structure, key names and non-secret values are kept. */
export function redactSecrets(value: unknown, insideContainer = false): unknown {
  if (Array.isArray(value)) return value.map(entry => redactSecrets(entry, insideContainer));
  if (!value || typeof value !== "object") return insideContainer && typeof value === "string" && value ? REDACTED : value;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY.test(key) && typeof entry === "string" && entry) output[key] = REDACTED;
    else output[key] = redactSecrets(entry, insideContainer || SECRET_CONTAINER.test(key));
  }
  return output;
}

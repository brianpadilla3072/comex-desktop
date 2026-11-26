/** Parse a link to this desktop renderer into the hash route the main window should open. */
export function appSessionRouteFromUrl(rawUrl, currentUrl) {
  let target;
  let current;
  try {
    target = new URL(rawUrl);
    current = new URL(currentUrl);
  } catch {
    return null;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") return null;
  if (current.protocol !== "http:" && current.protocol !== "https:") return null;
  if (target.origin !== current.origin) return null;

  const route = target.hash.startsWith("#/") ? target.hash.slice(1) : target.pathname;
  const match = /^\/workspace\/([^/]+)\/session(?:\/([^/]+))?\/?$/.exec(route);
  if (!match?.[1]) return null;
  try {
    const workspaceId = decodeURIComponent(match[1]);
    const sessionId = match[2] ? decodeURIComponent(match[2]) : null;
    if (!workspaceId) return null;
    return `/workspace/${encodeURIComponent(workspaceId)}/session${sessionId ? `/${encodeURIComponent(sessionId)}` : ""}`;
  } catch {
    return null;
  }
}

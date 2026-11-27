/** Exact generated wrappers only; never execute project source to resolve state. */
const MANAGED_SOURCE = /^\/\/ Managed by Comex: installed-browser-v1\nimport \{ installedBrowserPlugin \} from ("(?:[^"\\]|\\.)*");\nexport default installedBrowserPlugin\(("(?:[^"\\]|\\.)*")\);\n$/;

export function managedBrowserDescriptor(source: string): string | undefined {
  const match = MANAGED_SOURCE.exec(source);
  if (!match) return undefined;
  try {
    const plugin: unknown = JSON.parse(match[1]);
    const descriptor: unknown = JSON.parse(match[2]);
    if (typeof plugin === "string" && plugin.startsWith("file://")
      && /\/(?:installed-browser-plugin\.(?:js|ts)|installed-browser\/plugin\.mjs)$/.test(plugin)
      && typeof descriptor === "string" && descriptor.length > 0) return descriptor;
  } catch { /* Invalid generated source. */ }
  return undefined;
}

export function isManagedBrowserSource(source: string): boolean {
  return managedBrowserDescriptor(source) !== undefined;
}

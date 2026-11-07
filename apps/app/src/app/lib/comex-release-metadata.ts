import type { DenAppVersionMetadata } from "./den";
import { desktopFetchViaMain } from "./desktop";
import { isElectronRuntime } from "./runtime-env";

export const COMEX_RELEASE_METADATA_URL =
  "https://github.com/brianpadilla3072/comex-desktop/releases/latest/download/comex-release.json";

export function parseComexReleaseMetadata(payload: unknown): DenAppVersionMetadata {
  if (typeof payload !== "object" || payload === null) throw new Error("Invalid Comex release metadata.");
  const latest = Reflect.get(payload, "latestAppVersion");
  const versions: unknown = Reflect.get(payload, "publishedDesktopVersions");
  const isVersion = (value: unknown): value is string => typeof value === "string" && /^1\.0\.\d+$/.test(value);
  if (!isVersion(latest) || !Array.isArray(versions) || !versions.every(isVersion) || !versions.includes(latest)) {
    throw new Error("Invalid Comex release inventory.");
  }
  return {
    minAppVersion: "0.0.0",
    latestAppVersion: latest,
    publishedDesktopVersions: versions,
    webUrl: null,
  };
}

type FetchMetadata = (url: string, init: RequestInit) => Promise<Response>;

export async function readComexReleaseMetadata(
  fetchMetadata: FetchMetadata = (url, init) => isElectronRuntime()
    ? desktopFetchViaMain(url, init, 10_000)
    : fetch(url, init),
): Promise<DenAppVersionMetadata> {
  // Release downloads need Electron's existing main-process HTTP transport;
  // GitHub's redirect does not provide browser CORS headers.
  const response = await fetchMetadata(COMEX_RELEASE_METADATA_URL, {
    cache: "no-store",
    credentials: "omit",
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Comex release metadata: HTTP ${response.status}`);
  return parseComexReleaseMetadata(await response.json());
}

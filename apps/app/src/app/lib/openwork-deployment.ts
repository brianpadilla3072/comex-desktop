
export type OpenWorkDeployment = "desktop" | "web";

function normalizeDeployment(value: string | undefined): OpenWorkDeployment {
  const normalized = value?.trim().toLowerCase();
  return normalized === "web" ? "web" : "desktop";
}

export function getOpenWorkDeployment(): OpenWorkDeployment {
  // The same packaged bundle can be served by its desktop's loopback server.
  if (typeof window !== "undefined" && !window.__OPENWORK_ELECTRON__
    && window.__OPENWORK_BOOTSTRAP__?.desktopWeb?.version === 1) return "web";
  const envValue =
    typeof import.meta !== "undefined" && typeof import.meta.env?.VITE_OPENWORK_DEPLOYMENT === "string"
      ? import.meta.env.VITE_OPENWORK_DEPLOYMENT
      : undefined;

  return normalizeDeployment(envValue);
}

export function isWebDeployment(): boolean {
  return getOpenWorkDeployment() === "web";
}

export function isDesktopDeployment(): boolean {
  return getOpenWorkDeployment() === "desktop";
}

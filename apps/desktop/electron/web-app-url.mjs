import { z } from "zod";
import { appSessionRouteFromUrl } from "./app-session-link.mjs";

const bootstrapSchema = z.object({ token: z.string().trim().min(1) });

/** A desktop renderer is not a standalone web app: require server bootstrap. */
export function webAppUrlFromHtml(html, baseUrl, currentUrl) {
  const match = /<script>window\.__OPENWORK_BOOTSTRAP__ = (.*?)<\/script>/.exec(html);
  if (!match) return null;
  try {
    bootstrapSchema.parse(JSON.parse(match[1]));
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    let route = appSessionRouteFromUrl(currentUrl, currentUrl);
    // Packaged Electron starts from file://; its hash still names the conversation.
    const current = new URL(currentUrl);
    if (current.protocol === "file:") {
      const localRoute = new URL("http://desktop.invalid/");
      localRoute.hash = current.hash;
      route = appSessionRouteFromUrl(localRoute.href, localRoute.href);
    }
    url.pathname = `${url.pathname.replace(/\/$/, "")}${route ?? "/"}`;
    url.search = "";
    url.hash = "";
    return url.href;
  } catch { return null; }
}

/** Probe real web surfaces only; never fall back to the Electron/Vite URL. */
export async function resolveWebAppUrl({ serverUrl, currentUrl, fetchImpl = fetch }) {
  const candidates = [...new Set([serverUrl, "http://127.0.0.1:8787/"].filter(Boolean))];
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      url.search = "";
      url.hash = "";
      const response = await fetchImpl(url.href, { redirect: "error", signal: AbortSignal.timeout(1500) });
      if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) continue;
      const target = webAppUrlFromHtml(await response.text(), url.href, currentUrl);
      if (target) return target;
    } catch { /* The web service may not be running. */ }
  }
  return null;
}

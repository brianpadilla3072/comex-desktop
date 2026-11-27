/** @jsxImportSource react */
import { useEffect } from "react";
import { useNavigate } from "react-router";

import { subscribeDesktopDeepLinks } from "@/app/lib/desktop";
import { appSessionRouteFromUrl } from "@/app/lib/app-session-link";
import { isDesktopRuntime } from "@/app/lib/runtime-env";

/** Opens links to this renderer in the main window instead of the embedded browser. */
export function AppSessionLinkListener() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    void subscribeDesktopDeepLinks((urls) => {
      if (disposed) return;
      for (const url of urls) {
        const route = appSessionRouteFromUrl(url, window.location.href);
        if (!route) continue;
        navigate(route);
        break;
      }
    }).then((dispose) => {
      if (disposed) dispose();
      else unsubscribe = dispose;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [navigate]);

  return null;
}

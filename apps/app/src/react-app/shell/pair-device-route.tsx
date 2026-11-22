/** @jsxImportSource react */
import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OpenworkServerError, createOpenworkServerClient, forgetPairedDevice, isPairedDevice, savePairedDeviceToken } from "@/app/lib/openwork-server";
import { isDesktopRuntime } from "@/app/utils";
import { t } from "@/i18n";
import { resolveOpenworkConnection } from "./openwork-connection";
import { useBootState } from "./boot-state";
import { describeError } from "./pair-device-errors";

/** Default device name from the browser, editable before pairing. */
function suggestedDeviceName(): string {
  const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/iPhone|Android.+Mobile/i.test(agent)) return t("pairing.default_phone");
  if (/iPad|Android/i.test(agent)) return t("pairing.default_tablet");
  return t("pairing.default_browser");
}

/** Web route: redeem a one-time code from the desktop app for this browser's own owner access. */
export function PairDeviceRoute() {
  const location = useLocation();
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get("code") ?? "");
  const [deviceName, setDeviceName] = useState(suggestedDeviceName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // This screen needs no workspace: release the boot overlay, which otherwise waits for a
  // session route that never mounts here and covers the form (clicks never reached it).
  const { markRouteReady } = useBootState();
  useEffect(() => { markRouteReady(); }, [markRouteReady]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const connection = await resolveOpenworkConnection();
      const client = createOpenworkServerClient({ baseUrl: connection.normalizedBaseUrl });
      const result = await client.redeemPairingCode(code, deviceName);
      savePairedDeviceToken(result.token);
      // A full reload so every provider starts again with the new access.
      // The web app uses path routes (BrowserRouter); the desktop uses hash routes.
      window.location.replace(isDesktopRuntime() ? "#/session" : "/session");
      if (isDesktopRuntime()) window.location.reload();
    } catch (cause) {
      setError(describeError(cause));
      setBusy(false);
    }
  }

  return <main className="flex min-h-dvh items-center justify-center bg-dls-surface p-6 text-dls-primary" data-pair-device>
    <form className="grid w-full max-w-sm gap-4" onSubmit={event => void submit(event)}>
      <div className="grid gap-1">
        <h1 className="text-base font-semibold">{t("pairing.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("pairing.description")}</p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="pair-code">{t("pairing.code_label")}</Label>
        <Input id="pair-code" autoFocus autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} value={code} onChange={event => setCode(event.target.value)} placeholder="ABCD-2345" maxLength={32} required />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="pair-name">{t("pairing.device_label")}</Label>
        <Input id="pair-name" value={deviceName} onChange={event => setDeviceName(event.target.value)} maxLength={60} required />
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" disabled={busy || !code.trim() || !deviceName.trim()}>{busy ? t("pairing.submitting") : t("pairing.submit")}</Button>
    </form>
  </main>;
}

/** A paired browser whose access was revoked would be stuck with a dead token: check once at
 *  startup and fall back to the page's own access (and a notice) when the server says 401. */
export async function verifyPairedDevice(): Promise<"ok" | "revoked" | "unpaired"> {
  if (!isPairedDevice()) return "unpaired";
  try {
    const connection = await resolveOpenworkConnection();
    const client = createOpenworkServerClient({ baseUrl: connection.normalizedBaseUrl, token: connection.resolvedToken });
    await client.listPairedDevices();
    return "ok";
  } catch (cause) {
    if (cause instanceof OpenworkServerError && cause.status === 401) {
      forgetPairedDevice();
      return "revoked";
    }
    return "ok";
  }
}

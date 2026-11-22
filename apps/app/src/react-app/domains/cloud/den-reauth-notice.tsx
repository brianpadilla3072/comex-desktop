import { useEffect, useRef, useState } from "react";
import { t } from "@/i18n";
import { createDenClient, readDenSettings, writeDenSettings } from "@/app/lib/den";
import { deepLinkBridgeEvent, type DeepLinkBridgeDetail } from "@/app/lib/deep-link-bridge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDenAuth } from "./den-auth-provider";
import { tryOpenBrowserAuthUrl } from "./open-browser-auth";

/** Verification replaces only this account's session; it cannot enroll another account or workspace. */
export function DenReauthNotice({ onVerified, onCancel }: {
  onVerified: (client: ReturnType<typeof createDenClient>, commitSession: () => void) => Promise<void>;
  onCancel: () => void;
}) {
  const auth = useDenAuth();
  const [user] = useState(auth.user);
  const [settings] = useState(readDenSettings);
  const [nonce] = useState(() => crypto.randomUUID());
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const exchanging = useRef(false);
  const completeRef = useRef(onVerified);
  completeRef.current = onVerified;

  const url = new URL("/reauth/desktop", settings.baseUrl);
  url.searchParams.set("nonce", nonce);
  // Keep the opaque account reference out of requests; the browser gets the
  // email from its own matching session or asks the user to enter it.
  url.hash = new URLSearchParams({ userId: user?.id ?? "" }).toString();

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  async function finish(value: string) {
    if (exchanging.current || !active.current) return;
    if (!user) { setError(t("secondary_ui.cloud.reauth.account_unconfirmed")); return; }
    let returned: URL;
    try { returned = new URL(value.trim()); }
    catch { setError(t("secondary_ui.cloud.reauth.paste_link")); return; }
    if (returned.protocol !== "openwork:" || returned.hostname !== "den-reauth" || returned.searchParams.get("nonce") !== nonce) {
      setError(t("secondary_ui.cloud.reauth.other_check"));
      return;
    }
    const grant = returned.searchParams.get("grant");
    if (!grant) { setError(t("secondary_ui.cloud.reauth.incomplete")); return; }
    exchanging.current = true;
    setBusy(true);
    setError(null);
    const isCurrentSession = () => {
      const current = readDenSettings();
      return current.baseUrl === settings.baseUrl && current.apiBaseUrl === settings.apiBaseUrl
        && current.authToken === settings.authToken && current.activeOrgId === settings.activeOrgId;
    };
    const ensureCurrent = () => {
      if (!active.current || !isCurrentSession()) {
        throw new Error(t("secondary_ui.cloud.reauth.changed"));
      }
    };
    try {
      ensureCurrent();
      // Never send a grant to a destination supplied by a link.
      const exchange = await createDenClient(settings).exchangeDesktopHandoff(grant);
      if (!exchange.token || exchange.user?.id !== user.id) {
        throw new Error(t("secondary_ui.cloud.reauth.sign_in_as", { email: user.email }));
      }
      const client = createDenClient({ ...settings, token: exchange.token });
      const verifiedUser = await client.getSession();
      if (verifiedUser.id !== user.id) throw new Error(t("secondary_ui.cloud.reauth.sign_in_as", { email: user.email }));
      ensureCurrent();
      // The resumed mutation still enforces freshness and resource permissions on the server.
      // Commit when the share dialog closes: settings changes reload deployment
      // policy and can unmount the dashboard while its pending action is running.
      await completeRef.current(client, () => {
        if (isCurrentSession()) writeDenSettings({ ...settings, authToken: exchange.token }, { persistBootstrap: false });
      });
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : t("secondary_ui.cloud.reauth.failed"));
    } finally {
      exchanging.current = false;
      if (active.current) setBusy(false);
    }
  }

  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    const receive = (event: Event) => {
      const { urls } = (event as CustomEvent<DeepLinkBridgeDetail>).detail;
      for (const value of urls) {
        try {
          const returned = new URL(value);
          if (returned.protocol === "openwork:" && returned.hostname === "den-reauth" && returned.searchParams.get("nonce") === nonce) {
            void finishRef.current(value);
          }
        } catch { /* Other deep links belong to their existing handlers. */ }
      }
    };
    window.addEventListener(deepLinkBridgeEvent, receive);
    return () => window.removeEventListener(deepLinkBridgeEvent, receive);
  }, [nonce]);

  return <div className="space-y-3 rounded-lg border p-4">
    <p className="text-sm font-medium">{t("secondary_ui.cloud.reauth.title")}</p>
    <p className="text-sm text-muted-foreground">{t("secondary_ui.cloud.reauth.body")}</p>
    <Button type="button" disabled={busy || !user} onClick={() => {
      setError(null);
      void tryOpenBrowserAuthUrl(url.toString()).then((opened) => {
        if (!opened) setError(t("secondary_ui.cloud.reauth.browser_failed"));
      });
    }}>{t("secondary_ui.cloud.reauth.verify")}</Button>
    <details className="text-sm">
      <summary className="cursor-pointer">{t("secondary_ui.cloud.reauth.browser_didnt_open")}</summary>
      <Input aria-label={t("secondary_ui.cloud.reauth.address")} readOnly value={url.toString()} onFocus={(event) => event.target.select()} className="mt-2" />
    </details>
    <label className="block space-y-2 text-sm">
      <span>{t("secondary_ui.cloud.reauth.or_paste")}</span>
      <Input value={link} onChange={(event) => setLink(event.target.value)} disabled={busy} autoComplete="off" />
    </label>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>{t("secondary_ui.cloud.reauth.cancel")}</Button>
      <Button type="button" disabled={busy || !link.trim()} onClick={() => void finish(link)}>{busy ? t("secondary_ui.cloud.reauth.confirming") : t("secondary_ui.cloud.reauth.confirm")}</Button>
    </div>
  </div>;
}

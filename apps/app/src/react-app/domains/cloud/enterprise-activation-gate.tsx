/** @jsxImportSource react */
import { useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { t } from "@/i18n";

import {
  buildDenAuthUrl,
  readDenBootstrapConfig,
  setDenBootstrapConfig,
} from "@/app/lib/den";
import { exchangeHandoffAndSignIn } from "@/app/lib/den-handoff";
import { denSettingsChangedEvent } from "@/app/lib/den-session-events";
import { markDesktopSignInInitiated } from "@/app/lib/den-sign-in-intent";
import { enterpriseActivationRequired } from "@/app/lib/enterprise-activation";
import { readDesktopDistributionInfo } from "@/app/lib/desktop";
import { parseManualAuthInput } from "@/app/lib/manual-auth-input";
import { normalizeOrganizationServerInput } from "@/app/lib/organization-server-input";
import { DitherBackdrop } from "@/components/dither-backdrop";
import { PageTitlebarRegion } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resolveExtensionIconSrc } from "@/react-app/design-system/extension-icon-src";
import { openBrowserAuthUrl, type BrowserAuthOpenStatus } from "./open-browser-auth";

function subscribeToBootstrap(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(denSettingsChangedEvent, onStoreChange);
  return () => window.removeEventListener(denSettingsChangedEvent, onStoreChange);
}

type PendingServerConfirmation =
  | { kind: "browser"; baseUrl: string }
  | { kind: "manual"; baseUrl: string; grant: string; pasted: string };

export function useEnterpriseActivationRequired() {
  const bootstrap = useSyncExternalStore(
    subscribeToBootstrap,
    readDenBootstrapConfig,
    readDenBootstrapConfig,
  );
  return enterpriseActivationRequired(readDesktopDistributionInfo(), bootstrap);
}

function EnterpriseActivationPage() {
  const [serverInput, setServerInput] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingServerConfirmation | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [browserBusy, setBrowserBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  // Set once the browser hand-off starts: the sign-in page link the person can
  // open by hand, and whether the browser confirmed it opened.
  const [browserHandoff, setBrowserHandoff] = useState<{ url: string; status: BrowserAuthOpenStatus } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const submitServer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    // The address field quietly accepts a pasted openwork:// sign-in link as
    // the recovery path when the browser round trip cannot come back.
    const pastedLink = parseManualAuthInput(serverInput);
    if (pastedLink?.baseUrl && pastedLink.grant) {
      const linkBaseUrl = normalizeOrganizationServerInput(pastedLink.baseUrl);
      if (linkBaseUrl) {
        setPendingConfirmation({ kind: "manual", baseUrl: linkBaseUrl, grant: pastedLink.grant, pasted: serverInput });
        setServerError(null);
        setAuthError(null);
        setStatusMessage(t("secondary_ui.cloud.enterprise.confirm_url", { url: linkBaseUrl }));
        return;
      }
    }

    const baseUrl = normalizeOrganizationServerInput(serverInput);
    if (!baseUrl) {
      setServerError(t("secondary_ui.cloud.enterprise.invalid_address"));
      return;
    }

    setServerInput(baseUrl);
    setPendingConfirmation({ kind: "browser", baseUrl });
    setServerError(null);
    setAuthError(null);
    setStatusMessage(t("secondary_ui.cloud.enterprise.confirm_url", { url: baseUrl }));
  };

  const exchangeConfirmedGrant = async (grant: string, baseUrl: string) => {
    setAuthBusy(true);
    setAuthError(null);
    setServerError(null);
    setStatusMessage(t("secondary_ui.cloud.enterprise.finishing"));
    try {
      // The confirmed server, session, and activation stamp commit in one
      // handoff transaction, so activation can never leave the bootstrap and
      // the session pointing at different servers.
      const result = await exchangeHandoffAndSignIn(grant, {
        baseUrl,
        desktopInitiated: true,
        fallbackErrorMessage: t("secondary_ui.cloud.enterprise.no_token"),
        bootstrap: {
          requireSignin: true,
          enterpriseActivation: {
            activatedAt: new Date().toISOString(),
            denBaseUrl: baseUrl,
          },
        },
      });
      if (!result.ok) {
        setStatusMessage(null);
        setAuthError(result.error);
        return;
      }
    } catch (error) {
      setStatusMessage(null);
      setAuthError(
        error instanceof Error ? error.message : t("secondary_ui.cloud.enterprise.finish_failed"),
      );
    } finally {
      setAuthBusy(false);
    }
  };

  const confirmServer = async () => {
    const pending = pendingConfirmation;
    if (!pending || browserBusy || authBusy) return;

    setPendingConfirmation(null);
    if (pending.kind === "manual") {
      // Keep the pasted code in the field: if the exchange fails (for example a
      // timeout on a busy machine), Continue retries it without pasting again.
      setServerInput(pending.pasted);
      await exchangeConfirmedGrant(pending.grant, pending.baseUrl);
      return;
    }
    setServerInput(pending.baseUrl);

    setBrowserBusy(true);
    setServerError(null);
    setAuthError(null);
    try {
      await setDenBootstrapConfig({ baseUrl: pending.baseUrl, requireSignin: true });
      markDesktopSignInInitiated();
      const signInUrl = buildDenAuthUrl(pending.baseUrl, "sign-in");
      const status = await openBrowserAuthUrl(signInUrl);
      setBrowserHandoff({ url: signInUrl, status });
      setLinkCopied(false);
      // The field now takes the sign-in code the browser page shows; the address is saved.
      setServerInput("");
      if (status === "failed") {
        setStatusMessage(null);
        setAuthError(t("secondary_ui.cloud.enterprise.browser_failed"));
        return;
      }
      setStatusMessage(status === "opening"
        ? t("secondary_ui.cloud.enterprise.browser_slow")
        : t("secondary_ui.cloud.enterprise.finish_in_browser"));
    } catch (error) {
      setStatusMessage(null);
      setServerError(
        error instanceof Error ? error.message : t("secondary_ui.cloud.enterprise.save_failed"),
      );
    } finally {
      setBrowserBusy(false);
    }
  };

  // While the origin confirmation is on screen it is the only decision; the
  // redundant "Confirm X before continuing" status would repeat its question.
  const liveMessage = serverError ?? authError ?? (pendingConfirmation ? null : statusMessage);

  return (
    <div
      className="relative min-h-dvh bg-background text-foreground"
      data-state="enterprise-activation"
      data-testid="enterprise-activation-root"
    >
      <div
        className="pointer-events-none absolute inset-0 z-0 overflow-hidden opacity-[0.1] dark:invert"
        data-testid="enterprise-activation-background"
      >
        <DitherBackdrop />
      </div>

      <PageTitlebarRegion />

      <div
        className="relative z-10 flex min-h-dvh items-center justify-center px-6 py-16"
        data-testid="enterprise-activation-foreground"
      >
        <section
          className="w-full max-w-[720px] rounded-3xl border border-border bg-background px-8 pb-12 pt-10 sm:px-16 sm:pb-16 sm:pt-14"
          data-testid="enterprise-activation-card"
        >
          <div className="flex items-center gap-2.5">
            <img
              src={resolveExtensionIconSrc("/openwork-mark.svg")}
              alt=""
              width={26}
              height={26}
              className="max-h-[26px] shrink-0 object-contain object-left dark:invert"
              aria-hidden="true"
            />
            <span className="text-[15px] font-semibold tracking-tight text-foreground">
              OpenWork Enterprise
            </span>
          </div>

          <div className="mt-10 flex flex-col gap-2.5 sm:mt-14">
            <h1 className="text-[30px] font-semibold leading-[38px] tracking-[-0.03em] text-foreground sm:text-[38px] sm:leading-[46px]">
              {t("secondary_ui.cloud.enterprise.title")}
            </h1>
            <p className="text-[15px] leading-[23px] text-muted-foreground">
              {t("secondary_ui.cloud.enterprise.subtitle")}
            </p>
          </div>

          <div className="mt-11 flex flex-col gap-4">
            {pendingConfirmation ? null : (
              <form className="space-y-2" onSubmit={submitServer}>
                <label
                  className="text-sm font-medium text-foreground"
                  htmlFor="organization-server-input"
                >
                  {browserHandoff ? t("secondary_ui.cloud.enterprise.code_or_address") : t("secondary_ui.cloud.enterprise.address")}
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="organization-server-input"
                    data-testid="organization-server-input"
                    value={serverInput}
                    onChange={(event) => setServerInput(event.currentTarget.value)}
                    placeholder={browserHandoff ? t("secondary_ui.cloud.enterprise.paste_code") : "openwork.acme.com"}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    disabled={browserBusy || authBusy}
                    aria-invalid={serverError ? true : undefined}
                  />
                  <Button
                    type="submit"
                    className="sm:min-w-40"
                    disabled={browserBusy || authBusy}
                    data-testid="organization-server-continue"
                  >
                    {t("extensions.add_picker_continue")}
                  </Button>
                </div>
                {browserHandoff ? (
                  <div className="flex flex-wrap items-center gap-2 pt-1 text-xs leading-5 text-muted-foreground">
                    <span>{t("secondary_ui.cloud.enterprise.browser_didnt_open")}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid="organization-copy-sign-in-link"
                      onClick={() => {
                        void navigator.clipboard?.writeText(browserHandoff.url).then(
                          () => setLinkCopied(true),
                          () => setLinkCopied(false),
                        );
                      }}
                    >
                      {linkCopied ? t("secondary_ui.cloud.enterprise.link_copied") : t("den.copy_signin_link")}
                    </Button>
                  </div>
                ) : null}
              </form>
            )}

            {pendingConfirmation ? (
              <section className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
                <p className="text-sm leading-6 text-foreground">
                  {t("secondary_ui.cloud.enterprise.connect_prefix")} <strong className="break-all font-semibold">{pendingConfirmation.baseUrl}</strong>{t("secondary_ui.cloud.enterprise.connect_suffix")}
                </p>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setPendingConfirmation(null);
                      setStatusMessage(null);
                    }}
                    disabled={browserBusy || authBusy}
                  >
                    {t("common.back")}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void confirmServer()}
                    disabled={browserBusy || authBusy}
                    data-testid="organization-server-confirm"
                  >
                    {pendingConfirmation.kind === "browser"
                      ? t("secondary_ui.cloud.enterprise.continue_browser")
                      : t("secondary_ui.cloud.enterprise.confirm_finish")}
                  </Button>
                </div>
              </section>
            ) : null}

            <div className="min-h-5 text-xs leading-5" aria-live="polite" role="status">
              {liveMessage ? (
                <span className={serverError || authError ? "text-destructive" : "text-muted-foreground"}>
                  {liveMessage}
                </span>
              ) : null}
            </div>

          </div>
        </section>
      </div>
    </div>
  );
}

export function EnterpriseActivationGate({ children }: { children: ReactNode }) {
  return useEnterpriseActivationRequired()
    ? <EnterpriseActivationPage />
    : children;
}

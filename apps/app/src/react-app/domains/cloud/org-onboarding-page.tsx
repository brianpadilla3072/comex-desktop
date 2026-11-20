/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { t } from "@/i18n";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import {
  ArrowRight,
  ArrowUpRightIcon,
  Check,
  CheckCircle2,
  CircleAlert,
} from "lucide-react";
import {
  BuildingOffice2Icon,
  CloudIcon,
  Square3Stack3DIcon,
} from "@heroicons/react/24/solid";

import {
  createDenClient,
  readDenBootstrapConfig,
  readDenSettings,
  resolveDenBaseUrls,
  selectDenActiveOrganization,
  setDenBootstrapConfig,
  type DenDesktopConfig,
  type DenOrgLlmProvider,
  type DenOrgMarketplace,
  type DenOrgSummary,
} from "@/app/lib/den";
import { applyBrandAppName, applyBrandIcon, relaunchDesktopApp } from "@/app/lib/desktop";
import {
  isAlphaChannelAllowedByDesktopConfig,
  isAlphaUpdateAllowed,
  resolveFreshStableDesktopUpdate,
} from "@/app/lib/version-gate";
import {
  DEN_HANDOFF_AUTO_CONTINUE_KEY,
  exchangeHandoffAndSignIn,
} from "@/app/lib/den-handoff";
import { denSettingsChangedEvent } from "@/app/lib/den-session-events";
import { parseManualAuthInput } from "@/app/lib/manual-auth-input";
import { clearOrgSelectionPending, readOrgSelectionPending } from "@/app/lib/den-sign-in-intent";
import { completeSignInReturn } from "./sign-in-return";
import { usePlatform } from "../../kernel/platform";
import { useBootState } from "../../shell/boot-state";
import { resolveModelDisplayName, resolveProviderDisplayName } from "@/app/utils";
import { ProviderIcon } from "../../design-system/provider-icon";
import { writeStoredDefaultModel } from "../../kernel/model-config";
import { orgOnboardingVisibilityEvent } from "../../shell/reload-coordinator";
import { setOrgOnboardingOnScreen } from "../../shell/org-onboarding-visibility";
import {
  Page,
  PageBackground,
  PageContainer,
  PageContent,
  PageDescription,
  PageFooter,
  PageHeader,
  PageLoading,
  PageLoadingDescription,
  PageLoadingSpinner,
  PageTitle,
  PageTitlebarRegion,
} from "@/components/page";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { ScrollArea, ScrollAreaViewport } from "@/components/ui/scroll-area";
import { Field, FieldLabel, FieldTitle } from "@/components/ui/field"
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group"
import { useOrgListWindow } from "./use-org-list-window";
import { initialOrgOnboardingSelectionState, resolveOrgOnboardingPostListStep } from "./org-onboarding-selection";
export { initialOrgOnboardingSelectionState, resolveOrgOnboardingPostListStep } from "./org-onboarding-selection";
import { useDesktopConfig } from "./desktop-config-provider";
import {
  hasWorkspaceBranding,
  workspaceBrandingFingerprint,
} from "./workspace-branding-restart";

const RELOAD_AFTER_ONBOARDING_KEY = "openwork.reloadAfterOrgOnboarding";
const APPLIED_BRANDING_FINGERPRINT_KEY = "openwork.den.appliedBrandingFingerprint";
const BRANDING_RESTART_RESUME_KEY = "openwork.den.brandingRestartResume";

type BrandingRestartState = {
  fingerprint: string;
  updateReady: boolean;
  warning: string | null;
};

type OnboardingUpdaterBridge = NonNullable<Window["__OPENWORK_ELECTRON__"]>["updater"];

declare global {
  interface Window {
    __openworkOnboardingUpdaterEvalBridge?: OnboardingUpdaterBridge;
  }
}

function onboardingUpdaterBridge(): OnboardingUpdaterBridge | undefined {
  if (import.meta.env.DEV && window.__openworkOnboardingUpdaterEvalBridge) {
    return window.__openworkOnboardingUpdaterEvalBridge;
  }
  return window.__OPENWORK_ELECTRON__?.updater;
}

async function stageOnboardingUpdate(
  desktopConfig: DenDesktopConfig,
): Promise<boolean> {
  const updater = onboardingUpdaterBridge();
  if (!updater?.getChannel || !updater.check || !updater.download) return false;

  const channelState = await updater.getChannel();
  if (
    channelState.channel === "alpha" &&
    !isAlphaChannelAllowedByDesktopConfig(desktopConfig)
  ) {
    await updater.setChannel?.("stable");
    return false;
  }
  let targetVersion: string | undefined;
  if (channelState.channel === "stable") {
    const selection = await resolveFreshStableDesktopUpdate({
      currentVersion: channelState.currentVersion,
      refreshDesktopConfig: async () => desktopConfig,
    });
    if (selection?.kind !== "update") return false;
    targetVersion = selection.targetVersion;
  }

  const update = await updater.check(channelState.channel, targetVersion);
  if (!update.available || update.reason) return false;
  if (
    channelState.channel === "alpha" &&
    update.latestVersion &&
    !(await isAlphaUpdateAllowed(
      update.latestVersion,
      desktopConfig,
      channelState.currentVersion,
    ))
  ) {
    return false;
  }

  const download = await updater.download();
  return download.ok;
}

function subscribeToDenSettings(onStoreChange: () => void) {
  window.addEventListener(denSettingsChangedEvent, onStoreChange);
  return () => window.removeEventListener(denSettingsChangedEvent, onStoreChange);
}

function readDenSettingsSnapshot() {
  const settings = readDenSettings();
  return JSON.stringify({
    baseUrl: settings.baseUrl,
    authToken: settings.authToken ?? "",
    activeOrgId: settings.activeOrgId ?? "",
    activeOrgName: settings.activeOrgName ?? "",
  });
}

function useDenClient() {
  const settingsSnapshot = useSyncExternalStore(
    subscribeToDenSettings,
    readDenSettingsSnapshot,
    readDenSettingsSnapshot,
  );
  const settings = useMemo(() => readDenSettings(), [settingsSnapshot]);
  const authToken = settings.authToken ?? "";
  const denClient = useMemo(
    () =>
      createDenClient({
        baseUrl: settings.baseUrl,
        token: settings.authToken,
      }),
    [authToken, settings.baseUrl],
  );

  return {
    authToken,
    denClient,
    orgId: settings.activeOrgId ?? "",
    orgName: settings.activeOrgName ?? "",
    settings,
  };
}

/**
 * When an agent-first install prepared this desktop, read the non-secret
 * prepared summary so the onboarding payoff can greet the
 * user with "Setup complete" instead of a generic resource list.
 */
type PreparedBootstrapSummary = {
  orgName: string;
  skillTitle: string;
  claimLinks: Array<{ id: string; role: string; url: string; expiresAt: string }>;
};

function usePreparedBootstrap() {
  const bootstrap = useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener(denSettingsChangedEvent, onStoreChange);
      return () => window.removeEventListener(denSettingsChangedEvent, onStoreChange);
    },
    readDenBootstrapConfig,
    readDenBootstrapConfig,
  );

  return useMemo<PreparedBootstrapSummary | null>(() => {
    if (!bootstrap.prepared?.skillTitle) return null;
    return {
      orgName: bootstrap.prepared.orgName || t("secondary_ui.cloud.onboarding.your_workspace"),
      skillTitle: bootstrap.prepared.skillTitle,
      claimLinks: bootstrap.claimLinks ?? [],
    };
  }, [bootstrap]);
}

function PreparedWorkspacePage({ prepared }: { prepared: PreparedBootstrapSummary }) {
  const platform = usePlatform();
  const navigate = useNavigate();
  const ownerClaim = prepared.claimLinks.find((link) => link.role === "owner") ?? null;
  const [showSignInCode, setShowSignInCode] = useState(false);
  const [signInCode, setSignInCode] = useState("");
  const [signInBusy, setSignInBusy] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  const submitSignInCode = useCallback(async () => {
    // The claim page hands over a full `openwork://den-auth?grant=…` link;
    // accept that as well as a bare code, like the main sign-in page does.
    const parsed = parseManualAuthInput(signInCode);
    if (!parsed || signInBusy) {
      if (!parsed) setSignInError(t("secondary_ui.cloud.onboarding.invalid_code"));
      return;
    }

    const settings = readDenSettings();
    setSignInBusy(true);
    setSignInError(null);

    try {
      const result = await exchangeHandoffAndSignIn(parsed.grant, {
        baseUrl: settings.baseUrl,
        // A pasted one-time code is a desktop-initiated sign-in.
        desktopInitiated: true,
      });
      if (!result.ok) setSignInError(result.error);
    } finally {
      setSignInBusy(false);
    }
  }, [signInBusy, signInCode]);

  return (
    <Page>
      <PageBackground />
      <PageTitlebarRegion />
      <PageContainer>
        <PageHeader>
          <div
            data-openwork-prepared="true"
            data-openwork-provisional="true"
            className="mx-auto flex w-fit items-center gap-2 rounded-full border border-green-6/30 bg-green-2/30 px-3 py-1 text-xs font-semibold text-green-11"
          >
            <CheckCircle2 className="size-3.5" />
            {t("secondary_ui.cloud.onboarding.setup_ready")}
          </div>
          <PageTitle>{prepared.orgName}</PageTitle>
        </PageHeader>

        <PageContent>
          <div className="mx-auto grid w-full max-w-md gap-3">
            <div
              data-openwork-prepared-skill="true"
              className="flex min-h-10 items-center justify-between gap-3 border-y border-dls-border py-2 text-sm"
            >
              <span className="text-muted-foreground">{t("secondary_ui.cloud.onboarding.first_skill_ready")}</span>
              <span className="flex min-w-0 items-center gap-1.5 font-medium text-foreground">
                <Check className="size-4 shrink-0 text-green-11" />
                <span className="truncate">{prepared.skillTitle}</span>
              </span>
            </div>
          </div>
        </PageContent>

        {ownerClaim ? (
          <PageContent>
            <div className="mx-auto grid w-full max-w-md gap-3">
              <Button
                type="button"
                onClick={() => platform.openLink(ownerClaim.url)}
                className="w-full sm:w-auto"
              >
                {t("secondary_ui.cloud.onboarding.claim_continue")}
                <ArrowUpRightIcon data-icon="inline-end" />
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowSignInCode((visible) => !visible);
                  setSignInError(null);
                }}
              >
                {showSignInCode ? t("den.hide_signin_code") : t("den.paste_signin_code")}
              </Button>

              {showSignInCode ? (
                <div className="grid gap-3 rounded-2xl border border-dls-border bg-dls-surface p-4">
                  <Input
                    aria-label={t("secondary_ui.cloud.onboarding.code_aria")}
                    value={signInCode}
                    onChange={(event) => setSignInCode(event.currentTarget.value)}
                    placeholder={t("secondary_ui.cloud.onboarding.code_placeholder")}
                    disabled={signInBusy}
                  />
                  <Button
                    type="button"
                    onClick={() => void submitSignInCode()}
                    disabled={signInBusy || !signInCode.trim()}
                  >
                    {signInBusy ? t("secondary_ui.cloud.onboarding.signing_in") : t("secondary_ui.cloud.onboarding.sign_in_workspace")}
                  </Button>
                </div>
              ) : null}

              {signInError ? (
                <Alert variant="destructive">
                  <CircleAlert />
                  <AlertDescription>{signInError}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          </PageContent>
        ) : null}

        <PageFooter>
          <Button
            type="button"
            variant="link"
            className="mx-auto"
            onClick={() => navigate("/signin")}
          >
            {t("secondary_ui.cloud.onboarding.existing_account")}
          </Button>
        </PageFooter>
      </PageContainer>
    </Page>
  );
}

function markProvidersSeen(providers: ReadonlyArray<{ id: string }>) {
  if (providers.length === 0) return;

  try {
    const raw = window.localStorage.getItem("openwork.seenProviderIds");
    const existing: string[] = raw ? JSON.parse(raw) : [];
    const ids = new Set(existing);
    for (const provider of providers) ids.add(provider.id);
    window.localStorage.setItem("openwork.seenProviderIds", JSON.stringify([...ids]));
  } catch {}
}

/**
 * Full-screen onboarding page shown after sign-in + org selection.
 * Fetches all org resources (providers, marketplaces, skills)
 * and shows them so the user knows what their org provides.
 *
 * Route: /onboarding
 */
export function OrgOnboardingPage() {
  const navigate = useNavigate();
  const { authToken, denClient, orgId, settings } = useDenClient();
  // The organization this visit started in; finishing in another one is a switch.
  const [startingOrgId] = useState(orgId);
  const { markRouteReady } = useBootState();
  const prepared = usePreparedBootstrap();
  const initialSelectionState = initialOrgOnboardingSelectionState();
  const [hasSelectedOrganization, setHasSelectedOrganization] = useState(
    initialSelectionState.hasSelectedOrganization,
  );
  const [autoContinueResources, setAutoContinueResources] = useState(
    initialSelectionState.autoContinueResources,
  );
  const [autoSelectFailedOrgId, setAutoSelectFailedOrgId] = useState<string | null>(null);
  const autoSelectingOrgIdRef = useRef<string | null>(null);
  // A desktop-initiated sign-in parks the exchange-reported org here instead
  // of committing it; the chooser pre-highlights it as its default.
  const [suggestedOrgId] = useState(() => readOrgSelectionPending().suggestion?.id ?? "");
  const cancelSwitch = orgId && readOrgSelectionPending().pending
    ? () => {
        clearOrgSelectionPending();
        navigate("/settings/cloud-account", { replace: true });
      }
    : undefined;

  useEffect(() => {
    setOrgOnboardingOnScreen(true);
    window.dispatchEvent(new CustomEvent(orgOnboardingVisibilityEvent, { detail: { visible: true } }));
    return () => {
      setOrgOnboardingOnScreen(false);
      window.dispatchEvent(new CustomEvent(orgOnboardingVisibilityEvent, { detail: { visible: false } }));
    };
  }, []);

  useEffect(() => {
    markRouteReady();
  }, [markRouteReady]);

  useEffect(() => {
    if (!authToken && !prepared) {
      navigate("/session", { replace: true });
    }
  }, [authToken, navigate, prepared]);

  useEffect(() => {
    if (authToken && orgId && prepared && !readOrgSelectionPending().pending) {
      navigate("/session", { replace: true });
    }
  }, [authToken, navigate, orgId, prepared]);

  useEffect(() => {
    if (!authToken || !orgId) return;
    if (window.localStorage.getItem(BRANDING_RESTART_RESUME_KEY) !== orgId) return;
    window.localStorage.removeItem(BRANDING_RESTART_RESUME_KEY);
    navigate("/session", { replace: true });
  }, [authToken, navigate, orgId]);

  const { data, error, isPending, isFetchedAfterMount, refetch } = useQuery({
    queryKey: ["den-org-onboarding", settings.baseUrl, "orgs"],
    enabled: Boolean(authToken),
    refetchOnMount: "always",
    // A request that timed out while the app was busy starting recovers by
    // itself; Retry stays on screen meanwhile.
    refetchInterval: (query) => (query.state.status === "error" ? 10_000 : false),
    queryFn: () => denClient.listOrgs(),
  });
  const orgs = data?.orgs ?? [];
  const postListStep = resolveOrgOnboardingPostListStep({
    orgs,
    activeOrgId: orgId || suggestedOrgId,
    hasSelectedOrganization,
    committedOrgId: orgId,
    orgSelectionPending: readOrgSelectionPending().pending,
    autoContinueResources,
    autoSelectFailedOrgId,
    // An explicit switch must never auto-commit stale cached single-org data
    // before the directory refetch discovers newly available organizations.
    allowAutoSelect: !cancelSwitch && isFetchedAfterMount && !error,
  });
  const autoSelectOrg = postListStep.kind === "auto-select-single-org"
    ? postListStep.organization
    : null;

  useEffect(() => {
    if (!authToken || !autoSelectOrg) return;
    if (autoSelectingOrgIdRef.current === autoSelectOrg.id) return;

    let cancelled = false;
    autoSelectingOrgIdRef.current = autoSelectOrg.id;
    void selectDenActiveOrganization(autoSelectOrg, settings)
      .then(() => {
        if (cancelled) return;
        setAutoContinueResources(true);
        setHasSelectedOrganization(true);
      })
      .catch(() => {
        if (!cancelled) setAutoSelectFailedOrgId(autoSelectOrg.id);
      })
      .finally(() => {
        if (autoSelectingOrgIdRef.current === autoSelectOrg.id) {
          autoSelectingOrgIdRef.current = null;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authToken, autoSelectOrg, settings]);

  if (!authToken) {
    return prepared ? <PreparedWorkspacePage prepared={prepared} /> : null;
  }

  if (isPending || (!isFetchedAfterMount && !error)) {
    return (
      <Page>
        <PageBackground />
        <PageTitlebarRegion />
        <PageContainer>
          <PageHeader>
            <PageTitle>{t("ai_providers.your_organization_title")}</PageTitle>
          </PageHeader>
          <PageContent>
            <PageLoading>
              <PageLoadingSpinner />
              <PageLoadingDescription>{t("secondary_ui.cloud.onboarding.loading_orgs")}</PageLoadingDescription>
            </PageLoading>
          </PageContent>
          {cancelSwitch ? (
            <PageFooter>
              <Button type="button" variant="ghost" onClick={cancelSwitch}>{t("common.cancel")}</Button>
            </PageFooter>
          ) : null}
        </PageContainer>
      </Page>
    );
  }

  if (error) {
    return (
      <Page>
        <PageBackground />
        <PageTitlebarRegion />
        <PageContainer>
          <PageHeader>
            <PageTitle>{t("secondary_ui.cloud.onboarding.choose_org")}</PageTitle>
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>
                {error instanceof Error ? error.message : t("secondary_ui.cloud.onboarding.load_orgs_failed")}
              </AlertDescription>
            </Alert>
          </PageHeader>
          <PageFooter>
            <Button type="button" onClick={() => void refetch()}>{t("common.retry")}</Button>
            {cancelSwitch ? (
              <Button type="button" variant="ghost" onClick={cancelSwitch}>{t("common.cancel")}</Button>
            ) : null}
          </PageFooter>
        </PageContainer>
      </Page>
    );
  }

  if (postListStep.kind === "auto-select-single-org") {
    return (
      <Page>
        <PageBackground />
        <PageTitlebarRegion />
        <PageContainer>
          <PageHeader>
            <PageTitle>{t("ai_providers.your_organization_title")}</PageTitle>
          </PageHeader>
          <PageContent>
            <PageLoading>
              <PageLoadingSpinner />
              <PageLoadingDescription>{t("secondary_ui.cloud.onboarding.loading_orgs")}</PageLoadingDescription>
            </PageLoading>
          </PageContent>
        </PageContainer>
      </Page>
    );
  }

  if (postListStep.kind === "choose-org") {
    return (
      <OrganizationSelectionPage
        orgs={orgs}
        defaultOrganization={postListStep.defaultOrganization}
        onCancel={cancelSwitch}
        onContinue={() => {
          setAutoContinueResources(false);
          setHasSelectedOrganization(true);
        }}
      />
    );
  }

  return (
    <ResourceSelectionPage
      autoContinue={postListStep.autoContinue}
      previousOrgId={startingOrgId}
    />
  );
}

export function ResourceSelectionPage({ autoContinue = false, previousOrgId = "" }: {
  autoContinue?: boolean;
  previousOrgId?: string;
}) {
  const navigate = useNavigate();
  const platform = usePlatform();
  const { markRouteReady } = useBootState();
  const { authToken, denClient, orgId, orgName, settings } = useDenClient();
  const { refreshFresh } = useDesktopConfig();

  const prepared = usePreparedBootstrap();

  const [selectedDefault, setSelectedDefault] = useState<{
    providerId: string;
    modelId: string;
    label: string;
  } | null>(null);
  const [preparingBranding, setPreparingBranding] = useState(false);
  const [brandingRestart, setBrandingRestart] = useState<BrandingRestartState | null>(null);
  const autoContinueAttemptedRef = useRef(false);

  // Redirect if no auth or no org — can't show onboarding without them
  useEffect(() => {
    markRouteReady();
  }, [markRouteReady]);

  useEffect(() => {
    if (!authToken || !orgId) {
      navigate("/session", { replace: true });
    }
  }, [authToken, navigate, orgId]);

  const { providers, gatewayProviders, marketplaces, loading, error } = useQueries({
    queries: [
      {
        queryKey: ["den-org-onboarding", settings.baseUrl, orgId, "providers"],
        enabled: Boolean(authToken && orgId),
        queryFn: () => denClient.listOrgLlmProviders(orgId),
      },
      {
        queryKey: ["den-org-onboarding", settings.baseUrl, orgId, "gateway-providers"],
        enabled: Boolean(authToken && orgId),
        queryFn: () => denClient.listOrgGatewayProviders(orgId),
      },
      {
        queryKey: ["den-org-onboarding", settings.baseUrl, orgId, "marketplaces"],
        enabled: Boolean(authToken && orgId),
        queryFn: () => denClient.listOrgMarketplaces(orgId),
      },
    ],
    combine: ([providersQuery, gatewayProvidersQuery, marketplacesQuery]) => ({
      providers: providersQuery.data ?? [],
      gatewayProviders: gatewayProvidersQuery.data ?? [],
      marketplaces: marketplacesQuery.data ?? [],
      loading: providersQuery.isPending || gatewayProvidersQuery.isPending || marketplacesQuery.isPending,
      error: providersQuery.error?.message ?? gatewayProvidersQuery.error?.message ?? marketplacesQuery.error?.message ?? null,
    }),
  });

  const finishOnboarding = useCallback((optionsArg?: { requestReload?: boolean }) => {
    // If user picked a default model, write it
    if (selectedDefault) {
      writeStoredDefaultModel({
        providerID: selectedDefault.providerId,
        modelID: selectedDefault.modelId,
      });
    }
    // Mark all providers shown on this page as "seen" so the global
    // toast doesn't re-fire for them on the next sync interval.
    markProvidersSeen([...providers, ...gatewayProviders]);
    try {
      window.sessionStorage.removeItem(DEN_HANDOFF_AUTO_CONTINUE_KEY);
    } catch {}
    if ((providers.length > 0 || gatewayProviders.length > 0) && optionsArg?.requestReload !== false) {
      try {
        window.localStorage.setItem(RELOAD_AFTER_ONBOARDING_KEY, "1");
      } catch {}
    }
    // A sign-in started from a conversation returns there.
    if (!completeSignInReturn(navigate)) navigate("/session", { replace: true });
    // Stores and caches across the app still hold the previous organization's
    // providers, skills and connections. Start over at the route above.
    if (previousOrgId && previousOrgId !== orgId) window.location.reload();
  }, [gatewayProviders, navigate, orgId, previousOrgId, providers, selectedDefault]);

  const handleContinue = useCallback(async (optionsArg?: { requestReload?: boolean }) => {
    if (!window.__OPENWORK_ELECTRON__?.shell?.relaunch) {
      finishOnboarding({ requestReload: optionsArg?.requestReload });
      return;
    }

    setPreparingBranding(true);
    try {
      const desktopConfig = await refreshFresh();
      if (!hasWorkspaceBranding(desktopConfig)) {
        finishOnboarding({ requestReload: optionsArg?.requestReload });
        return;
      }

      const fingerprint = workspaceBrandingFingerprint(orgId, desktopConfig);
      if (window.localStorage.getItem(APPLIED_BRANDING_FINGERPRINT_KEY) === fingerprint) {
        finishOnboarding({ requestReload: optionsArg?.requestReload });
        return;
      }

      const bootstrap = readDenBootstrapConfig();
      await setDenBootstrapConfig({
        ...bootstrap,
        brandAppName: desktopConfig.brandAppName ?? null,
        brandLogoUrl: desktopConfig.brandLogoUrl ?? null,
        brandIconUrl: desktopConfig.brandIconUrl ?? null,
      });
      const [, iconResult] = await Promise.all([
        applyBrandAppName(desktopConfig.brandAppName ?? null),
        applyBrandIcon(desktopConfig.brandIconUrl ?? null),
      ]);

      let updateReady = false;
      let warning = desktopConfig.brandIconUrl && !iconResult.ok
        ? t("secondary_ui.cloud.onboarding.icon_failed")
        : null;
      try {
        updateReady = await stageOnboardingUpdate(desktopConfig);
      } catch (error) {
        warning ??= error instanceof Error ? error.message : t("secondary_ui.cloud.onboarding.update_failed");
      }
      setBrandingRestart({ fingerprint, updateReady, warning });
    } catch (error) {
      setBrandingRestart({
        fingerprint: workspaceBrandingFingerprint(orgId, {}),
        updateReady: false,
        warning: error instanceof Error ? error.message : t("secondary_ui.cloud.onboarding.branding_failed"),
      });
    } finally {
      setPreparingBranding(false);
    }
  }, [finishOnboarding, orgId, refreshFresh]);

  useEffect(() => {
    if (!autoContinue || autoContinueAttemptedRef.current) return;
    if (loading || error || preparingBranding || brandingRestart) return;

    autoContinueAttemptedRef.current = true;
    void handleContinue({ requestReload: false });
  }, [autoContinue, brandingRestart, error, handleContinue, loading, preparingBranding]);

  const restartWithBranding = useCallback(async () => {
    if (!brandingRestart) return;
    window.localStorage.setItem(APPLIED_BRANDING_FINGERPRINT_KEY, brandingRestart.fingerprint);
    window.localStorage.setItem(BRANDING_RESTART_RESUME_KEY, orgId);
    if (brandingRestart.updateReady) {
      const result = await onboardingUpdaterBridge()?.installAndRestart?.();
      if (result?.ok) return;
    }
    await relaunchDesktopApp();
  }, [brandingRestart, orgId]);

  const continueWithoutRestart = useCallback(() => {
    if (brandingRestart) {
      window.localStorage.setItem(APPLIED_BRANDING_FINGERPRINT_KEY, brandingRestart.fingerprint);
    }
    finishOnboarding();
  }, [brandingRestart, finishOnboarding]);

  const openworkProviders = providers.filter((provider) => provider.source === "openwork");
  const legacyProviders = providers.filter((provider) => provider.source !== "openwork");
  const totalModels = legacyProviders.reduce((sum, provider) => sum + provider.models.length, 0);
  const hasResources = providers.length > 0 || gatewayProviders.length > 0 || marketplaces.length > 0;
  const autoContinuePending =
    autoContinue && !loading && !error && !brandingRestart;

  if (preparingBranding) {
    return (
      <Page>
        <PageBackground />
        <PageTitlebarRegion />
        <PageContainer>
          <PageHeader>
            <PageTitle>{t("secondary_ui.cloud.onboarding.preparing_identity")}</PageTitle>
            <PageDescription>
              {t("secondary_ui.cloud.onboarding.applying_branding", { name: orgName || t("secondary_ui.cloud.onboarding.your_workspace_lower") })}
            </PageDescription>
          </PageHeader>
          <PageContent>
            <PageLoading>
              <PageLoadingSpinner />
              <PageLoadingDescription>{t("secondary_ui.cloud.onboarding.preparing_workspace")}</PageLoadingDescription>
            </PageLoading>
          </PageContent>
        </PageContainer>
      </Page>
    );
  }

  if (brandingRestart) {
    return (
      <Page>
        <PageBackground />
        <PageTitlebarRegion />
        <PageContainer>
          <PageHeader>
            <PageTitle>{t("secondary_ui.cloud.onboarding.identity_ready")}</PageTitle>
            <PageDescription>
              {t("secondary_ui.cloud.onboarding.restart_to_apply", { name: orgName || t("secondary_ui.cloud.onboarding.your_workspace_lower") })}
            </PageDescription>
            {brandingRestart.updateReady ? (
              <div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-green-6/30 bg-green-2/30 px-3 py-1 text-xs font-semibold text-green-11">
                <CheckCircle2 className="size-3.5" />
                {t("secondary_ui.cloud.onboarding.update_downloaded")}
              </div>
            ) : null}
            {brandingRestart.warning ? (
              <Alert>
                <CircleAlert />
                <AlertDescription>
                  {brandingRestart.warning} {t("secondary_ui.cloud.onboarding.can_continue")}
                </AlertDescription>
              </Alert>
            ) : null}
          </PageHeader>
          <PageContent>
            <details className="mx-auto w-full max-w-md rounded-xl border border-dls-border bg-dls-surface px-4 py-3 text-sm">
              <summary className="cursor-pointer font-medium">{t("secondary_ui.cloud.onboarding.why_restart")}</summary>
              <p className="mt-2 text-muted-foreground">
                {t("secondary_ui.cloud.onboarding.why_restart_body")}
              </p>
            </details>
          </PageContent>
          <PageFooter>
            <Button type="button" variant="outline" onClick={continueWithoutRestart}>
              {t("secondary_ui.cloud.onboarding.continue_no_restart")}
            </Button>
            <Button type="button" size="lg" onClick={() => void restartWithBranding()}>
              {t("secondary_ui.cloud.onboarding.restart_openwork")}
              <ArrowRight data-icon="inline-end" />
            </Button>
          </PageFooter>
        </PageContainer>
      </Page>
    );
  }

  if (autoContinuePending) {
    return (
      <Page>
        <PageBackground />
        <PageTitlebarRegion />
        <PageContainer>
          <PageHeader>
            <PageTitle>{orgName || t("ai_providers.your_organization_title")}</PageTitle>
          </PageHeader>
          <PageContent>
            <PageLoading>
              <PageLoadingSpinner />
              <PageLoadingDescription>{t("secondary_ui.cloud.onboarding.loading_resources")}</PageLoadingDescription>
            </PageLoading>
          </PageContent>
        </PageContainer>
      </Page>
    );
  }

  return (
    <Page>
      <PageBackground />
      <PageTitlebarRegion />

      <PageContainer>
        {/* Header */}
        <PageHeader>
          {prepared ? (
            <div
              data-openwork-prepared="true"
              className="mx-auto flex w-fit items-center gap-2 rounded-full border border-green-6/30 bg-green-2/30 px-3 py-1 text-xs font-semibold text-green-11"
            >
              <CheckCircle2 className="size-3.5" />
              {t("secondary_ui.cloud.onboarding.setup_prepared")}
            </div>
          ) : null}
          <PageTitle>
            {orgName || t("ai_providers.your_organization_title")}
          </PageTitle>
          {loading ? (
            null
          ) : error ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : hasResources ? (
            <PageDescription>
              {t("secondary_ui.cloud.onboarding.has_resources")}
            </PageDescription>
          ) : null}
        </PageHeader>

        {loading ? (
          <PageContent>
            <PageLoading>
              <PageLoadingSpinner />
              <PageLoadingDescription>{t("secondary_ui.cloud.onboarding.loading_resources")}</PageLoadingDescription>
            </PageLoading>
          </PageContent>
        ) : error && !hasResources ? null : !hasResources ? (
          <PageContent>
            <Empty className="h-fit flex-none">
              <EmptyHeader>
                <EmptyTitle>{t("secondary_ui.cloud.onboarding.no_resources")}</EmptyTitle>
                <EmptyDescription>
                  {t("secondary_ui.cloud.onboarding.no_resources_hint")}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  variant="outline"
                  onClick={() => platform.openLink(resolveDenBaseUrls(settings.baseUrl).baseUrl)}
                >
                  {t("secondary_ui.cloud.onboarding.open_cloud")}
                  <ArrowUpRightIcon data-icon="inline-end" />
                </Button>
              </EmptyContent>
            </Empty>
          </PageContent>
        ) : (
          <PageContent>
            <ScrollArea className="px-2.5">
              <ScrollAreaViewport>
                <Accordion
                  multiple
                  className="rounded-2xl border border-border bg-transparent shadow-none before:hidden"
                >
                  {openworkProviders.length > 0 ? (
                    <Section
                      icon={<CloudIcon className="size-5 text-foreground/60" />}
                      title="OpenWork Models"
                      description={t("secondary_ui.cloud.onboarding.openwork_models_desc")}
                    >
                      {openworkProviders.map((provider) => (
                        <ProviderAccessCard key={provider.id} provider={provider} />
                      ))}
                    </Section>
                  ) : null}

                  {gatewayProviders.length > 0 ? (
                    <Section
                      icon={<CloudIcon className="size-5 text-foreground/60" />}
                      title="AI Gateway"
                      description={t("secondary_ui.cloud.onboarding.gateway_desc")}
                      count={t("secondary_ui.cloud.onboarding.ai_providers", { count: gatewayProviders.length })}
                    >
                      {gatewayProviders.map((provider) => (
                        <ProviderAccessCard key={provider.id} provider={provider} />
                      ))}
                    </Section>
                  ) : null}

                  {legacyProviders.length > 0 ? (
                    <Section
                      icon={<CloudIcon className="size-5 text-foreground/60" />}
                      title={t("settings.card.ai.title")}
                      description={t("secondary_ui.cloud.onboarding.ai_providers_desc")}
                      count={t("secondary_ui.cloud.onboarding.models", { count: totalModels })}
                    >
                      {legacyProviders.map((provider) => (
                        <ProviderCard
                          key={provider.id}
                          provider={provider}
                          selectedDefault={selectedDefault}
                          onSelectDefault={setSelectedDefault}
                        />
                      ))}
                    </Section>
                  ) : null}

                  {/* Marketplaces */}
                  {marketplaces.length > 0 ? (
                    <Section
                      icon={<Square3Stack3DIcon className="size-5 text-foreground/60" />}
                      title={t("settings.tab_cloud_marketplaces")}
                      description={t("secondary_ui.cloud.onboarding.collections_desc")}
                      count={t("secondary_ui.cloud.onboarding.marketplaces", { count: marketplaces.length })}
                    >
                      {marketplaces.map((mp) => (
                        <MarketplaceCard key={mp.id} marketplace={mp} />
                      ))}
                    </Section>
                  ) : null}

                </Accordion>
              </ScrollAreaViewport>
            </ScrollArea>
            {/* Selected default indicator */}
            {selectedDefault ? (
              <div className="rounded-xl border border-green-6/30 bg-green-2/30 px-4 py-3 text-center text-sm text-green-11">
                <Check size={14} className="mr-1 inline" />
                {t("secondary_ui.cloud.onboarding.default_model_set", { name: selectedDefault.label })}
              </div>
            ) : null}
          </PageContent>
        )}

        <PageFooter>
          {/* Footer hint */}
          {!loading && !error && hasResources ? (
            <p className="text-center text-xs text-muted-foreground text-balance leading-relaxed tracking-wide">
              {t("secondary_ui.cloud.onboarding.footer_hint")}
            </p>
          ) : null}
          <Button
            className="w-fit"
            type="button"
            size="lg"
            onClick={() => void handleContinue()}
            disabled={loading || preparingBranding}
          >
            {preparingBranding
              ? t("secondary_ui.cloud.onboarding.preparing_workspace")
              : hasResources
                ? t("secondary_ui.cloud.onboarding.continue_workspace")
                : t("extensions.add_picker_continue")}
            <ArrowRight data-icon="inline-end" />
          </Button>
        </PageFooter>
      </PageContainer>
    </Page>
  );
}

function ProviderAccessCard({ provider }: { provider: Pick<DenOrgLlmProvider, "providerId" | "name"> }) {
  return (
    <div className="-mx-2 flex items-center gap-4.5 rounded-xl border border-border px-3 py-3">
      <ProviderIcon
        providerId={provider.providerId}
        providerName={provider.name}
        size={20}
        className="text-foreground"
      />
      <div className="min-w-0 flex-1 text-sm font-medium text-foreground">
        {provider.name}
      </div>
    </div>
  );
}

interface MarketplaceCardProps {
  marketplace: DenOrgMarketplace;
}

function MarketplaceCard({ marketplace }: MarketplaceCardProps) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border px-3 py-3 -mx-2">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{marketplace.name}</div>
        {marketplace.description ? (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {marketplace.description}
          </div>
        ) : null}
      </div>
        <span className="shrink-0 text-xs text-muted-foreground">
        {t("secondary_ui.cloud.onboarding.plugins", { count: marketplace.pluginCount })}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section wrapper                                                    */
/* ------------------------------------------------------------------ */

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  count?: string;
  children: React.ReactNode;
}

function Section({ icon, title, description, count, children }: SectionProps) {
  return (
    <AccordionItem value={title}>
      <AccordionTrigger className="items-center px-5 py-4 gap-4.75 hover:no-underline">
        {icon}

        <div className="min-w-0 flex-1 flex flex-col gap-1">
          <h3 className="flex items-center gap-2 font-medium tracking-wide">
            {title}
            {count ? <span className="text-muted-foreground text-xs uppercase">{count}</span> : null}
          </h3>
          <p className="text-sm font-normal normal-case tracking-normal text-muted-foreground">
            {description}
          </p>
        </div>
      </AccordionTrigger>
      <AccordionContent className="flex flex-col gap-2 pb-2">
        {children}
      </AccordionContent>
    </AccordionItem>
  );
}

/* ------------------------------------------------------------------ */
/*  Provider card with "Use as default" option                         */
/* ------------------------------------------------------------------ */

interface ProviderCardProps {
  provider: DenOrgLlmProvider;
  selectedDefault: { providerId: string; modelId: string } | null;
  onSelectDefault: (value: {
    providerId: string;
    modelId: string;
    label: string;
  } | null) => void;
}

function ProviderCard({ provider, selectedDefault, onSelectDefault }: ProviderCardProps) {
  // The local provider ID matches the cloud provider's org-level ID
  const localProviderId = provider.id.trim();
  const firstModel = provider.models[0] ?? null;
  const isSelected = selectedDefault?.providerId === localProviderId;

  const handleUseAsDefault = () => {
    if (!firstModel) return;
    if (isSelected) {
      onSelectDefault(null);
    } else {
      onSelectDefault({
        providerId: localProviderId,
        modelId: firstModel.id,
        label: `${resolveProviderDisplayName(provider.name || provider.providerId)} · ${firstModel.name || resolveModelDisplayName(firstModel.id)}`,
      });
    }
  };

  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-3 transition-colors -mx-2",
        isSelected ? "border-green-6" : "border-border",
      )}
    >
      <div className="flex items-center gap-4.5">
        <ProviderIcon
          providerId={provider.providerId}
          providerName={provider.name}
          size={20}
          className="text-foreground"
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">
            {resolveProviderDisplayName(provider.name || provider.providerId)}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {provider.models.length === 1
              ? t("secondary_ui.cloud.onboarding.models", { count: 1 })
              : t("secondary_ui.cloud.onboarding.models", { count: provider.models.length })}
          </div>
        </div>
        {firstModel ? (
          <button
            type="button"
            className={cn(
              "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
              isSelected
                ? "bg-green-3 text-green-11"
                : "border border-border text-muted-foreground hover:bg-hover hover:text-foreground",
            )}
            onClick={handleUseAsDefault}
          >
            {isSelected ? t("settings.default_label") : t("secondary_ui.cloud.onboarding.use_as_default")}
          </button>
        ) : (
          <Check size={16} className="shrink-0 text-green-11" />
        )}
      </div>
      {provider.models.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {provider.models.slice(0, 5).map((model) => (
            <span
              key={model.id}
              className="inline-flex items-center rounded-md border border-border bg-hover px-2 py-0.5 font-mono text-xs text-muted-foreground"
            >
              {model.name || resolveModelDisplayName(model.id)}
            </span>
          ))}
          {provider.models.length > 5 ? (
            <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs text-muted-foreground">
              +{provider.models.length - 5} more
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface OrganizationSelectionPageProps {
  orgs: DenOrgSummary[];
  defaultOrganization: DenOrgSummary;
  onContinue: () => void;
  onCancel?: () => void;
}

function OrganizationSelectionPage({
  orgs,
  defaultOrganization,
  onContinue,
  onCancel,
}: OrganizationSelectionPageProps) {
  const { settings } = useDenClient();
  const [selected, setSelected] = useState(defaultOrganization);
  const { error, isPending, mutate } = useMutation({
    mutationFn: (nextOrg: DenOrgSummary) => selectDenActiveOrganization(nextOrg, settings),
    onSuccess: () => onContinue(),
  });

  return (
    <Page>
      <PageBackground />
      <PageTitlebarRegion />
      <PageContainer>
        <PageHeader>
          <PageTitle>{t("secondary_ui.cloud.onboarding.choose_org")}</PageTitle>
          {error ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>
                {error instanceof Error ? error.message : t("secondary_ui.cloud.onboarding.select_org_failed")}
              </AlertDescription>
            </Alert>
          ) : (
            <PageDescription>
              {t("secondary_ui.cloud.onboarding.select_org_desc")}
            </PageDescription>
          )}
        </PageHeader>

        <PageContent>
          <OrganizationList
            orgs={orgs}
            value={selected}
            onValueChange={setSelected}
          />
        </PageContent>

        <PageFooter>
          <Button
            className="w-fit"
            type="button"
            size="lg"
            onClick={() => mutate(selected)}
            disabled={isPending}
          >
            {isPending ? t("workspace_list.connecting") : t("secondary_ui.cloud.onboarding.continue_org")}
            <ArrowRight data-icon="inline-end" />
          </Button>
          {onCancel ? (
            <Button
              type="button"
              variant="ghost"
              disabled={isPending}
              onClick={onCancel}
            >
              {t("common.cancel")}
            </Button>
          ) : null}
        </PageFooter>
      </PageContainer>
    </Page>
  );
}

interface OrganizationListProps {
  orgs: DenOrgSummary[];
  value: DenOrgSummary;
  onValueChange: (value: DenOrgSummary) => void;
}

export function OrganizationList({ orgs, value, onValueChange }: OrganizationListProps) {
  const { filtered, query, showMore, updateQuery, visible } = useOrgListWindow(orgs);
  const hasMore = visible.length < filtered.length;

  return (
    <div className="flex flex-col gap-3">
      {orgs.length > 10 ? (
        <Input
          aria-label={t("secondary_ui.cloud.onboarding.search_orgs")}
          placeholder={t("secondary_ui.cloud.onboarding.search_orgs_placeholder")}
          value={query}
          onChange={(event) => updateQuery(event.target.value)}
        />
      ) : null}

      <RadioGroup
        value={value.id}
        onValueChange={(nextOrgId) => {
          const nextOrg = orgs.find((org) => org.id === nextOrgId);
          if (nextOrg) onValueChange(nextOrg);
        }}
        aria-label={t("secondary_ui.cloud.onboarding.orgs")}
      >
        {visible.map((org) => {
          const fieldId = `organization-${org.id}`;

          return (
            <FieldLabel
              key={org.id}
              htmlFor={fieldId}
              className="p-0! transition-colors hover:bg-input/10"
            >
              <Field orientation="horizontal">
                <FieldTitle className="flex min-w-0 items-center gap-4">
                  <BuildingOffice2Icon className="size-6 shrink-0 text-muted-foreground" />
                  <div className="flex min-w-0 flex-col items-start">
                    <span className="max-w-full truncate text-sm font-semibold">
                      {org.name}
                    </span>
                    <span className="max-w-full truncate text-muted-foreground text-xs">
                      {org.slug}
                    </span>
                  </div>
                </FieldTitle>
                <RadioGroupItem
                  value={org.id}
                  id={fieldId}
                  className="group-hover/field-label:bg-foreground/25"
                />
              </Field>
            </FieldLabel>
          );
        })}
      </RadioGroup>

      {filtered.length === 0 && query.trim() ? (
        <div className="text-sm text-muted-foreground">
          {t("secondary_ui.cloud.onboarding.no_match")}
        </div>
      ) : null}

      {hasMore ? (
        <div className="flex flex-col items-start gap-2">
          <Button type="button" variant="outline" size="sm" onClick={showMore}>
            {t("text_activity.show_more")}
          </Button>
          <div className="text-xs text-muted-foreground">
            {t("secondary_ui.cloud.onboarding.showing", { visible: visible.length, total: filtered.length })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

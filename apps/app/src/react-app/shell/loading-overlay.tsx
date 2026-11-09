/** @jsxImportSource react */
import { useEffect, useState } from "react";
import type { RecoveryActionResult, RecoveryRelease } from "@/app/lib/desktop";
import type { DenAppVersionMetadata, DenDesktopConfig } from "@/app/lib/den";
import { readFreshDesktopVersionMetadata } from "@/app/lib/version-gate";
import { useDesktopConfig } from "@/react-app/domains/cloud/desktop-config-provider";
import { bootOverlayCanHide, useBootState, useBootOverlayVisible } from "./boot-state";
import { useCloudWorkspaceStatus } from "./cloud-workspace-overlay";
import { shouldSuppressBootOverlayForGateway } from "./cloud-workspace-status";
import { OwDotTicker } from "./dot-ticker";
import { useOrgOnboardingOnScreen } from "./org-onboarding-visibility";

/**
 * Self-healing update shown on the boot-failure screen: a broken start must
 * still be able to move the app to the newest published release, even when no
 * previous version is installed to restore.
 */
type BootUpdate =
  | { phase: "checking" }
  | { phase: "available"; version: string }
  | { phase: "downloading"; version: string; percent: number }
  | { phase: "ready"; version: string }
  | { phase: "failed"; version: string; reason: string };

async function loadRecoveryPolicy(
  refreshDesktopConfig: () => Promise<DenDesktopConfig>,
): Promise<{ metadata: DenAppVersionMetadata; policy: DenDesktopConfig } | null> {
  const timeout = new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 10_000));
  return Promise.race([
    Promise.all([readFreshDesktopVersionMetadata(), refreshDesktopConfig()])
      .then(([metadata, policy]) => ({ metadata, policy }))
      .catch(() => null),
    timeout,
  ]);
}

/**
 * Quiet, opaque boot overlay. Solid surface fill so nothing bleeds through.
 * A minimal typographic beat plus a small dot ticker. Fades once both the
 * boot hook and the first route load are ready.
 */
export function LoadingOverlay() {
  const visible = useBootOverlayVisible();
  const { phase, routeReady, message, error } = useBootState();
  const cloudWorkspace = useCloudWorkspaceStatus();
  const orgOnboardingOnScreen = useOrgOnboardingOnScreen();
  const suppressForGateway = shouldSuppressBootOverlayForGateway({
    gatewayMode: cloudWorkspace.gatewayMode,
    signedIn: cloudWorkspace.visible,
    variant: cloudWorkspace.viewModel.variant,
  });
  const { config: desktopPolicy, refreshFresh: refreshDesktopPolicy } = useDesktopConfig();
  const [releases, setReleases] = useState<RecoveryRelease[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [actionState, setActionState] = useState<string | null>(null);
  const [bootUpdate, setBootUpdate] = useState<BootUpdate | null>(null);

  useEffect(() => {
    if (!error) return;
    let cancelled = false;
    const bridge = window.__OPENWORK_ELECTRON__?.recovery;
    if (!bridge?.list) return;
    const cachedPolicy = {
      versions: [],
      minimumVersion: "0.0.0",
      ...(Array.isArray(desktopPolicy.allowedDesktopVersions)
        ? { allowedVersions: desktopPolicy.allowedDesktopVersions }
        : {}),
    };
    void bridge.list(cachedPolicy)
      .then((result) => {
        if (!cancelled && result.ok) setReleases(result.releases);
      })
      .catch(() => undefined);
    if (window.__openworkRecoveryControl) {
      return () => {
        cancelled = true;
      };
    }
    void loadRecoveryPolicy(refreshDesktopPolicy)
      .then((fresh) => fresh ? bridge.list?.({
        versions: fresh.metadata.publishedDesktopVersions,
        minimumVersion: fresh.metadata.minAppVersion,
        ...(Array.isArray(fresh.policy.allowedDesktopVersions)
          ? { allowedVersions: fresh.policy.allowedDesktopVersions }
          : {}),
      }) : null)
      .then((result) => {
        if (!cancelled && result?.ok) setReleases(result.releases);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [desktopPolicy, error, refreshDesktopPolicy]);

  const runRecovery = async (action: (() => Promise<RecoveryActionResult>) | undefined) => {
    if (!action) return;
    setActionState("Preparing verified recovery…");
    try {
      const result = await action();
      setActionState(result.ok
        ? result.message ?? "Recovery is ready."
        : result.reason ?? "Recovery could not be started. Please retry.");
    } catch {
      setActionState("Recovery could not be started. Please retry.");
    }
  };

  const useRelease = window.__OPENWORK_ELECTRON__?.recovery?.use;

  // On a failed boot, ask the release feed directly: the app itself may be
  // broken, so recovery cannot wait for the healthy-UI updater poller.
  useEffect(() => {
    if (!error) return;
    const updater = window.__OPENWORK_ELECTRON__?.updater;
    if (!updater?.check) return;
    let cancelled = false;
    setBootUpdate({ phase: "checking" });
    const unsubscribe = updater.onDownloadProgress?.((info) => {
      const percent = Math.round(info.percent ?? (info.total ? ((info.transferred ?? 0) / info.total) * 100 : 0));
      if (!cancelled) setBootUpdate((current) => current?.phase === "downloading" ? { ...current, percent } : current);
    });
    void updater.check()
      .then((result) => {
        if (cancelled) return;
        if (result?.available && result.latestVersion) setBootUpdate({ phase: "available", version: result.latestVersion });
        else setBootUpdate(null);
      })
      .catch(() => { if (!cancelled) setBootUpdate(null); });
    return () => { cancelled = true; unsubscribe?.(); };
  }, [error]);

  const startBootUpdate = async (version: string) => {
    const updater = window.__OPENWORK_ELECTRON__?.updater;
    if (!updater?.download) return;
    setBootUpdate({ phase: "downloading", version, percent: 0 });
    const result = await updater.download().catch((downloadError: unknown) => ({
      ok: false,
      reason: downloadError instanceof Error ? downloadError.message : "The update could not be downloaded.",
    }));
    setBootUpdate(result.ok
      ? { phase: "ready", version }
      : { phase: "failed", version, reason: result.reason ?? "The update could not be downloaded." });
  };

  const finishBootUpdate = () => {
    void window.__OPENWORK_ELECTRON__?.updater?.installAndRestart?.();
  };

  if (!visible || ((suppressForGateway || orgOnboardingOnScreen) && !error)) return null;

  const fading = bootOverlayCanHide(phase, routeReady);

  return (
    <div
      className={`pointer-events-auto fixed inset-0 z-[1000] flex items-center justify-center bg-dls-surface transition-opacity duration-[160ms] ${
        fading ? "opacity-0" : "opacity-100"
      }`}
      aria-live="polite"
      aria-busy={!fading && !error}
      role="status"
    >
      <div className="flex w-full max-w-[320px] flex-col items-center gap-4 px-6 text-center">
        {error ? (
          <div className="flex w-full flex-col gap-3 text-[12px] leading-5">
            <div className="text-base font-medium text-dls-primary">OpenWork couldn't start</div>
            <div className="text-dls-secondary">Reload to try again, or return to a version that works on this computer.</div>
            {bootUpdate ? (
              <div className="flex w-full flex-col gap-2">
                {bootUpdate.phase === "checking" ? (
                  <div className="rounded-md border border-dls-border px-3 py-2 text-dls-secondary" role="status">Checking for a newer version…</div>
                ) : bootUpdate.phase === "available" ? (
                  <button
                    type="button"
                    className="rounded-md bg-dls-accent px-3 py-2 font-medium text-[var(--dls-accent-fg)]"
                    onClick={() => void startBootUpdate(bootUpdate.version)}
                  >
                    Update to {bootUpdate.version} and restart
                  </button>
                ) : bootUpdate.phase === "downloading" ? (
                  <div className="flex w-full flex-col gap-1" role="status">
                    <div className="rounded-md border border-dls-border px-3 py-2 text-dls-secondary">Downloading {bootUpdate.version}… {bootUpdate.percent}%</div>
                    <div className="h-1 w-full overflow-hidden rounded bg-dls-border"><div className="h-full bg-dls-accent transition-[width] duration-150" style={{ width: `${bootUpdate.percent}%` }} /></div>
                  </div>
                ) : bootUpdate.phase === "ready" ? (
                  <button
                    type="button"
                    className="rounded-md bg-dls-accent px-3 py-2 font-medium text-[var(--dls-accent-fg)]"
                    onClick={finishBootUpdate}
                  >
                    Restart to finish updating to {bootUpdate.version}
                  </button>
                ) : (
                  <div className="flex w-full flex-col gap-2">
                    <div className="rounded-md border border-dls-border px-3 py-2 text-dls-secondary">{bootUpdate.reason}</div>
                    <button
                      type="button"
                      className="rounded-md border border-dls-border px-3 py-2 font-medium text-dls-primary"
                      onClick={() => void startBootUpdate(bootUpdate.version)}
                    >
                      Retry update
                    </button>
                  </div>
                )}
              </div>
            ) : null}
            <button
              type="button"
              className="rounded-md border border-dls-border px-3 py-2 font-medium text-dls-primary"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
            <button
              type="button"
              disabled={!releases.some((release) => release.marking === "previous")}
              className="rounded-md bg-dls-accent px-3 py-2 font-medium text-[var(--dls-accent-fg)] disabled:opacity-50"
              onClick={() => void runRecovery(window.__OPENWORK_ELECTRON__?.recovery?.restorePrevious)}
            >
              Restore previous version
            </button>
            <button
              type="button"
              className="rounded-md border border-dls-border px-3 py-2 font-medium text-dls-primary"
              onClick={() => setShowPicker((value) => !value)}
            >
              Pick another version
            </button>
            {showPicker ? (
              <div className="flex flex-col gap-2">
                {releases.map((release) => (
                  <div key={release.id} className="flex items-center gap-2">
                    {release.marking === "current" ? (
                      <div className="flex-1 rounded-md border border-dls-border px-3 py-2 text-left text-dls-secondary">
                        {release.version}
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="flex-1 rounded-md border border-dls-border px-3 py-2 text-left text-dls-primary"
                        onClick={() => void runRecovery(
                          useRelease
                            ? () => useRelease(release.id)
                            : undefined,
                        )}
                      >
                        Use {release.version}
                      </button>
                    )}
                    {release.marking ? <span className="text-dls-secondary">{release.marking}</span> : null}
                  </div>
                ))}
              </div>
            ) : null}
            {actionState ? <div className="text-dls-secondary">{actionState}</div> : null}
            <details className="text-left text-dls-secondary">
              <summary className="cursor-pointer">Technical details</summary>
              <div className="mt-2 break-words" data-testid="boot-error-detail">{error}</div>
            </details>
          </div>
        ) : (
          <>
            <OwDotTicker size="md" />
            <div className="text-[12px] leading-5 text-dls-secondary">
              {message || "Preparing workspace"}
            </div>
            <button
              type="button"
              className="rounded-md border border-dls-border px-3 py-2 text-sm font-medium text-dls-primary"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </>
        )}
      </div>
    </div>
  );
}

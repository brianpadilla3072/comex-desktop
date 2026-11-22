/** @jsxImportSource react */
import { useCallback, useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useExternalDelegatesFeature } from "@/app/lib/external-delegates";
import { createOpenworkServerClient, OpenworkServerError, type DelegateSettings } from "@/app/lib/openwork-server";
import { t } from "@/i18n";
import { resolveOpenworkConnection } from "@/react-app/shell/openwork-connection";
import {
  LayoutSection,
  LayoutSectionHeader,
  LayoutSectionItem,
  LayoutSectionItemDescription,
  LayoutSectionItemHeader,
  LayoutSectionItemHeaderActions,
  LayoutSectionItemTitle,
  LayoutSectionTitle,
} from "../settings-layout";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; settings: DelegateSettings }
  | { status: "owner_only" }
  | { status: "hidden" }
  | { status: "error" };

async function delegatesClient() {
  const connection = await resolveOpenworkConnection();
  if (!connection.normalizedBaseUrl || !connection.resolvedToken) return null;
  return createOpenworkServerClient({ baseUrl: connection.normalizedBaseUrl, token: connection.resolvedToken, hostToken: connection.resolvedHostToken });
}

function loadStateFor(error: unknown): LoadState {
  if (error instanceof OpenworkServerError && error.status === 404) return { status: "hidden" };
  if (error instanceof OpenworkServerError && (error.status === 401 || error.status === 403)) return { status: "owner_only" };
  return { status: "error" };
}

/**
 * Permisos › "Agentes externos": whether the agent that delegates to another
 * agent CLI decides that agent's permission requests itself (decider
 * "orchestrator") or asks the person for risky ones ("person").
 * Owner access only; an operator lock (OPENWORK_DELEGATES_DECIDER) shows as locked.
 */
type DelegatesClient = Pick<ReturnType<typeof createOpenworkServerClient>, "getDelegateSettings" | "setDelegateSettings">;

export function ExternalDelegatesSection({ connect = delegatesClient }: { connect?: () => Promise<DelegatesClient | null> } = {}) {
  const available = useExternalDelegatesFeature();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const client = await connect();
      if (!client) return setState({ status: "owner_only" });
      setState({ status: "ready", settings: await client.getDelegateSettings() });
    } catch (error) {
      setState(loadStateFor(error));
    }
  }, [connect]);

  useEffect(() => {
    if (available) void load();
  }, [available, load]);

  if (!available || state.status === "hidden") return null;

  const save = async (orchestrator: boolean) => {
    if (state.status !== "ready") return;
    const previous = state.settings;
    setSaveFailed(false);
    setSaving(true);
    setState({ status: "ready", settings: { ...previous, decider: orchestrator ? "orchestrator" : "person" } });
    try {
      const client = await connect();
      if (!client) throw new Error("no connection");
      setState({ status: "ready", settings: await client.setDelegateSettings(orchestrator ? "orchestrator" : "person") });
    } catch {
      setState({ status: "ready", settings: previous });
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const locked = state.status === "owner_only" || (state.status === "ready" && state.settings.overriddenBy === "environment");
  const orchestrator = state.status === "ready" && state.settings.decider === "orchestrator";

  return (
    <LayoutSection>
      <LayoutSectionHeader>
        <LayoutSectionTitle>{t("external_delegates.section_title")}</LayoutSectionTitle>
      </LayoutSectionHeader>
      <LayoutSectionItem anchor="external-delegates-decider">
        <LayoutSectionItemHeader>
          <LayoutSectionItemTitle>{t("external_delegates.decider_title")}</LayoutSectionItemTitle>
          <LayoutSectionItemDescription>
            {state.status === "error"
              ? t("external_delegates.load_failed")
              : saveFailed
                ? t("external_delegates.save_failed")
                : state.status === "owner_only"
                  ? <span className="inline-flex items-center gap-1"><Lock className="size-3.5" aria-hidden />{t("external_delegates.owner_only")}</span>
                  : state.status === "ready" && state.settings.overriddenBy === "environment"
                    ? <span className="inline-flex items-center gap-1"><Lock className="size-3.5" aria-hidden />{t("external_delegates.locked_by_environment")}</span>
                    : orchestrator
                      ? t("external_delegates.decider_on")
                      : t("external_delegates.decider_off")}
          </LayoutSectionItemDescription>
          <LayoutSectionItemHeaderActions>
            {state.status === "loading" ? (
              <Skeleton className="h-5 w-9 rounded-full" data-external-delegates-loading />
            ) : state.status === "error" ? (
              <Button variant="outline" size="sm" onClick={() => void load()}>{t("external_delegates.retry")}</Button>
            ) : (
              <Switch
                aria-label={t("external_delegates.decider_title")}
                checked={orchestrator}
                disabled={locked || saving}
                onCheckedChange={(checked) => void save(checked)}
              />
            )}
          </LayoutSectionItemHeaderActions>
        </LayoutSectionItemHeader>
      </LayoutSectionItem>
    </LayoutSection>
  );
}

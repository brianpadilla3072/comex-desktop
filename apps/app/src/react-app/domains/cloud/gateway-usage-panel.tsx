import { useId, useState, type ReactNode } from "react";
import { t } from "@/i18n";
import { CheckCircle2, ChevronRight, Clock, Gauge, LockKeyhole } from "lucide-react";
import { useNavigate } from "react-router";
import type { GatewayUsageBucket, GatewayUsageStatus } from "@openwork/types/den/gateway-usage-limits";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  allGatewayUsageBuckets,
  formatGatewayMoney,
  formatGatewayReset,
  gatewayIncreaseMicroUsd,
  gatewayPercentLeft,
  gatewayPeriodInSentence,
  gatewayPeriodLabel,
  gatewayPeriodPossessive,
  gatewayUsageLimitGroups,
} from "./gateway-usage-state";
import { useGatewayUsage } from "./use-gateway-usage";
import { gatewayApprovalKey, useGatewayApprovalDismissals } from "./gateway-usage-approval-store";
import { UsageLimitCard, UsageLimitLocked, useUsageLimitViewer } from "./usage-limit-card";
import { denDashboardUrl } from "@/app/lib/den-dashboard-links";
import { openAlternativeModelPicker } from "@/app/lib/inference-access";
import { usePlatform } from "@/react-app/kernel/platform";

export const GATEWAY_USAGE_SETTINGS_PATH = "/settings/usage";

export function GatewayResetTime({ value, midSentence = false }: { value: string; midSentence?: boolean }) {
  const text = formatGatewayReset(value, Date.now());
  return <time dateTime={value} title={new Date(value).toLocaleString()}>{midSentence ? `${text.charAt(0).toLocaleLowerCase()}${text.slice(1)}` : text}</time>;
}

function exhausted(bucket: GatewayUsageBucket) {
  return bucket.usedMicroUsd >= bucket.allowanceMicroUsd;
}

function canAsk(bucket: GatewayUsageBucket) {
  return bucket.allowRequestReset && bucket.canRequestReset && bucket.resetRequestStatus !== "pending" && exhausted(bucket);
}

/** The exhausted bucket that keeps a member blocked longest decides what the card says. */
function longestBlock(buckets: GatewayUsageBucket[]) {
  return [...buckets].sort((a, b) => Date.parse(b.resetAt) - Date.parse(a.resetAt))[0];
}

/** The notice card above the composer: what is true, one line of detail, its actions, and an optional inline form. */
export function ComposerNoticeCard({ icon, title, detail, actions, children, testId }: {
  icon: ReactNode; title: ReactNode; detail?: ReactNode; actions?: ReactNode; children?: ReactNode; testId?: string;
}) {
  return (
    <section data-testid={testId} className="mx-auto mb-2 flex w-full max-w-3xl flex-col gap-3 rounded-[14px] border border-border bg-background py-3 pe-3 ps-4">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="flex shrink-0 text-foreground [&_svg]:size-4">{icon}</span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="text-[13px] font-medium leading-5 text-foreground">{title}</h2>
          {detail ? <p className="text-xs leading-4 text-muted-foreground">{detail}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function GatewayIncreaseForm({ pending, error, onSubmit, onCancel }: {
  pending: boolean; error: boolean;
  onSubmit: (reason: string) => void;
  onCancel?: () => void;
}) {
  const [reason, setReason] = useState("");
  const id = useId();
  const trimmed = reason.trim();
  return (
    <form className="flex flex-col gap-2" onSubmit={(event) => {
      event.preventDefault();
      if (!pending && trimmed && trimmed.length <= 2000) onSubmit(trimmed);
    }}>
      <label htmlFor={id} className="text-xs font-medium text-foreground">{t("secondary_ui.cloud.gateway.need_for")}</label>
      <Textarea id={id} required maxLength={2000} value={reason} autoFocus onChange={(event) => setReason(event.target.value)} disabled={pending} className="min-h-16" />
      {error ? <p role="alert" className="text-xs text-muted-foreground">{t("secondary_ui.cloud.gateway.request_unconfirmed")}</p> : null}
      <div className="flex items-center justify-end gap-1">
        {onCancel ? <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onCancel}>{t("common.cancel")}</Button> : null}
        <Button type="submit" size="sm" disabled={pending || !trimmed || trimmed.length > 2000}>{pending ? t("secondary_ui.cloud.gateway.sending") : t("secondary_ui.cloud.gateway.send_request")}</Button>
      </div>
    </form>
  );
}

export function GatewayUsageNotice({ state, status, stale, providerName = null, canSwitchProvider = false, sessionId, messageSaved = false }: {
  state: "blocked" | "over_limit"; status: GatewayUsageStatus; stale: boolean;
  /** Set when the selected model's provider has its own limit. */
  providerName?: string | null;
  /** Another provider the member has still has room. */
  canSwitchProvider?: boolean;
  /** The conversation whose model picker "Use another model" opens. */
  sessionId?: string;
  /** A refused message is kept in the conversation. */
  messageSaved?: boolean;
}) {
  const navigate = useNavigate();
  const platform = usePlatform();
  const usage = useGatewayUsage(true);
  const [asking, setAsking] = useState(false);
  const viewer = useUsageLimitViewer();
  const buckets = status.buckets.filter((bucket) => exhausted(bucket) && (state !== "blocked" || bucket.hardLimit));
  const bucket = longestBlock(buckets);
  if (!bucket) return null;
  const seeUsage = <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => navigate(GATEWAY_USAGE_SETTINGS_PATH)}>{t("secondary_ui.cloud.gateway.see_usage")}</Button>;
  const staleNote = stale ? t("secondary_ui.cloud.gateway.stale_limit") : null;
  const forProvider = providerName ? t("secondary_ui.cloud.gateway.for_provider", { name: providerName }) : "";
  const switchNote = canSwitchProvider ? <span data-testid="gateway-usage-switch-provider"> {t("secondary_ui.cloud.gateway.switch_provider")}</span> : null;

  if (state === "over_limit") {
    return (
      <ComposerNoticeCard testId="gateway-usage-notice" icon={<Gauge />}
        title={t("secondary_ui.cloud.gateway.over_limit", { over: formatGatewayMoney(bucket.usedMicroUsd - bucket.allowanceMicroUsd), possessive: gatewayPeriodPossessive(bucket.timeframe), allowance: formatGatewayMoney(bucket.allowanceMicroUsd), provider: forProvider })}
        detail={staleNote ?? <>{t("secondary_ui.cloud.gateway.keep_working")} <GatewayResetTime value={bucket.resetAt} /></>}
        actions={seeUsage} />
    );
  }

  const pendingBucket = buckets.find((item) => item.resetRequestStatus === "pending");
  if (pendingBucket) {
    return (
      <ComposerNoticeCard testId="gateway-usage-notice" icon={<Clock />}
        title={t("secondary_ui.cloud.gateway.asked_more", { amount: formatGatewayMoney(gatewayIncreaseMicroUsd(pendingBucket)), period: gatewayPeriodInSentence(pendingBucket.timeframe), provider: forProvider })}
        detail={staleNote ?? <>{t("secondary_ui.cloud.gateway.waiting_admin")}{switchNote ? "." : null}{switchNote}</>}
        actions={seeUsage} />
    );
  }

  const askable = longestBlock(buckets.filter(canAsk));
  const amount = askable ? formatGatewayMoney(gatewayIncreaseMicroUsd(askable)) : null;
  if (asking && askable && amount) {
    return (
      <ComposerNoticeCard testId="gateway-usage-notice" icon={<LockKeyhole />}
        title={t("secondary_ui.cloud.gateway.ask_more_period", { amount, period: gatewayPeriodInSentence(askable.timeframe), provider: forProvider })}
        detail={t("secondary_ui.cloud.gateway.admin_reviews")}>
        <div className="ps-7">
          <GatewayIncreaseForm pending={usage.reset.isPending} error={usage.reset.isError}
            onCancel={() => { usage.reset.reset(); setAsking(false); }}
            onSubmit={(reason) => usage.reset.mutate({ bucketId: askable.id, reason }, { onSuccess: () => setAsking(false) })} />
        </div>
      </ComposerNoticeCard>
    );
  }

  // The shared usage-limit card: admins raise the budget, members ask for more, everyone can switch models.
  return (
    <UsageLimitCard testId="gateway-usage-notice" kind="gateway_budget" saved={messageSaved}
      title={t("secondary_ui.cloud.gateway.used_allowance", { possessive: gatewayPeriodPossessive(bucket.timeframe), allowance: formatGatewayMoney(bucket.allowanceMicroUsd), provider: forProvider })}
      reset={staleNote ?? <><GatewayResetTime value={bucket.resetAt} />{switchNote}</>}
      actions={<>
        {viewer.canBuy ? <Button size="sm" onClick={() => platform.openLink(denDashboardUrl(viewer.denBaseUrl, "gatewayLimits"))}>{t("secondary_ui.cloud.gateway.raise_budget")}</Button>
          : askable && amount ? <Button size="sm" disabled={stale} onClick={() => { usage.reset.reset(); setAsking(true); }}>{t("secondary_ui.cloud.gateway.ask_more", { amount })}</Button>
            : <UsageLimitLocked label={t("secondary_ui.cloud.gateway.ask_admin")} reason={t("secondary_ui.cloud.gateway.admin_can_raise")} />}
        {sessionId ? <Button size="sm" variant="ghost" onClick={() => openAlternativeModelPicker(sessionId)}>{t("secondary_ui.cloud.gateway.use_another_model")}</Button> : null}
        {seeUsage}
      </>} />
  );
}

function approvedUsageIncreases(status?: GatewayUsageStatus) {
  return (status ? allGatewayUsageBuckets(status) : []).filter((bucket) => bucket.resetRequestStatus === "approved"
    && bucket.extensionMicroUsd > 0 && Date.parse(bucket.resetAt) > Date.now());
}

export function GatewayUsageApprovalNotice() {
  const usage = useGatewayUsage(true);
  const dismissedKeys = useGatewayApprovalDismissals((state) => state.dismissedKeys);
  const dismiss = useGatewayApprovalDismissals((state) => state.dismiss);
  const scopeKey = usage.approvalScopeKey;
  const approved = scopeKey ? approvedUsageIncreases(usage.data).filter((bucket) =>
    !dismissedKeys.includes(gatewayApprovalKey(JSON.stringify([scopeKey, bucket.extensionMicroUsd]), bucket))) : [];
  if (!usage.active || usage.query.isError || !scopeKey || !approved.length) return null;
  const [first] = approved;
  return (
    <div role="status">
      <ComposerNoticeCard testId="gateway-usage-approved-notice" icon={<CheckCircle2 className="text-green-11" />}
        title={t("secondary_ui.cloud.gateway.got_more", { amount: formatGatewayMoney(first.extensionMicroUsd), period: gatewayPeriodInSentence(first.timeframe) })}
        detail={<>{t("secondary_ui.cloud.gateway.allowance_for_period", { allowance: formatGatewayMoney(first.allowanceMicroUsd), period: gatewayPeriodInSentence(first.timeframe) })} <GatewayResetTime value={first.resetAt} midSentence /></>}
        actions={<Button size="sm" variant="ghost" className="text-muted-foreground" aria-label={t("secondary_ui.cloud.gateway.dismiss_aria")} onClick={() => dismiss(approved.map((bucket) => gatewayApprovalKey(JSON.stringify([scopeKey, bucket.extensionMicroUsd]), bucket)))}>{t("question_modal.dismiss")}</Button>} />
    </div>
  );
}

/** The account menu's quiet summary: how much of each limit is left. */
export function GatewayUsageMenuItem() {
  const navigate = useNavigate();
  const usage = useGatewayUsage(true);
  if (!usage.authorized) return null;
  const groups = usage.data ? gatewayUsageLimitGroups(usage.data) : [];
  // Only label the items when there is more than the default to tell apart.
  const labelled = groups.some((group) => group.providerName !== null);
  return (
    <DropdownMenuItem data-testid="gateway-usage-menu-item" className="flex-col items-stretch gap-0.5" onClick={() => navigate(GATEWAY_USAGE_SETTINGS_PATH)}>
      <span className="flex items-center gap-2">
        <Gauge className="size-3.5" />
        <span className="flex-1">{t("secondary_ui.cloud.gateway.usage")}</span>
        <ChevronRight className="size-3.5 text-muted-foreground" />
      </span>
      {usage.data && !groups.length ? <span className="ps-5.5 text-xs text-muted-foreground">{t("secondary_ui.cloud.gateway.no_limit")}</span> : null}
      {groups.map((group) => (
        <span key={group.key} className={`flex flex-col gap-0.5 ${labelled ? "pt-1" : ""}`} data-testid={group.providerName === null ? "gateway-usage-menu-default" : "gateway-usage-menu-provider"}>
          {labelled ? <span className="truncate ps-5.5 text-xs font-medium text-foreground">{group.providerName ?? t("settings.default_label")}</span> : null}
          {group.buckets.map((bucket) => (
            <span key={bucket.id} className="flex justify-between ps-5.5 text-xs">
              <span className="text-muted-foreground">{gatewayPeriodLabel(bucket.timeframe)}</span>
              <span className="tabular-nums text-foreground">{t("secondary_ui.cloud.gateway.percent_left", { percent: gatewayPercentLeft(bucket) })}</span>
            </span>
          ))}
        </span>
      ))}
    </DropdownMenuItem>
  );
}

function SettingsSection({ title, detail, children, testId }: { title: string; detail?: string; children: ReactNode; testId?: string }) {
  return (
    <section aria-label={title} data-testid={testId} className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
        {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
      </div>
      <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-background">{children}</div>
    </section>
  );
}

function LimitRow({ bucket }: { bucket: GatewayUsageBucket }) {
  const left = gatewayPercentLeft(bucket);
  return (
    <div aria-label={t("secondary_ui.cloud.gateway.period_usage", { period: gatewayPeriodLabel(bucket.timeframe) })} className="flex flex-col gap-2 px-3.5 py-3">
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="text-foreground">{gatewayPeriodLabel(bucket.timeframe)}</span>
        <span className="tabular-nums text-foreground">{t("secondary_ui.cloud.gateway.percent_left", { percent: left })}</span>
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{exhausted(bucket) ? <>{t("secondary_ui.cloud.gateway.used_up")} <GatewayResetTime value={bucket.resetAt} /></> : <GatewayResetTime value={bucket.resetAt} />}</span>
        <span className="tabular-nums">{t("secondary_ui.cloud.gateway.amount_left", { left: formatGatewayMoney(Math.max(0, bucket.allowanceMicroUsd - bucket.usedMicroUsd)), allowance: formatGatewayMoney(bucket.allowanceMicroUsd) })}</span>
      </div>
      <Progress value={left} aria-label={t("secondary_ui.cloud.gateway.percent_of_period_left", { percent: left, period: gatewayPeriodInSentence(bucket.timeframe) })}
        className="gap-0 [&_[data-slot=progress-indicator]]:bg-foreground [&_[data-slot=progress-track]]:h-1" />
    </div>
  );
}

function RequestRow({ bucket, providerName, asking, onAsk, onCancel, onSubmit, pending, error, disabled }: {
  bucket: GatewayUsageBucket; providerName?: string; asking: boolean; pending: boolean; error: boolean; disabled: boolean;
  onAsk: () => void; onCancel: () => void; onSubmit: (reason: string) => void;
}) {
  const amount = formatGatewayMoney(gatewayIncreaseMicroUsd(bucket));
  const state = bucket.resetRequestStatus === "pending" ? <span className="flex items-center gap-1.5 text-foreground"><Clock className="size-3.5" />{t("secondary_ui.cloud.gateway.asked_waiting", { amount })}</span>
    : canAsk(bucket) ? null
      : bucket.resetRequestStatus === "approved" && bucket.extensionMicroUsd > 0 ? <span className="text-foreground">{t("secondary_ui.cloud.gateway.added", { amount: formatGatewayMoney(bucket.extensionMicroUsd) })}</span>
        : bucket.resetRequestStatus === "denied" ? <span className="text-muted-foreground">{t("secondary_ui.cloud.gateway.declined")}</span>
          : <span className="text-muted-foreground">{t("secondary_ui.cloud.gateway.ask_when_out")}</span>;
  return (
    <div aria-label={t("secondary_ui.cloud.gateway.period_increase", { period: gatewayPeriodLabel(bucket.timeframe), provider: providerName ? ` ${providerName}` : "" })} className="flex flex-col gap-3 px-3.5 py-2.5">
      <div className="flex min-h-7 items-center gap-3 text-[13px]">
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="text-foreground">{gatewayPeriodLabel(bucket.timeframe)}</span>
          {providerName ? <span className="truncate text-xs text-muted-foreground">{providerName}</span> : null}
        </span>
        <span className="text-xs">{state ?? (asking ? null : <Button size="sm" disabled={disabled} onClick={onAsk}>{t("secondary_ui.cloud.gateway.ask_more", { amount })}</Button>)}</span>
      </div>
      {asking && !state ? <GatewayIncreaseForm pending={pending} error={error} onCancel={onCancel} onSubmit={onSubmit} /> : null}
    </div>
  );
}

function TechnicalDetails({ status }: { status: GatewayUsageStatus }) {
  const { coverage } = status;
  const rows: [string, ReactNode][] = [];
  if (coverage.trackingStartedAt) rows.push([t("secondary_ui.cloud.gateway.tech_counting_since"), new Date(coverage.trackingStartedAt).toLocaleString()]);
  if (coverage.historicalCoverage === "unknown" || coverage.historicalUnknownReason != null) rows.push([t("secondary_ui.cloud.gateway.tech_spend_before"), t("secondary_ui.cloud.gateway.not_counted")]);
  if (coverage.unpricedRequests > 0) rows.push([t("secondary_ui.cloud.gateway.tech_unpriced"), String(coverage.unpricedRequests)]);
  if ((coverage.incompleteRequests ?? 0) > 0) rows.push([t("secondary_ui.cloud.gateway.tech_incomplete"), String(coverage.incompleteRequests)]);
  if (typeof coverage.pendingRequests === "number" && coverage.pendingRequests > 0) rows.push([t("secondary_ui.cloud.gateway.tech_pending"), String(coverage.pendingRequests)]);
  rows.push([t("secondary_ui.cloud.gateway.tech_running"), t("secondary_ui.cloud.gateway.added_when_finish")]);
  if (coverage.lastSettlementAt) rows.push([t("secondary_ui.cloud.gateway.tech_last_updated"), new Date(coverage.lastSettlementAt).toLocaleString()]);
  return (
    <details className="group text-xs" data-testid="gateway-usage-technical-details">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-muted-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none" />{t("mcp.technical_details")}
      </summary>
      <dl className="flex max-w-sm flex-col gap-2 ps-5 pt-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export function GatewayUsageSettingsView({ onOpenAccount }: { onOpenAccount: () => void }) {
  const usage = useGatewayUsage(true, true);
  const [askingId, setAskingId] = useState<string | null>(null);
  const status = usage.data;
  const groups = status ? gatewayUsageLimitGroups(status) : [];
  const labelled = groups.some((group) => group.providerName !== null);
  const requestable = groups.flatMap((group) => group.buckets.map((bucket) => ({ bucket, providerName: labelled ? group.providerName ?? t("settings.default_label") : undefined })))
    .filter(({ bucket }) => bucket.allowRequestReset);
  const content = !usage.authorized ? (
    <div className="flex flex-col items-start gap-3">
      <p className="text-[13px] text-muted-foreground">{t("secondary_ui.cloud.gateway.sign_in_to_see")}</p>
      <Button size="sm" variant="outline" onClick={onOpenAccount}>{t("secondary_ui.cloud.gateway.open_account")}</Button>
    </div>
  ) : usage.query.isPending ? (
    <div role="status" aria-label={t("secondary_ui.cloud.gateway.loading_limits")} className="flex flex-col gap-3">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-28 w-full rounded-xl" />
    </div>
  ) : !status ? (
    <div className="flex flex-col items-start gap-3" role="alert">
      <p className="text-[13px] text-muted-foreground">{t("secondary_ui.cloud.gateway.load_failed")}</p>
      <Button size="sm" variant="outline" disabled={usage.query.isFetching} onClick={() => void usage.query.refetch()}>{t("session.remote_task_retry")}</Button>
    </div>
  ) : (
    <>
      {usage.query.isError ? (
        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          {t("secondary_ui.cloud.gateway.stale_limits")}
          <Button size="xs" variant="ghost" disabled={usage.query.isFetching} onClick={() => void usage.query.refetch()}>{t("session.remote_task_retry")}</Button>
        </p>
      ) : null}
      {!groups.length ? (
        <SettingsSection title={t("secondary_ui.cloud.gateway.your_limits")}>
          <div className="flex items-center justify-between px-3.5 py-3 text-[13px]"><span className="text-foreground">{t("secondary_ui.cloud.gateway.no_limit")}</span></div>
        </SettingsSection>
      ) : groups.map((group) => (
        <SettingsSection key={group.key}
          testId={group.providerName === null ? "gateway-usage-default-limit" : "gateway-usage-provider-limit"}
          title={!labelled ? t("secondary_ui.cloud.gateway.your_limits") : group.providerName ?? t("settings.default_label")}
          detail={!labelled ? t("secondary_ui.cloud.gateway.set_by_org") : group.providerName === null ? t("secondary_ui.cloud.gateway.providers_without_limit") : t("secondary_ui.cloud.gateway.only_provider", { name: group.providerName })}>
          {group.buckets.map((bucket) => <LimitRow key={bucket.id} bucket={bucket} />)}
        </SettingsSection>
      ))}
      {requestable.length ? (
        <SettingsSection title={t("secondary_ui.cloud.gateway.more_usage")} detail={t("secondary_ui.cloud.gateway.approval_adds")}>
          {requestable.map(({ bucket, providerName }) => (
            <RequestRow key={bucket.id} bucket={bucket} providerName={providerName} asking={askingId === bucket.id}
              pending={usage.reset.isPending} error={usage.reset.isError} disabled={usage.query.isError || usage.reset.isPending}
              onAsk={() => { usage.reset.reset(); setAskingId(bucket.id); }}
              onCancel={() => { usage.reset.reset(); setAskingId(null); }}
              onSubmit={(reason) => usage.reset.mutate({ bucketId: bucket.id, reason }, { onSuccess: () => setAskingId(null) })} />
          ))}
        </SettingsSection>
      ) : null}
      <TechnicalDetails status={status} />
    </>
  );
  return <div data-testid="gateway-usage-settings" className="flex w-full max-w-3xl flex-col gap-8">{content}</div>;
}

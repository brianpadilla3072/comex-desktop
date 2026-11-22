/** @jsxImportSource react */
import { useEffect, useId, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { claimSignInReturnDraft, clearSignInReturnTarget } from "@/app/lib/den-sign-in-return";
import { readDenSettings } from "@/app/lib/den";
import { cloudSessionDraftScope } from "../session/sync/draft-store";
import { carrySignInReturnDraft, hasSignedOutDraft } from "./sign-in-return-draft";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { t } from "@/i18n";
import { useDenAuth } from "./den-auth-provider";
import { ComposerNoticeCard } from "./gateway-usage-panel";
import { useSignInReturnTarget } from "./sign-in-return";
import { useManualSignInCode } from "./use-manual-sign-in-code";

/**
 * Shown above the composer of the conversation a sign-in started from while
 * the browser finishes it. The conversation and its
 * draft stay on screen; the code fallback is always visible, not only after
 * a failure (DESIGN P11).
 */
export function SignInHandoffNotice(props: {
  workspaceId: string | null | undefined;
  sessionId: string | null | undefined;
  hasDraft: boolean;
}) {
  const auth = useDenAuth();
  const target = useSignInReturnTarget();
  const [pasteOpen, setPasteOpen] = useState(false);
  const manual = useManualSignInCode();
  const inputId = useId();
  const attempt = target?.startedAt;
  const { setCode } = manual;
  useEffect(() => {
    // The notice stays mounted with the conversation across sign-out/sign-in.
    // A new attempt must not inherit an open form or an earlier code/error.
    setPasteOpen(false);
    setCode("");
  }, [attempt, setCode]);
  const sessionId = props.sessionId ?? null;
  const workspaceId = props.workspaceId ?? null;
  const sameConversation = target?.sessionId === sessionId
    && (!target.workspaceId || !workspaceId || target.workspaceId === workspaceId);
  const identity = auth.verifiedIdentity;
  const scope = cloudSessionDraftScope(identity);
  if (target && sameConversation && target.signedInAt !== null && !target.draftCarried
    && auth.isSignedIn && identity && scope && hasSignedOutDraft(target)) {
    const organization = readDenSettings().activeOrgName?.trim();
    const account = auth.user?.email ?? auth.user?.name ?? t("secondary_ui.cloud.handoff.this_account");
    return (
      <div role="status" data-testid="sign-in-draft-consent">
        <ComposerNoticeCard icon={null} title={organization ? t("secondary_ui.cloud.handoff.move_draft_org", { account, organization }) : t("secondary_ui.cloud.handoff.move_draft", { account })}>
          <div className="flex flex-wrap items-center gap-1">
            <Button size="sm" onClick={() => {
              if (!carrySignInReturnDraft(identity, { scope, startedAt: target.startedAt })) {
                toast.error(t("secondary_ui.cloud.handoff.move_failed"));
              }
            }}>{t("secondary_ui.cloud.handoff.move")}</Button>
            <Button size="sm" variant="ghost" onClick={() => claimSignInReturnDraft()}>{t("secondary_ui.cloud.handoff.keep")}</Button>
          </div>
        </ComposerNoticeCard>
      </div>
    );
  }
  const visible = Boolean(
    target
      && target.authUrl
      && target.signedInAt === null
      && !auth.isSignedIn
      && target.sessionId === sessionId
      && (!target.workspaceId || !workspaceId || target.workspaceId === workspaceId),
  );
  if (!visible || !target) return null;

  const detail = target.pendingTurn
    ? t("secondary_ui.cloud.handoff.message_saved")
    : props.hasDraft ? t("secondary_ui.cloud.handoff.draft_saved") : undefined;
  const authUrl = target.authUrl;
  const copyLink = () => {
    if (!authUrl) return;
    void navigator.clipboard.writeText(authUrl)
      .then(() => toast.success(t("secondary_ui.cloud.handoff.link_copied")))
      .catch(() => toast.error(t("secondary_ui.cloud.handoff.copy_failed")));
  };

  return (
    <div role="status" data-testid="sign-in-handoff-notice">
      <ComposerNoticeCard
        icon={<LoaderCircle className="animate-spin motion-reduce:animate-none" />}
        title={t("secondary_ui.cloud.handoff.finish")}
        detail={detail}
      >
        <div className="flex flex-wrap items-center gap-1 ps-7">
          {authUrl ? <Button size="sm" variant="outline" onClick={copyLink}>{t("den.copy_signin_link")}</Button> : null}
          <Button size="sm" variant="outline" aria-expanded={pasteOpen}
            onClick={() => setPasteOpen((open) => !open)}>
            {pasteOpen ? t("den.hide_signin_code") : t("den.paste_signin_code")}
          </Button>
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => clearSignInReturnTarget()}>{t("common.cancel")}</Button>
        </div>
        {pasteOpen ? (
          <form
            className="flex flex-col gap-1.5 ps-7"
            onSubmit={(event) => {
              event.preventDefault();
              void manual.submit();
            }}
          >
            <label htmlFor={inputId} className="text-xs text-muted-foreground">{t("den.signin_link_label")}</label>
            <div className="flex items-center gap-2">
              <Input
                id={inputId}
                value={manual.code}
                onChange={(event) => manual.setCode(event.currentTarget.value)}
                placeholder={t("den.signin_link_placeholder")}
                disabled={manual.busy}
                autoFocus
                className="h-8 min-w-0 flex-1"
              />
              <Button type="submit" size="sm" disabled={manual.busy || !manual.code.trim()}>
                {manual.busy ? t("den.finishing") : t("den.finish_signin")}
              </Button>
            </div>
            {manual.error ? <p role="alert" className="text-xs text-destructive">{manual.error}</p> : null}
          </form>
        ) : null}
      </ComposerNoticeCard>
    </div>
  );
}

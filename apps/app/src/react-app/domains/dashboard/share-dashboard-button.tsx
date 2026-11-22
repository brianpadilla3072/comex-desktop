import { useRef, useState, type FormEvent } from "react";
import { t } from "@/i18n";
import { Check, Loader2, Share2 } from "lucide-react";
import type { SavedAppSummary } from "@openwork/types/workflows";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAppsClient } from "../apps/use-apps";
import { DenApiError, readDenSettings } from "@/app/lib/den";
import { DenReauthNotice } from "../cloud/den-reauth-notice";

export function ShareDashboardButton({ apps }: { apps: SavedAppSummary[] }) {
  const { canManage } = useAppsClient();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const commitSession = useRef<(() => void) | null>(null);
  const close = () => {
    setOpen(false);
    const commit = commitSession.current;
    commitSession.current = null;
    commit?.();
  };
  if (!canManage) return null;
  return <Dialog open={open} onOpenChange={(next) => { if (!pending) { if (next) setOpen(true); else close(); } }}>
    <Button variant="outline" onClick={() => setOpen(true)}><Share2 className="size-4" />{t("extensions.add_plugin_share")}</Button>
    {open ? <DialogContent className="max-h-[90dvh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{t("secondary_ui.dashboard.share.title")}</DialogTitle>
        <DialogDescription>{t("secondary_ui.dashboard.share.description")}</DialogDescription>
      </DialogHeader>
      <ShareDashboardForm apps={apps.filter((app) => app.canManage)} pending={pending} setPending={setPending} onClose={close}
        onVerifiedSession={(commit) => { commitSession.current = commit; }} />
    </DialogContent> : null}
  </Dialog>;
}

function ShareDashboardForm({ apps, pending, setPending, onClose, onVerifiedSession }: {
  apps: SavedAppSummary[];
  pending: boolean;
  setPending: (pending: boolean) => void;
  onClose: () => void;
  onVerifiedSession: (commit: () => void) => void;
}) {
  const { client, orgId } = useAppsClient();
  const [email, setEmail] = useState("");
  const [selected, setSelected] = useState(() => new Set(apps.map((app) => app.view.id)));
  const [shared, setShared] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [needsReauth, setNeedsReauth] = useState(false);
  const submitting = useRef(false);
  const verifiedClient = useRef<typeof client>(null);
  const share = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !orgId || submitting.current || needsReauth) return;
    await shareApps(verifiedClient.current ?? client);
  };
  const shareApps = async (sharingClient: NonNullable<typeof client>) => {
    if (!orgId) return;
    submitting.current = true;
    setPending(true);
    setNeedsReauth(false);
    setError(null);
    const settings = readDenSettings();
    try {
      for (const app of apps.filter((app) => selected.has(app.view.id) && !shared.includes(app.view.id))) {
        const current = readDenSettings();
        if (current.baseUrl !== settings.baseUrl || current.authToken !== settings.authToken || current.activeOrgId !== orgId) {
          throw new Error(t("secondary_ui.dashboard.share.account_changed"));
        }
        await sharingClient.shareSavedApp(orgId, app.view.id, email.trim());
        setShared((current) => [...current, app.view.id]);
      }
      setComplete(true);
    } catch (cause) {
      if (cause instanceof DenApiError && cause.status === 403 && cause.code === "reauth") {
        setNeedsReauth(true);
      } else {
        setError(cause instanceof Error ? cause.message : t("secondary_ui.dashboard.share.failed"));
      }
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };
  if (!apps.length) return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">{t("secondary_ui.dashboard.share.none_manageable")}</p>
    <Button variant="outline" onClick={onClose}>{t("mcp.auth.done")}</Button>
  </div>;
  if (complete) return <div className="space-y-4">
    <p role="status" className="text-sm">{t("secondary_ui.dashboard.share.complete", { count: shared.length, email: email.trim() })}</p>
    <Button onClick={onClose}>{t("mcp.auth.done")}</Button>
  </div>;
  return <form className="space-y-4" onSubmit={(event) => void share(event)}>
    <label className="block space-y-2 text-sm font-medium">
      <span>{t("secondary_ui.dashboard.share.email")}</span>
      <Input type="email" autoComplete="email" placeholder="teammate@company.com" required maxLength={320} value={email}
        disabled={pending || needsReauth || shared.length > 0} onChange={(event) => setEmail(event.target.value)} />
    </label>
    <fieldset disabled={pending || needsReauth} className="space-y-2">
      <legend className="mb-2 text-sm font-medium">{t("secondary_ui.dashboard.share.artifacts")}</legend>
      <div className="max-h-60 space-y-2 overflow-auto">
        {apps.map((app) => <label key={app.view.id} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
          <input type="checkbox" className="size-4" checked={selected.has(app.view.id)} disabled={shared.includes(app.view.id)}
            onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(app.view.id); else next.delete(app.view.id); return next; })} />
          <span className="min-w-0 flex-1 break-words">{app.view.title}</span>
          {shared.includes(app.view.id) ? <span className="flex items-center gap-1 text-xs"><Check className="size-3.5" />{t("secondary_ui.dashboard.share.shared")}</span> : null}
        </label>)}
      </div>
    </fieldset>
    <p className="text-xs text-muted-foreground">{t("secondary_ui.dashboard.share.access_note")}</p>
    {error ? <p role="alert" className="text-sm text-destructive">{error} {t("secondary_ui.dashboard.share.partial")}</p> : null}
    {needsReauth ? <DenReauthNotice onVerified={async (nextClient, commit) => {
      verifiedClient.current = nextClient;
      onVerifiedSession(commit);
      await shareApps(nextClient);
    }} onCancel={() => setNeedsReauth(false)} /> : null}
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" disabled={pending} onClick={onClose}>{t("common.cancel")}</Button>
      <Button type="submit" disabled={pending || needsReauth || !selected.size || !email.trim() || !client || !orgId}>
        {pending ? <><Loader2 className="size-4 animate-spin" />{t("secondary_ui.dashboard.share.sharing")}</> : t("secondary_ui.dashboard.share.submit")}
      </Button>
    </div>
  </form>;
}

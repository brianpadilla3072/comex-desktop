import { Loader2 } from "lucide-react";
import { t } from "@/i18n";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DenApiError, createDenClient, readDenSettings } from "@/app/lib/den";
import { denSettingsChangedEvent } from "@/app/lib/den-session-events";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { SecretField, type SecretFieldHandle } from "@/components/secret-field";

type Request = { generation: number; connectionId: string; connectionName: string; replacing: boolean; finish: (connected: boolean) => void };
let requestGeneration = 0;
let request: Request | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** UI intent only. The credential is sent through the existing Den client. */
export function openMemberApiKeyDialog(connectionId: string, options: { connectionName: string; replacing?: boolean }): Promise<boolean> {
  request?.finish(false);
  return new Promise((finish) => { request = { generation: ++requestGeneration, connectionId, connectionName: options.connectionName, replacing: options.replacing === true, finish }; notify(); });
}

function errorMessage(error: unknown): string {
  if (error instanceof DenApiError) {
    if (error.status === 400) return t("secondary_ui.cloud.member_key.rejected");
    if (error.status === 403) return t("secondary_ui.cloud.member_key.forbidden");
    if (error.status === 404) return t("secondary_ui.cloud.member_key.gone");
    if (error.status === 409) return t("secondary_ui.cloud.member_key.conflict");
  }
  return t("secondary_ui.cloud.member_key.unknown");
}

function Prompt({ target, close }: { target: Request; close: (connected: boolean) => void }) {
  const field = useRef<SecretFieldHandle>(null);
  const generation = useRef(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasValue, setHasValue] = useState(false);

  useEffect(() => {
    const run = ++generation.current;
    const initial = readDenSettings();
    const changed = () => {
      const next = readDenSettings();
      if (initial.baseUrl !== next.baseUrl || initial.apiBaseUrl !== next.apiBaseUrl
        || initial.activeOrgId !== next.activeOrgId || initial.authToken !== next.authToken) {
        field.current?.clear();
        close(false);
      }
    };
    window.addEventListener(denSettingsChangedEvent, changed);
    return () => {
      generation.current++;
      window.removeEventListener(denSettingsChangedEvent, changed);
    };
  }, [close]);

  const submit = async () => {
    if (pending || !field.current) return;
    const run = generation.current;
    let apiKey = field.current.take();
    if (!/^[\x21-\x7e]{1,8192}$/.test(apiKey)) { apiKey = ""; setError(t("secondary_ui.cloud.member_key.raw_only")); return; }
    const settings = readDenSettings();
    const organizationId = settings.activeOrgId?.trim() ?? "";
    const token = settings.authToken?.trim() ?? "";
    if (!token || !organizationId) { apiKey = ""; setError(t("secondary_ui.cloud.member_key.sign_in_first")); return; }
    setPending(true);
    setError(null);
    try {
      await createDenClient({ baseUrl: settings.baseUrl, token }).setMyMcpCredential(organizationId, target.connectionId, apiKey);
      apiKey = "";
      if (generation.current !== run) return;
      close(true);
    } catch (cause) {
      apiKey = "";
      if (generation.current === run) setError(errorMessage(cause));
    } finally {
      apiKey = "";
      if (generation.current === run) setPending(false);
    }
  };

  return <Dialog open onOpenChange={(open) => { if (!open) close(false); }}>
    <DialogContent data-testid="member-api-key-dialog" data-ph-no-capture="true">
      <DialogHeader>
        <DialogTitle>{target.replacing ? t("secondary_ui.cloud.member_key.replace_title", { name: target.connectionName }) : t("secondary_ui.cloud.member_key.add_title", { name: target.connectionName })}</DialogTitle>
        <DialogDescription className="sr-only">{t("secondary_ui.cloud.member_key.description")}</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <SecretField id="member-api-key-input" testId="member-api-key-input" label={t("secondary_ui.cloud.member_key.label")}
          handleRef={field} disabled={pending} error={error} autoFocus
          onValueChange={setHasValue} onSubmit={() => void submit()} />
      </FieldGroup>
      <DialogFooter>
        <Button variant="outline" disabled={pending} onClick={() => close(false)}>{t("common.cancel")}</Button>
        <Button disabled={pending || !hasValue} onClick={() => void submit()}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {t("connections_ui.save_key")}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

const closePrompt = (connected: boolean) => {
  const current = request;
  request = null;
  notify();
  current?.finish(connected);
};

export function MemberApiKeyDialog() {
  const target = useSyncExternalStore(subscribe, () => request, () => null);
  return target ? <Prompt key={target.generation} target={target} close={closePrompt} /> : null;
}

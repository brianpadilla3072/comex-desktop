/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyIcon } from "lucide-react";

import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import { isDesktopRuntime } from "@/app/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/i18n";
import { useLocal } from "@/react-app/kernel/local-provider";
import { describeError } from "./pair-device-errors";
import { setRemotePairingSetupPending } from "./remote-pairing-setup-state";

const pairingStatusKey = (client: OpenworkServerClient | null) => ["settings", "pairing-status", client?.baseUrl] as const;

/** First-run setup for a reusable remote pairing code. Desktop only; dev already has a default. */
export function RemotePairingSetup({ client }: { client: OpenworkServerClient | null }) {
  const queryClient = useQueryClient();
  const local = useLocal();
  const [generated, setGenerated] = useState<{ code: string; createdAt: number } | null>(null);
  const [customCode, setCustomCode] = useState("");
  const [copied, setCopied] = useState(false);
  const status = useQuery({
    queryKey: pairingStatusKey(client),
    queryFn: () => {
      if (!client) throw new Error(t("pairing.failed"));
      return client.getPairingStatus();
    },
    enabled: client !== null && isDesktopRuntime(),
    retry: false,
  });
  const create = useMutation({
    mutationFn: () => {
      if (!client) throw new Error(t("pairing.failed"));
      return client.createRemotePairingCode(customCode.trim() || undefined);
    },
    onSuccess: (result) => {
      setGenerated(result);
      setCopied(false);
      void queryClient.invalidateQueries({ queryKey: pairingStatusKey(client) });
    },
  });

  const needsSetup = Boolean(
    isDesktopRuntime()
    && client
    && status.data?.enabled
    && status.data.remoteCodeEnabled
    && !status.data.remoteCodeConfigured
    && status.data.remoteCodeSource === "none"
    && !local.prefs.hasCompletedRemotePairingSetup,
  );
  const open = needsSetup || generated !== null;

  useEffect(() => {
    setRemotePairingSetupPending(open);
    return () => setRemotePairingSetupPending(false);
  }, [open]);

  const skip = () => {
    local.setPrefs((previous) => ({ ...previous, hasCompletedRemotePairingSetup: true }));
  };
  const finish = () => {
    setGenerated(null);
    skip();
  };
  const copy = async () => {
    if (!generated) return;
    try {
      await navigator.clipboard.writeText(generated.code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  if (!isDesktopRuntime() || !client) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !generated) skip();
      }}
    >
      <DialogContent data-testid="remote-pairing-setup" showCloseButton={generated === null} style={{ animation: "none" }}>
        <DialogHeader>
          <DialogTitle>{generated ? t("pairing.remote.ready_title") : t("pairing.remote.setup_title")}</DialogTitle>
          <DialogDescription>{generated ? t("pairing.remote.ready_desc") : t("pairing.remote.setup_desc")}</DialogDescription>
        </DialogHeader>
        {generated ? (
          <div className="grid gap-3">
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={generated.code}
                aria-label={t("pairing.code_label")}
                className="font-mono text-lg tracking-widest"
                data-remote-pairing-code
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button type="button" variant="outline" size="icon" onClick={() => void copy()} aria-label={t("pairing.remote.copy")}>
                <CopyIcon className="size-4" />
              </Button>
            </div>
            <p role="status" className="text-xs text-muted-foreground">{copied ? t("pairing.remote.copied") : t("pairing.remote.rotate_warning")}</p>
          </div>
        ) : (
          <div className="grid gap-2">
            <Label htmlFor="remote-pairing-code">{t("pairing.remote.code_label")}</Label>
            <Input
              id="remote-pairing-code"
              value={customCode}
              onChange={(event) => setCustomCode(event.target.value)}
              placeholder={t("pairing.remote.code_placeholder")}
              autoComplete="off"
              spellCheck={false}
              maxLength={128}
              className="font-mono"
            />
          </div>
        )}
        {create.error ? <p role="alert" className="text-sm text-destructive">{describeError(create.error)}</p> : null}
        <DialogFooter>
          {generated ? (
            <Button type="button" onClick={finish}>{t("pairing.remote.done")}</Button>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={skip}>{t("pairing.remote.skip")}</Button>
              <Button type="button" disabled={create.isPending} onClick={() => create.mutate()}>
                {create.isPending ? t("pairing.remote.creating") : t("pairing.remote.save")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

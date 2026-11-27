/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import { isDesktopRuntime } from "@/app/utils";
import { t } from "@/i18n";
import { describeError } from "@/react-app/shell/pair-device-errors";
import {
  LayoutSection,
  LayoutSectionDescription,
  LayoutSectionHeader,
  LayoutSectionItem,
  LayoutSectionItemDescription,
  LayoutSectionItemHeader,
  LayoutSectionItemHeaderActions,
  LayoutSectionItemTitle,
  LayoutSectionTitle,
} from "../settings-layout";

function requireClient(client: OpenworkServerClient | null): OpenworkServerClient {
  if (!client) throw new Error(t("pairing.failed"));
  return client;
}

const devicesKey = (client: OpenworkServerClient) => ["settings", "paired-devices", client.baseUrl] as const;

function useSecondsLeft(expiresAt: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);
  return expiresAt ? Math.max(0, Math.ceil((expiresAt - now) / 1000)) : 0;
}

/** Settings › Advanced › Devices: show a one-time code for another device and revoke paired ones
 *  (docs/features/remote-device-pairing). Hidden when the feature is off or access is read-only. */
export function DevicesSection({ client }: { client: OpenworkServerClient | null }) {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["settings", "pairing-status", client?.baseUrl], queryFn: () => requireClient(client).getPairingStatus(), enabled: client !== null, retry: false });
  const devices = useQuery({ queryKey: client ? devicesKey(client) : ["settings", "paired-devices", null], queryFn: () => requireClient(client).listPairedDevices(), enabled: client !== null && status.data?.enabled === true, retry: false });
  const [pending, setPending] = useState<{ code: string; expiresAt: number } | null>(null);
  const [remotePending, setRemotePending] = useState<{ code: string; createdAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const secondsLeft = useSecondsLeft(pending?.expiresAt ?? null);
  const expired = pending !== null && secondsLeft === 0;

  const create = useMutation({
    mutationFn: () => requireClient(client).createPairingCode(),
    onSuccess: (code) => { setError(null); setPending(code); },
    onError: (cause) => setError(describeError(cause)),
  });
  const createRemote = useMutation({
    mutationFn: () => requireClient(client).createRemotePairingCode(),
    onSuccess: (code) => {
      setError(null);
      setRemotePending(code);
      void queryClient.invalidateQueries({ queryKey: ["settings", "pairing-status", client?.baseUrl] });
    },
    onError: (cause) => setError(describeError(cause)),
  });
  const removeRemote = useMutation({
    mutationFn: () => requireClient(client).deleteRemotePairingCode(),
    onSuccess: () => {
      setRemotePending(null);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["settings", "pairing-status", client?.baseUrl] });
    },
    onError: (cause) => setError(describeError(cause)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => requireClient(client).revokePairedDevice(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: client ? devicesKey(client) : [] }),
    onError: (cause) => setError(describeError(cause)),
  });

  // After the code is used (a new device appears) or expires, refresh the list.
  useEffect(() => {
    if (!pending || !client) return;
    const timer = window.setInterval(() => void queryClient.invalidateQueries({ queryKey: devicesKey(client) }), 3000);
    return () => window.clearInterval(timer);
  }, [client, pending, queryClient]);

  if (!client) return null;
  if (status.isError) return <LayoutSection id="advanced-devices">
    <LayoutSectionHeader>
      <LayoutSectionTitle>{t("pairing.section_title")}</LayoutSectionTitle>
      <LayoutSectionDescription>{describeError(status.error)}</LayoutSectionDescription>
    </LayoutSectionHeader>
    <LayoutSectionItem>
      <LayoutSectionItemHeader>
        <LayoutSectionItemTitle>{t("pairing.remote.delete")}</LayoutSectionItemTitle>
        <LayoutSectionItemDescription>{t("pairing.remote.delete_confirm")}</LayoutSectionItemDescription>
        <LayoutSectionItemHeaderActions>
          <Button variant="ghost" disabled={removeRemote.isPending} onClick={() => removeRemote.mutate()}>{t("pairing.remote.delete")}</Button>
        </LayoutSectionItemHeaderActions>
      </LayoutSectionItemHeader>
      {removeRemote.error ? <p role="alert" className="text-xs text-destructive">{describeError(removeRemote.error)}</p> : null}
    </LayoutSectionItem>
  </LayoutSection>;
  // Without owner access the list answers 401: nothing to manage from here.
  if (status.data?.enabled !== true || devices.isError) return null;
  const remoteCodeActive = status.data.remoteCodeConfigured || status.data.remoteCodeSource === "development";
  const link = !isDesktopRuntime() && pending ? `${window.location.origin}/pair?code=${encodeURIComponent(pending.code)}` : null;

  return <LayoutSection id="advanced-devices">
    <LayoutSectionHeader>
      <LayoutSectionTitle>{t("pairing.section_title")}</LayoutSectionTitle>
      <LayoutSectionDescription>{t("pairing.section_desc")}</LayoutSectionDescription>
    </LayoutSectionHeader>
    {status.data.remoteCodeEnabled ? <LayoutSectionItem anchor="remote-pairing-code">
      <LayoutSectionItemHeader>
        <LayoutSectionItemTitle>{remoteCodeActive ? t("pairing.remote.configured") : t("pairing.remote.not_configured")}</LayoutSectionItemTitle>
        <LayoutSectionItemDescription>{status.data.remoteCodeSource === "development" ? t("pairing.remote.development") : t("pairing.remote.rotate_warning")}</LayoutSectionItemDescription>
        <LayoutSectionItemHeaderActions>
          <Button variant="outline" disabled={createRemote.isPending} onClick={() => createRemote.mutate()}>
            {remoteCodeActive ? t("pairing.remote.rotate") : t("pairing.remote.create")}
          </Button>
        </LayoutSectionItemHeaderActions>
      </LayoutSectionItemHeader>
      {remotePending ? <div className="grid gap-1 rounded-md border p-3" data-remote-pairing-code>
        <span className="font-mono text-2xl tracking-widest" aria-label={t("pairing.code_label")}>{remotePending.code}</span>
        <span role="status" className="text-xs text-muted-foreground">{t("pairing.remote.ready_desc")}</span>
      </div> : null}
    </LayoutSectionItem> : null}
    {status.data.remoteCodeEnabled && status.data.remoteCodeSource === "stored" ? <LayoutSectionItem>
      <LayoutSectionItemHeader>
        <LayoutSectionItemTitle>{t("pairing.remote.delete")}</LayoutSectionItemTitle>
        <LayoutSectionItemDescription>{t("pairing.remote.delete_confirm")}</LayoutSectionItemDescription>
        <LayoutSectionItemHeaderActions>
          <Button variant="ghost" disabled={removeRemote.isPending} onClick={() => void (async () => {
            if (await confirmDialog({ title: t("pairing.remote.delete_confirm"), confirmLabel: t("pairing.remote.delete"), destructive: true })) removeRemote.mutate();
          })()}>{t("pairing.remote.delete")}</Button>
        </LayoutSectionItemHeaderActions>
      </LayoutSectionItemHeader>
    </LayoutSectionItem> : null}
    <LayoutSectionItem anchor="connect-device">
      <LayoutSectionItemHeader>
        <LayoutSectionItemTitle>{t("pairing.connect_title")}</LayoutSectionItemTitle>
        <LayoutSectionItemDescription>{t("pairing.connect_desc")}</LayoutSectionItemDescription>
        <LayoutSectionItemHeaderActions>
          <Button variant="outline" disabled={create.isPending} onClick={() => create.mutate()}>{pending ? t("pairing.new_code") : t("pairing.connect_button")}</Button>
        </LayoutSectionItemHeaderActions>
      </LayoutSectionItemHeader>
      {pending ? <div className="grid gap-1 rounded-md border p-3" data-pairing-code>
        <span className="font-mono text-2xl tracking-widest" aria-label={t("pairing.code_label")}>{expired ? "—" : pending.code}</span>
        <span role="status" className="text-xs text-muted-foreground">{expired ? t("pairing.code_expired") : t("pairing.code_expires", { seconds: secondsLeft })}</span>
        {link && !expired ? <span className="break-all text-xs text-muted-foreground">{link}</span> : null}
      </div> : null}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </LayoutSectionItem>
    <LayoutSectionItem>
      <LayoutSectionItemTitle>{t("pairing.devices_title")}</LayoutSectionItemTitle>
      {devices.data?.items.length ? <ul className="grid gap-2">
        {devices.data.items.map(device => <li key={device.id} className="flex items-center justify-between gap-2 text-sm">
          <span className="min-w-0 truncate">{device.name} <span className="text-xs text-muted-foreground">· {new Date(device.createdAt).toLocaleDateString()}</span></span>
          <Button size="sm" variant="ghost" disabled={revoke.isPending} onClick={() => void (async () => {
            if (await confirmDialog({ title: t("pairing.revoke_confirm", { name: device.name }), confirmLabel: t("pairing.revoke"), destructive: true })) revoke.mutate(device.id);
          })()}>{t("pairing.revoke")}</Button>
        </li>)}
      </ul> : <p className="text-xs text-muted-foreground">{t("pairing.devices_empty")}</p>}
    </LayoutSectionItem>
  </LayoutSection>;
}

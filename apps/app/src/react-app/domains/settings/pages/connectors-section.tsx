/** @jsxImportSource react */
import { Loader2, Plug, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { t } from "../../../../i18n";
import { useOrgMcpConnections } from "../../connections/use-org-mcp-connections";
import { resolveOrgMcpConnectionCardState } from "../../connections/use-org-mcp-connections";
import type { DenExternalMcpConnection } from "../../../../app/lib/den";

export type ConnectorsSectionProps = {
  className?: string;
  title?: string;
  description?: string;
  /** Optional override; defaults to the hook's own connections. */
  connections?: DenExternalMcpConnection[];
};

function isReconnect(connection: DenExternalMcpConnection) {
  return connection.credentialMode === "per_member" && connection.connectedForMe && (connection.needsReconnect === true || connection.credentialHealth === "reconnect_required");
}

export function ConnectorsSection(props: ConnectorsSectionProps) {
  const hook = useOrgMcpConnections();
  const connections = props.connections ?? hook.connections;
  const loading = hook.loading;
  const error = hook.error;
  const connectingId = hook.connectingId;
  const disconnectingId = hook.disconnectingId;

  const handleConnect = (connection: DenExternalMcpConnection) => {
    if (isReconnect(connection)) {
      void hook.connect(connection.id, { forceFreshAuthorization: true });
    } else {
      void hook.connect(connection.id);
    }
  };

  const handleDisconnect = (connection: DenExternalMcpConnection) => {
    void hook.disconnect(connection.id);
  };

  return (
    <section data-testid="connectors-section" className={props.className ?? "space-y-4"}>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="text-sm font-medium text-dls-text">
            {props.title ?? "Connectors"}
          </div>
          <div className="text-xs text-dls-secondary">
            {props.description ?? "Organization connectors and their connection status."}
          </div>
        </div>
        <Button variant="outline" size="xs" onClick={() => void hook.refresh()} disabled={loading}>
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          {t("common.refresh")}
        </Button>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-7/40 bg-red-7/10 p-3 text-xs text-red-11">
          {error}
        </div>
      ) : null}

      {loading && connections.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-dls-secondary">
          <Loader2 size={14} className="animate-spin" />
          {"Loading…"}
        </div>
      ) : null}

      {!loading && connections.length === 0 ? (
        <div className="rounded-xl border border-dls-border bg-dls-surface/40 p-4 text-sm text-dls-secondary">
          {"No connectors available."}
        </div>
      ) : null}

      <div className="grid gap-2">
        {connections.map((connection) => {
          const cardState = resolveOrgMcpConnectionCardState(connection);
          const connected = cardState.connected;
          const isShared = connection.credentialMode === "shared";
          const busy = connectingId === connection.id || disconnectingId === connection.id;
          const statusLabel = connected
            ? t("mcp.org_connection_connected_label")
            : isReconnect(connection)
              ? t("mcp.org_connection_reconnect_action")
              : t("mcp.org_connection_connect_action");

          return (
            <div
              key={connection.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-dls-border bg-dls-surface/40 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Plug size={14} className="shrink-0 text-dls-secondary" />
                  <span className="truncate text-sm font-medium text-dls-text">{connection.name}</span>
                  <span
                    className={
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide " +
                      (connected
                        ? "bg-green-7/10 text-green-11 border border-green-7/20"
                        : "bg-gray-4/60 text-gray-11 border border-gray-7/50")
                    }
                  >
                    {connected ? t("status.connected") : t("status.disconnected_label")}
                  </span>
                </div>
                <div className="mt-1 truncate text-xs text-dls-secondary">
                  {t(cardState.descriptionKey)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {isShared ? (
                  <span className="text-[10px] uppercase tracking-wide text-dls-secondary">
                    {t("mcp.org_connection_managed_label")}
                  </span>
                ) : connected ? (
                  <Button
                    data-testid={`connector-disconnect-${connection.id}`}
                    variant="outline"
                    size="xs"
                    disabled={busy}
                    onClick={() => handleDisconnect(connection)}
                  >
                    {busy ? <Loader2 size={12} className="animate-spin" /> : null}
                    {"Disconnect"}
                  </Button>
                ) : (
                  <Button
                    data-testid={`connector-connect-${connection.id}`}
                    variant="default"
                    size="xs"
                    disabled={busy}
                    onClick={() => handleConnect(connection)}
                  >
                    {busy ? <Loader2 size={12} className="animate-spin" /> : null}
                    {statusLabel}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
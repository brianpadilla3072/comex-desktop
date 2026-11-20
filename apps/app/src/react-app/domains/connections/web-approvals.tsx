/** @jsxImportSource react */
import { Check, ShieldAlert, ShieldCheck, X, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import {
  createOpenworkServerClient,
  OpenworkServerError,
  type OpenworkPendingApproval,
} from "@/app/lib/openwork-server";
import { resolveOpenworkConnection } from "@/react-app/shell/openwork-connection";

/**
 * Web approvals (`webApprovals`): `openwork-server web` keeps manual approvals
 * and this responder answers them in the browser. Owner access (the host token
 * or a paired device) lists and answers pending writes; collaborator access
 * cannot, so it gets a notice instead of silent waits.
 */

export type WebApprovalsClient = {
  status: () => Promise<{ approval?: { mode: "manual" | "auto" } }>;
  listApprovals: () => Promise<{ items: OpenworkPendingApproval[] }>;
  respondApproval: (id: string, reply: "allow" | "deny") => Promise<{ ok: boolean; allowed: boolean }>;
};

export type WebApprovalsState =
  | { kind: "idle" }
  | { kind: "owner"; items: OpenworkPendingApproval[] }
  | { kind: "read-only" };

const POLL_MS = 3_000;

// Translated titles for the actions `openwork-server` gates behind an approval
// (`requireApproval` in apps/server). The server's summary is English, so it is
// only shown, with the raw action code, for an action this map does not know.
const ACTION_TITLE_KEYS: Record<string, string> = {
  "workspace.files.session.ops": "web_approvals.action_files_session_ops",
  "workspace.file.write": "web_approvals.action_file_write",
  "cloud_plugins.remove": "web_approvals.action_cloud_plugins_remove",
  "config.write": "web_approvals.action_config_write",
  "config.patch": "web_approvals.action_config_write",
  "config.global.write": "web_approvals.action_config_global_write",
  "config.authorized_folders.write": "web_approvals.action_authorized_folders_write",
  "plugins.add": "web_approvals.action_plugins_add",
  "plugins.remove": "web_approvals.action_plugins_remove",
  "skills.upsert": "web_approvals.action_skills_upsert",
  "skills.delete": "web_approvals.action_skills_delete",
  "mcp.add": "web_approvals.action_mcp_add",
  "mcp.remove": "web_approvals.action_mcp_remove",
  "mcp.auth.remove": "web_approvals.action_mcp_auth_remove",
  "commands.upsert": "web_approvals.action_commands_upsert",
  "commands.delete": "web_approvals.action_commands_delete",
};

/** What a card says about an approval: a translated title, or the server's own words and code. */
export function describeWebApproval(item: Pick<OpenworkPendingApproval, "action" | "summary">): { title: string; code: string | null } {
  const key = Object.hasOwn(ACTION_TITLE_KEYS, item.action) ? ACTION_TITLE_KEYS[item.action] : undefined;
  if (key) return { title: t(key), code: null };
  return { title: item.summary, code: item.action };
}

/** One poll: nothing to do unless the server waits for manual approvals. */
export async function loadWebApprovals(client: WebApprovalsClient): Promise<WebApprovalsState> {
  const status = await client.status();
  if (status.approval?.mode !== "manual") return { kind: "idle" };
  try {
    const { items } = await client.listApprovals();
    return { kind: "owner", items };
  } catch (error) {
    if (error instanceof OpenworkServerError && (error.status === 401 || error.status === 403)) return { kind: "read-only" };
    throw error;
  }
}

/** Answers one approval. An approval that already expired or was answered elsewhere counts as done. */
export async function answerWebApproval(client: WebApprovalsClient, id: string, reply: "allow" | "deny"): Promise<void> {
  try {
    await client.respondApproval(id, reply);
  } catch (error) {
    if (error instanceof OpenworkServerError && error.status === 404) return;
    throw error;
  }
}

type PanelProps = {
  state: WebApprovalsState;
  busyId?: string | null;
  error?: string | null;
  noticeDismissed?: boolean;
  onRespond?: (id: string, reply: "allow" | "deny") => void;
  onDismissNotice?: () => void;
};

export function WebApprovalsPanel(props: PanelProps) {
  if (props.state.kind === "read-only") {
    if (props.noticeDismissed) return null;
    return (
      <div className="fixed bottom-4 right-4 z-[100] w-[min(360px,calc(100vw-2rem))]" data-testid="web-approvals-read-only">
        <div className="flex items-start gap-3 rounded-xl border border-dls-border bg-dls-surface p-3 shadow-lg" role="status">
          <ShieldAlert size={16} className="mt-0.5 shrink-0 text-amber-11" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium leading-5 text-dls-text">{t("web_approvals.read_only_title")}</div>
            <div className="mt-0.5 text-[12px] leading-5 text-dls-secondary">{t("web_approvals.read_only_body")}</div>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t("web_approvals.dismiss")} onClick={props.onDismissNotice}>
            <X />
          </Button>
        </div>
      </div>
    );
  }
  if (props.state.kind !== "owner" || props.state.items.length === 0) return null;
  const items = props.state.items;
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2" data-testid="web-approvals" aria-live="polite">
      {items.map((item) => {
        const busy = props.busyId === item.id;
        const description = describeWebApproval(item);
        return (
          <div key={item.id} className="rounded-xl border border-dls-border bg-dls-surface p-3 shadow-lg" data-approval-id={item.id}>
            <div className="flex items-start gap-3">
              <ShieldCheck size={16} className="mt-0.5 shrink-0 text-dls-secondary" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium leading-5 text-dls-text">{t("web_approvals.title")}</div>
                <div className="mt-0.5 break-words text-[12px] leading-5 text-dls-text">{description.title}</div>
                {description.code ? (
                  <div className="mt-1 text-[12px] leading-5 text-dls-secondary">
                    {t("web_approvals.action", { action: description.code })}
                  </div>
                ) : null}
                {item.paths.length > 0 ? (
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {item.paths.map((path) => (
                      <li key={path} className="break-all font-mono text-[12px] leading-5 text-dls-secondary">{path}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-red-7/25 text-red-11 hover:bg-red-1/40"
                disabled={busy || !props.onRespond}
                onClick={() => props.onRespond?.(item.id, "deny")}
              >
                <XCircle data-icon="inline-start" />
                {t("web_approvals.deny")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={busy || !props.onRespond}
                onClick={() => props.onRespond?.(item.id, "allow")}
              >
                <Check data-icon="inline-start" />
                {t("web_approvals.approve")}
              </Button>
            </div>
          </div>
        );
      })}
      {props.error ? (
        <div className="rounded-xl border border-red-7/25 bg-dls-surface p-3 text-[12px] leading-5 text-red-11 shadow-lg" role="alert">
          {props.error}
        </div>
      ) : null}
    </div>
  );
}

async function connectedClient(): Promise<WebApprovalsClient | null> {
  const connection = await resolveOpenworkConnection();
  if (!connection.normalizedBaseUrl || !connection.resolvedToken) return null;
  return createOpenworkServerClient({
    baseUrl: connection.normalizedBaseUrl,
    token: connection.resolvedToken,
    hostToken: connection.resolvedHostToken,
  });
}

/**
 * Polls the server while the app is open. Polling `GET /approvals` with owner
 * access also tells the server a responder is present; without one, gated
 * writes fail at once with a clear message instead of waiting.
 */
export function WebApprovalsResponder(props: { getClient?: () => Promise<WebApprovalsClient | null>; pollMs?: number }) {
  const getClient = props.getClient ?? connectedClient;
  const pollMs = props.pollMs ?? POLL_MS;
  const [state, setState] = useState<WebApprovalsState>({ kind: "idle" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const clientRef = useRef<WebApprovalsClient | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        // Resolve each time so switching servers or pairing takes effect.
        const client = await getClient();
        clientRef.current = client;
        const next = client ? await loadWebApprovals(client) : { kind: "idle" as const };
        if (active) setState(next);
      } catch {
        // Keep the last state through a transient failure.
      }
      if (active) timer = setTimeout(() => void tick(), pollMs);
    };
    void tick();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [getClient, pollMs]);

  const respond = useCallback(async (id: string, reply: "allow" | "deny") => {
    const client = clientRef.current;
    if (!client) return;
    setBusyId(id);
    setError(null);
    try {
      await answerWebApproval(client, id, reply);
      setState((current) => current.kind === "owner"
        ? { kind: "owner", items: current.items.filter((item) => item.id !== id) }
        : current);
    } catch {
      setError(t("web_approvals.respond_failed"));
    } finally {
      setBusyId(null);
    }
  }, []);

  return (
    <WebApprovalsPanel
      state={state}
      busyId={busyId}
      error={error}
      noticeDismissed={noticeDismissed}
      onRespond={(id, reply) => void respond(id, reply)}
      onDismissNotice={() => setNoticeDismissed(true)}
    />
  );
}

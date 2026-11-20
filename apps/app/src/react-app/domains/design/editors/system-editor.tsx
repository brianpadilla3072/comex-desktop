/** @jsxImportSource react */
import { useMemo, useState, type ComponentType } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Search } from "lucide-react";

import type { DesignManifest, DesignPage, DesignTokens } from "@openwork/types/designs";
import { OpenworkServerError } from "@/app/lib/openwork-server";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

import {
  SYSTEM_SECTIONS,
  TOKENS_FILE,
  designFiles,
  filterTokens,
  isTokenKind,
  parseTokensText,
  sectionCounts,
  serializeTokens,
  updateTokens,
  type AnyToken,
  type SystemSection,
  type TokenKind,
} from "./system-model";
import { SystemOverviewSection } from "./system-overview";
import { SystemAssetsSection, SystemFilesSection, useDesignFonts } from "./system-files";
import { SystemTokenSection } from "./system-sections";
import { SystemTokenDialog } from "./system-token-dialog";

/** The two file methods of the OpenWork server client this editor uses. */
export type SystemEditorClient = {
  readDesignFile: (workspaceId: string, designId: string, path: string) => Promise<Blob>;
  writeDesignFile: (workspaceId: string, designId: string, path: string, body: Blob | string) => Promise<unknown>;
};

/** Props of the base's sandboxed page viewer (`domains/design/design-frame.tsx`). */
export type SystemDesignFrame = ComponentType<{
  workspaceId: string;
  designId: string;
  page: DesignPage;
  scale?: number;
  interactive?: boolean;
  className?: string;
}>;

export type SystemEditorProps = {
  workspaceId: string;
  design: DesignManifest;
  writable: boolean;
  client: SystemEditorClient;
  onChanged: () => void;
  chatOpen: boolean;
  onAskAgent: (text: string, context?: string) => void;
  /** The sandboxed viewer used for component previews (`DesignFrame`). Without it, previews show their file. */
  frame?: SystemDesignFrame;
};

type Loaded = { text: string; tokens: DesignTokens | null; problem: "invalid_json" | "invalid_tokens" | null };

export const systemTokensQueryKey = (workspaceId: string, designId: string) => ["design-system-tokens", workspaceId, designId] as const;

async function readTokensText(client: SystemEditorClient, workspaceId: string, designId: string): Promise<string> {
  try {
    return await (await client.readDesignFile(workspaceId, designId, TOKENS_FILE)).text();
  } catch (cause) {
    // A system created before it had tokens is an empty system, not an error.
    if (cause instanceof OpenworkServerError && cause.status === 404) return "";
    throw cause;
  }
}

function errorText(cause: unknown, fallback: string): string {
  if (cause instanceof OpenworkServerError) {
    if (cause.status === 401 || cause.status === 403) return t("design_ui.system.error.read_only");
    if (cause.status === 413) return t("design_ui.system.error.too_large");
  }
  return t(fallback);
}

type Editing = { kind: TokenKind; index: number | null } | null;

/** Editor of a design system (kind "system"): browses and edits `tokens.json`. */
export function SystemEditor({ workspaceId, design, writable, client, onChanged, chatOpen, onAskAgent, frame }: SystemEditorProps) {
  const queryClient = useQueryClient();
  const queryKey = [...systemTokensQueryKey(workspaceId, design.id), design.updatedAt];
  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<Loaded> => {
      const text = await readTokensText(client, workspaceId, design.id);
      const parsed = parseTokensText(text);
      return parsed.ok ? { text, tokens: parsed.tokens, problem: null } : { text, tokens: null, problem: parsed.code };
    },
    retry: false,
  });
  const [section, setSection] = useState<SystemSection>("overview");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const tokens = query.data?.tokens ?? null;
  const files = useMemo(() => tokens ? designFiles(design, tokens) : [], [design, tokens]);
  const counts = useMemo(() => tokens ? sectionCounts(tokens, files, search) : null, [tokens, files, search]);
  useDesignFonts(client, workspaceId, design.id, tokens?.assets ?? []);

  const ask = (text: string, context?: string) => onAskAgent(text, context ?? `${TOKENS_FILE}`);
  const askSection = (target: SystemSection) => ask(t(`design_ui.system.ask.${target}`, { title: design.title }), `${TOKENS_FILE}#${target}`);

  /** Writes new tokens, refusing when the file changed since it was read (the agent may be editing it). */
  const save = async (next: DesignTokens): Promise<boolean> => {
    const loaded = query.data;
    if (!writable || saving || !loaded) return false;
    setSaving(true);
    setSaveError(null);
    try {
      const current = await readTokensText(client, workspaceId, design.id);
      if (current !== loaded.text) {
        setSaveError(t("design_ui.system.error.conflict"));
        return false;
      }
      const text = serializeTokens(next);
      await client.writeDesignFile(workspaceId, design.id, TOKENS_FILE, text);
      queryClient.setQueryData<Loaded>(queryKey, { text, tokens: next, problem: null });
      onChanged();
      return true;
    } catch (cause) {
      setSaveError(errorText(cause, "design_ui.system.error.save_failed"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const remove = async (kind: TokenKind, index: number) => {
    if (!tokens) return;
    const token = tokens[kind][index];
    if (!token) return;
    const confirmed = await confirmDialog({
      title: t("design_ui.system.delete_title", { name: token.name }),
      confirmLabel: t("design_ui.system.delete"),
      cancelLabel: t("design_ui.system.cancel"),
      destructive: true,
    });
    if (confirmed) await save(updateTokens(tokens, kind, index, null));
  };

  const saveToken = async (kind: TokenKind, index: number | null, token: AnyToken) => {
    if (!tokens) return false;
    const saved = await save(updateTokens(tokens, kind, index, token));
    if (saved) setEditing(null);
    return saved;
  };

  const reload = () => {
    setSaveError(null);
    void query.refetch();
  };

  return <div data-system-editor className="flex h-full min-h-0 w-full flex-col md:flex-row">
    <nav aria-label={t("design_ui.system.nav_label")} data-system-nav
      className={cn("flex shrink-0 flex-col gap-2 border-b border-border p-3 md:border-r md:border-b-0", chatOpen ? "md:w-48" : "md:w-56")}>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input data-system-search type="search" value={search} onChange={event => setSearch(event.target.value)}
          placeholder={t("design_ui.system.search_placeholder")} aria-label={t("design_ui.system.search_placeholder")} className="pl-8" />
      </div>
      <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
        {SYSTEM_SECTIONS.map(item => {
          const count = counts?.[item];
          const active = item === section;
          return <li key={item} className="shrink-0">
            <button type="button" data-system-nav-item={item} aria-current={active ? "page" : undefined} onClick={() => setSection(item)}
              className={cn("flex h-8 w-full items-center justify-between gap-2 rounded-lg px-2.5 text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
                active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                search && count === 0 && "opacity-50")}>
              <span className="truncate">{t(`design_ui.system.section.${item}`)}</span>
              {typeof count === "number" ? <span data-system-nav-count className="text-xs tabular-nums text-muted-foreground">{count}</span> : null}
            </button>
          </li>;
        })}
      </ul>
      {!writable ? <p data-system-read-only className="mt-auto hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
        <Lock className="size-3.5" aria-hidden />{t("design_ui.system.read_only")}
      </p> : null}
    </nav>

    <main data-system-section={section} className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
      {saveError ? <div role="alert" data-system-save-error className="mb-4 flex flex-wrap items-center gap-2 text-sm text-destructive">
        <span>{saveError}</span>
        <Button size="xs" variant="outline" onClick={reload}>{t("design_ui.system.reload")}</Button>
      </div> : null}
      {query.isPending ? <div data-system-loading className="grid gap-3" aria-label={t("design_ui.system.loading")}>
        <Skeleton className="h-6 w-40" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map(key => <Skeleton key={key} className="h-24 rounded-xl" />)}</div>
      </div>
        : query.isError ? <div role="alert" data-system-load-error className="flex flex-col items-start gap-2 text-sm">
          <span>{errorText(query.error, "design_ui.system.error.load_failed")}</span>
          <Button size="sm" variant="outline" onClick={reload}>{t("design_ui.system.retry")}</Button>
        </div>
        : !tokens ? <div role="alert" data-system-invalid className="flex max-w-xl flex-col items-start gap-2 text-sm">
          <span>{t(`design_ui.system.error.${query.data.problem ?? "invalid_tokens"}`)}</span>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" data-system-ask-fix onClick={() => ask(t("design_ui.system.ask.fix", { title: design.title }))}>{t("design_ui.system.ask_fix")}</Button>
            <Button size="sm" variant="outline" onClick={reload}>{t("design_ui.system.reload")}</Button>
          </div>
        </div>
        : section === "overview" ? <SystemOverviewSection design={design} tokens={tokens} writable={writable} saving={saving}
          onSave={patch => save({ ...tokens, ...patch })} onAskAgent={ask} />
        : section === "files" ? <SystemFilesSection client={client} workspaceId={workspaceId} design={design} files={files} query={search} />
        : section === "assets" ? <SystemAssetsSection client={client} workspaceId={workspaceId} designId={design.id}
          items={filterTokens(tokens, "assets", search)} total={tokens.assets.length} query={search} writable={writable}
          onAdd={() => setEditing({ kind: "assets", index: null })} onEdit={index => setEditing({ kind: "assets", index })}
          onDelete={index => void remove("assets", index)} onAsk={() => askSection("assets")} />
        : isTokenKind(section) ? <SystemTokenSection kind={section} tokens={tokens} design={design} workspaceId={workspaceId} query={search}
          writable={writable} frame={frame}
          onAdd={() => setEditing({ kind: section, index: null })} onEdit={index => setEditing({ kind: section, index })}
          onDelete={index => void remove(section, index)} onAsk={() => askSection(section)} />
        : null}
    </main>

    {editing && tokens ? <SystemTokenDialog kind={editing.kind} index={editing.index} tokens={tokens} saving={saving} error={saveError}
      onCancel={() => setEditing(null)} onSave={token => saveToken(editing.kind, editing.index, token)} /> : null}
  </div>;
}

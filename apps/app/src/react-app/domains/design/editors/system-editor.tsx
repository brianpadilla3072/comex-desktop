/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, Gem, Lock, Monitor, Moon, Search, Share2, Sun } from "lucide-react";
import { getInitialThemeMode, setThemeMode, subscribeToTheme, type ThemeMode } from "@/app/theme";

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
  parseTokensText,
  sectionCounts,
  sectionTokens,
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
  reloadKey?: string | number;
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
  /** Changes whenever the design's files changed on disk (the agent edits them directly). */
  revision?: number;
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
export function SystemEditor({ workspaceId, design, writable, client, onChanged, chatOpen, onAskAgent, frame, revision }: SystemEditorProps) {
  const queryClient = useQueryClient();
  // `revision` moves when the agent edits files on disk; without it the tokens would only
  // refetch on manifest changes and the editor would keep showing stale content.
  const queryKey = [...systemTokensQueryKey(workspaceId, design.id), design.updatedAt, revision];
  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<Loaded> => {
      const text = await readTokensText(client, workspaceId, design.id);
      const parsed = parseTokensText(text);
      return parsed.ok ? { text, tokens: parsed.tokens, problem: null } : { text, tokens: null, problem: parsed.code };
    },
    retry: false,
  });
  const [activeSection, setActiveSection] = useState<SystemSection>("overview");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => getInitialThemeMode());
  useEffect(() => subscribeToTheme(() => setThemeModeState(getInitialThemeMode())), []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const tokens = query.data?.tokens ?? null;
  const files = useMemo(() => tokens ? designFiles(design, tokens) : [], [design, tokens]);
  const counts = useMemo(() => tokens ? sectionCounts(tokens, files, search) : null, [tokens, files, search]);
  useDesignFonts(client, workspaceId, design.id, tokens?.assets ?? []);

  const ask = (text: string, context?: string) => onAskAgent(text, context ?? `${TOKENS_FILE}`);
  const askSection = (target: SystemSection) => ask(t(`design_ui.system.ask.${target}`, { title: design.title }), `${TOKENS_FILE}#${target}`);

  // Scrollspy: highlight the section currently in view.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !tokens) return;
    const sections = [...root.querySelectorAll<HTMLElement>("[data-system-section-block]")];
    if (!sections.length) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter(entry => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length) {
        const id = visible[0].target.getAttribute("data-system-section-block");
        if (id) setActiveSection(id as SystemSection);
      }
    }, { root, rootMargin: "0px 0px -70% 0px", threshold: 0 });
    sections.forEach(section => observer.observe(section));
    return () => observer.disconnect();
  }, [tokens, search]);

  const scrollToSection = (target: SystemSection) => {
    const root = scrollRef.current;
    const element = root?.querySelector<HTMLElement>(`[data-system-section-block='${target}']`);
    element?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveSection(target);
  };

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
    const token = sectionTokens(tokens, kind)[index];
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
          const active = item === activeSection;
          return <li key={item} className="shrink-0">
            <button type="button" data-system-nav-item={item} aria-current={active ? "page" : undefined} onClick={() => scrollToSection(item)}
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

    <main ref={scrollRef} data-system-section={activeSection} className="relative min-h-0 min-w-0 flex-1 overflow-y-auto bg-background">
      <div className="sticky top-0 z-20 border-b border-border bg-background">
        <div className="mx-auto flex h-11 w-full max-w-[68ch] items-center gap-2 px-6">
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight text-foreground">{design.title}</h1>
          {saving ? <span className="text-xs text-muted-foreground">{t("design_ui.system.saving")}</span> : null}
          <div role="toolbar" aria-label={t("design_ui.system.toolbar_label")} className="flex items-center gap-1">
            <Button size="icon-sm" variant="ghost" aria-label={t("design_ui.system.copy_tokens")} title={t("design_ui.system.copy_tokens")}
              onClick={() => { try { void navigator.clipboard.writeText(serializeTokens(tokens ?? ({} as DesignTokens))); } catch { /* ignore */ } }}>
              <Copy className="size-4" aria-hidden />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label={t("design_ui.system.download")} title={t("design_ui.system.download")}
              onClick={() => { for (const file of files) void (async () => {
                try {
                  const blob = await client.readDesignFile(workspaceId, design.id, file.path);
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement("a");
                  link.href = url; link.download = file.path.split("/").pop() ?? file.path; link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                } catch { /* ignore */ }
              })(); }}>
              <Download className="size-4" aria-hidden />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label={t("design_ui.system.share")} title={t("design_ui.system.share")}
              onClick={() => { if (navigator.share) void navigator.share({ title: design.title }); }}>
              <Share2 className="size-4" aria-hidden />
            </Button>
            <div className="ml-1 flex items-center gap-0.5 rounded-md border border-border/60 bg-muted/30 p-0.5">
              <Button size="icon-sm" variant={themeMode === "light" ? "secondary" : "ghost"} aria-label={t("design_ui.system.theme_light")} title={t("design_ui.system.theme_light")} className="h-7 w-7 p-0" onClick={() => setThemeMode("light")}><Sun className="size-4" aria-hidden /></Button>
              <Button size="icon-sm" variant={themeMode === "dark" ? "secondary" : "ghost"} aria-label={t("design_ui.system.theme_dark")} title={t("design_ui.system.theme_dark")} className="h-7 w-7 p-0" onClick={() => setThemeMode("dark")}><Moon className="size-4" aria-hidden /></Button>
              <Button size="icon-sm" variant={themeMode === "system" ? "secondary" : "ghost"} aria-label={t("design_ui.system.theme_system")} title={t("design_ui.system.theme_system")} className="h-7 w-7 p-0" onClick={() => setThemeMode("system")}><Monitor className="size-4" aria-hidden /></Button>
            </div>
          </div>
        </div>
      </div>
      {saveError ? <div role="alert" data-system-save-error className="mx-auto mt-4 flex w-full max-w-[68ch] flex-wrap items-center gap-2 px-6 text-sm text-destructive">
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
        : <div className="mx-auto w-full max-w-[68ch] px-6 py-8">
          <div className="grid gap-10">
          <section data-system-section-block="overview" className="scroll-mt-12">
            <SystemOverviewSection design={design} tokens={tokens} writable={writable} saving={saving}
              onSave={patch => save({ ...tokens, ...patch })} onAskAgent={ask} />
          </section>
          <section data-system-section-block="colors" className="scroll-mt-12">
            <SystemTokenSection kind="colors" tokens={tokens} design={design} workspaceId={workspaceId} query={search}
              writable={writable} frame={frame} reloadKey={revision}
              onAdd={() => setEditing({ kind: "colors", index: null })} onEdit={index => setEditing({ kind: "colors", index })}
              onDelete={index => void remove("colors", index)} onAsk={() => askSection("colors")} />
          </section>
          <section data-system-section-block="typography" className="scroll-mt-12">
            <SystemTokenSection kind="typography" tokens={tokens} design={design} workspaceId={workspaceId} query={search}
              writable={writable} frame={frame} reloadKey={revision}
              onAdd={() => setEditing({ kind: "typography", index: null })} onEdit={index => setEditing({ kind: "typography", index })}
              onDelete={index => void remove("typography", index)} onAsk={() => askSection("typography")} />
          </section>
          <section data-system-section-block="spacing" className="scroll-mt-12">
            <SystemTokenSection kind="spacing" tokens={tokens} design={design} workspaceId={workspaceId} query={search}
              writable={writable} frame={frame} reloadKey={revision}
              onAdd={() => setEditing({ kind: "spacing", index: null })} onEdit={index => setEditing({ kind: "spacing", index })}
              onDelete={index => void remove("spacing", index)} onAsk={() => askSection("spacing")} />
          </section>
          <section data-system-section-block="radii" className="scroll-mt-12">
            <SystemTokenSection kind="radii" tokens={tokens} design={design} workspaceId={workspaceId} query={search}
              writable={writable} frame={frame} reloadKey={revision}
              onAdd={() => setEditing({ kind: "radii", index: null })} onEdit={index => setEditing({ kind: "radii", index })}
              onDelete={index => void remove("radii", index)} onAsk={() => askSection("radii")} />
          </section>
          <section data-system-section-block="shadows" className="scroll-mt-12">
            <SystemTokenSection kind="shadows" tokens={tokens} design={design} workspaceId={workspaceId} query={search}
              writable={writable} frame={frame} reloadKey={revision}
              onAdd={() => setEditing({ kind: "shadows", index: null })} onEdit={index => setEditing({ kind: "shadows", index })}
              onDelete={index => void remove("shadows", index)} onAsk={() => askSection("shadows")} />
          </section>
          <section data-system-section-block="gradients" className="scroll-mt-12">
            <SystemTokenSection kind="gradients" tokens={tokens} design={design} workspaceId={workspaceId} query={search}
              writable={writable} frame={frame} reloadKey={revision}
              onAdd={() => setEditing({ kind: "gradients", index: null })} onEdit={index => setEditing({ kind: "gradients", index })}
              onDelete={index => void remove("gradients", index)} onAsk={() => askSection("gradients")} />
          </section>
          <section data-system-section-block="layout" className="scroll-mt-12">
            <SystemTokenSection kind="layout" tokens={tokens} design={design} workspaceId={workspaceId} query={search}
              writable={writable} frame={frame} reloadKey={revision}
              onAdd={() => setEditing({ kind: "layout", index: null })} onEdit={index => setEditing({ kind: "layout", index })}
              onDelete={index => void remove("layout", index)} onAsk={() => askSection("layout")} />
          </section>
          <section data-system-section-block="components" className="scroll-mt-12">
            <SystemTokenSection kind="components" tokens={tokens} design={design} workspaceId={workspaceId} query={search}
              writable={writable} frame={frame} reloadKey={revision}
              onAdd={() => setEditing({ kind: "components", index: null })} onEdit={index => setEditing({ kind: "components", index })}
              onDelete={index => void remove("components", index)} onAsk={() => askSection("components")} />
          </section>
          <section data-system-section-block="assets" className="scroll-mt-12">
            <SystemAssetsSection client={client} workspaceId={workspaceId} designId={design.id}
              items={filterTokens(tokens, "assets", search)} total={sectionTokens(tokens, "assets").length} query={search} writable={writable}
              onAdd={() => setEditing({ kind: "assets", index: null })} onEdit={index => setEditing({ kind: "assets", index })}
              onDelete={index => void remove("assets", index)} onAsk={() => askSection("assets")} />
          </section>
          <section data-system-section-block="files" className="scroll-mt-12">
            <SystemFilesSection client={client} workspaceId={workspaceId} design={design} files={files} query={search} />
          </section>
        </div>
        </div>}
    </main>

    {editing && tokens ? <SystemTokenDialog kind={editing.kind} index={editing.index} tokens={tokens} saving={saving} error={saveError}
      onCancel={() => setEditing(null)} onSave={token => saveToken(editing.kind, editing.index, token)} /> : null}
  </div>;
}

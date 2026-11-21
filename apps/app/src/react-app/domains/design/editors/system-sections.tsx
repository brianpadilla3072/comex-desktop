/** @jsxImportSource react */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, Pencil, Plus, Trash2 } from "lucide-react";

import type { DesignManifest, DesignTokens } from "@openwork/types/designs";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

import type { SystemDesignFrame } from "./system-editor";
import {
  componentPage,
  filterTokens,
  fontStack,
  fontWeightValue,
  isCssColor,
  isCssLength,
  isSafeCssValue,
  sectionTokens,
  type SystemSection,
  type TokenKind,
} from "./system-model";

// ---- Shared pieces ----

/** Copies a value and says so for a moment. */
export function CopyValueButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return <Button type="button" size="icon-xs" variant="ghost" data-system-copy={value}
    aria-label={copied ? t("design_ui.system.copied") : t("design_ui.system.copy_value", { name: label })}
    title={copied ? t("design_ui.system.copied") : t("design_ui.system.copy")} onClick={() => void copy()}>
    {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
  </Button>;
}

export function TokenActions({ name, writable, index, onEdit, onDelete }: { name: string; writable: boolean; index: number; onEdit: (index: number) => void; onDelete: (index: number) => void }) {
  if (!writable) return null;
  return <span className="flex items-center">
    <Button type="button" size="icon-xs" variant="ghost" data-system-edit={index} aria-label={t("design_ui.system.edit_named", { name })} title={t("design_ui.system.edit")} onClick={() => onEdit(index)}>
      <Pencil aria-hidden />
    </Button>
    <Button type="button" size="icon-xs" variant="ghost" data-system-delete={index} aria-label={t("design_ui.system.delete_named", { name })} title={t("design_ui.system.delete")} onClick={() => onDelete(index)}>
      <Trash2 aria-hidden />
    </Button>
  </span>;
}

/** Section header, plus the empty state (ask the agent) and the no-results state of a search. */
export function SectionShell({ section, total, shown, query, writable, onAdd, onAsk, children }: {
  section: SystemSection;
  total: number;
  shown: number;
  query: string;
  writable: boolean;
  onAdd?: () => void;
  onAsk: () => void;
  children: ReactNode;
}) {
  return <section aria-labelledby={`system-${section}-title`} className="grid gap-4">
    <header className="flex min-h-8 items-center justify-between gap-2">
      <h2 id={`system-${section}-title`} className="text-base font-semibold tracking-tight">
        {t(`design_ui.system.section.${section}`)}
        {total > 0 ? <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">{total}</span> : null}
      </h2>
      {writable && onAdd && total > 0 ? <Button size="sm" variant="outline" data-system-add={section} onClick={onAdd}><Plus aria-hidden />{t("design_ui.system.add")}</Button> : null}
    </header>
    {total === 0 ? <div data-system-empty={section} className="flex max-w-xl flex-col items-start gap-3 py-6">
      <p className="text-sm text-muted-foreground">{t(`design_ui.system.empty.${section}`)}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" data-system-ask={section} onClick={onAsk}>{t("design_ui.system.ask_agent")}</Button>
        {writable && onAdd ? <Button size="sm" variant="outline" data-system-add={section} onClick={onAdd}><Plus aria-hidden />{t("design_ui.system.add_manually")}</Button> : null}
      </div>
    </div>
      : shown === 0 ? <p data-system-no-results className="text-sm text-muted-foreground">{t("design_ui.system.no_results", { query: query.trim() })}</p>
      : children}
  </section>;
}

function Meta({ children }: { children: ReactNode }) {
  return <span className="font-mono text-xs text-muted-foreground">{children}</span>;
}

/** A neutral box that says the value cannot be previewed (it would load something or is not CSS). */
function NoSample() {
  return <span className="text-xs text-muted-foreground">{t("design_ui.system.no_preview")}</span>;
}

// ---- Token sections ----

type SectionProps = {
  kind: Exclude<TokenKind, "assets">;
  tokens: DesignTokens;
  design: DesignManifest;
  workspaceId: string;
  query: string;
  writable: boolean;
  frame?: SystemDesignFrame;
  reloadKey?: number;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  onAsk: () => void;
};

export function SystemTokenSection(props: SectionProps) {
  const { kind, tokens, query, writable, onAdd, onAsk } = props;
  const shell = (shown: number, body: ReactNode) => <SectionShell section={kind} total={sectionTokens(tokens, kind).length} shown={shown} query={query} writable={writable} onAdd={onAdd} onAsk={onAsk}>{body}</SectionShell>;
  switch (kind) {
    case "colors": {
      const items = filterTokens(tokens, "colors", query);
      const groups = new Map<string, typeof items>();
      for (const item of items) {
        const group = item.token.group?.trim() ?? "";
        groups.set(group, [...(groups.get(group) ?? []), item]);
      }
      return shell(items.length, <div className="grid gap-6">
        {[...groups].map(([group, list]) => <div key={group || "_"} className="grid gap-2">
          {group ? <h3 className="text-sm font-medium text-muted-foreground">{group}</h3> : null}
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-4">
            {list.map(({ token, index }) => <li key={`${token.name}-${index}`} data-system-color={token.name} className="grid gap-2">
              <span data-system-swatch className="h-20 rounded-xl border border-border"
                style={isCssColor(token.value) ? { backgroundColor: token.value } : undefined} aria-hidden />
              <span className="flex min-w-0 items-start justify-between gap-1">
                <span className="grid min-w-0">
                  <span className="truncate text-sm font-medium">{token.name}</span>
                  <Meta>{token.value}</Meta>
                  {token.role ? <span className="truncate text-xs text-muted-foreground">{token.role}</span> : null}
                </span>
                <span className="flex shrink-0 items-center">
                  <CopyValueButton value={token.value} label={token.name} />
                  <TokenActions name={token.name} writable={writable} index={index} onEdit={props.onEdit} onDelete={props.onDelete} />
                </span>
              </span>
            </li>)}
          </ul>
        </div>)}
      </div>);
    }
    case "typography": {
      const items = filterTokens(tokens, "typography", query);
      return shell(items.length, <ul className="grid divide-y divide-border">
        {items.map(({ token, index }) => <li key={`${token.name}-${index}`} data-system-type={token.name} className="grid gap-2 py-4 first:pt-0">
          <span className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-sm font-medium">{token.name}</span>
              <Meta>{token.family}</Meta>
              <Meta>{token.lineHeight ? `${token.size} / ${token.lineHeight}` : token.size}</Meta>
              <Meta>{String(token.weight)}</Meta>
            </span>
            <span className="flex shrink-0 items-center">
              <CopyValueButton value={`font: ${token.weight} ${token.size}${token.lineHeight ? `/${token.lineHeight}` : ""} ${token.family};`} label={token.name} />
              <TokenActions name={token.name} writable={writable} index={index} onEdit={props.onEdit} onDelete={props.onDelete} />
            </span>
          </span>
          <p data-system-specimen className="overflow-hidden break-words text-foreground" style={{
            fontFamily: fontStack(token.family),
            fontSize: isCssLength(token.size) ? `min(${token.size}, 6rem)` : undefined,
            fontWeight: fontWeightValue(token.weight),
            lineHeight: token.lineHeight && isSafeCssValue(token.lineHeight) ? token.lineHeight : undefined,
          }}>{token.sample?.trim() || t("design_ui.system.specimen")}</p>
        </li>)}
      </ul>);
    }
    case "spacing":
    case "radii":
    case "shadows":
    case "gradients": {
      const items = filterTokens(tokens, kind, query);
      return shell(items.length, <ul className={kind === "spacing" ? "grid divide-y divide-border" : "grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-4"}>
        {items.map(({ token, index }) => <li key={`${token.name}-${index}`} data-system-measure={token.name}
          className={kind === "spacing" ? "flex items-center gap-4 py-2" : "grid gap-2"}>
          {kind === "spacing" ? <span className="flex w-40 shrink-0 items-center">
            {isCssLength(token.value) ? <span data-system-sample className="h-4 max-w-full rounded-sm bg-primary/70" style={{ width: token.value }} aria-hidden /> : <NoSample />}
          </span>
            : <span data-system-sample aria-hidden className="flex h-24 items-center justify-center rounded-xl border border-border bg-background"
              style={kind === "radii" && isCssLength(token.value) ? { borderRadius: token.value, backgroundColor: "var(--muted)" }
                : kind === "shadows" && isSafeCssValue(token.value) ? { boxShadow: token.value }
                : kind === "gradients" && isSafeCssValue(token.value) ? { backgroundImage: token.value }
                : undefined}>
              {(kind === "radii" && !isCssLength(token.value)) || (kind !== "radii" && !isSafeCssValue(token.value)) ? <NoSample /> : null}
            </span>}
          <span className="flex min-w-0 flex-1 items-start justify-between gap-1">
            <span className="grid min-w-0">
              <span className="truncate text-sm font-medium">{token.name}</span>
              <Meta>{token.value}</Meta>
            </span>
            <span className="flex shrink-0 items-center">
              <CopyValueButton value={token.value} label={token.name} />
              <TokenActions name={token.name} writable={writable} index={index} onEdit={props.onEdit} onDelete={props.onDelete} />
            </span>
          </span>
        </li>)}
      </ul>);
    }
    case "layout": {
      const items = filterTokens(tokens, "layout", query);
      return shell(items.length, <ul className="grid divide-y divide-border">
        {items.map(({ token, index }) => <li key={`${token.name}-${index}`} data-system-layout={token.name} className="flex min-h-11 items-start justify-between gap-3 py-2.5">
          <span className="grid min-w-0 gap-0.5">
            <span className="text-sm font-medium">{token.name}</span>
            {token.note ? <span className="text-xs text-muted-foreground">{token.note}</span> : null}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <Meta>{token.value}</Meta>
            <CopyValueButton value={token.value} label={token.name} />
            <TokenActions name={token.name} writable={writable} index={index} onEdit={props.onEdit} onDelete={props.onDelete} />
          </span>
        </li>)}
      </ul>);
    }
    case "components": {
      const items = filterTokens(tokens, "components", query);
      const Frame = props.frame;
      return shell(items.length, <ul className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-6">
        {items.map(({ token, index }) => {
          const page = componentPage(props.design, token, index);
          return <li key={`${token.name}-${index}`} data-system-component={token.name} className="grid gap-2">
            <div className="aspect-[16/10] overflow-hidden rounded-xl border border-border bg-muted/30">
              {Frame ? <Frame workspaceId={props.workspaceId} designId={props.design.id} page={page} scale={0.2} interactive={false} reloadKey={props.reloadKey} className="h-full w-full" />
                : <span className="flex h-full items-center justify-center p-3"><Meta>{token.file}</Meta></span>}
            </div>
            <span className="flex min-w-0 items-start justify-between gap-1">
              <span className="grid min-w-0">
                <span className="truncate text-sm font-medium">{token.name}</span>
                {token.description ? <span className="line-clamp-2 text-xs text-muted-foreground">{token.description}</span> : null}
              </span>
              <TokenActions name={token.name} writable={writable} index={index} onEdit={props.onEdit} onDelete={props.onDelete} />
            </span>
          </li>;
        })}
      </ul>);
    }
  }
}

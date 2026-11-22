/** @jsxImportSource react */
import { useEffect, useId, useState } from "react";
import { Pencil } from "lucide-react";

import type { DesignManifest, DesignTokens } from "@openwork/types/designs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

import { TOKENS_FILE, tokensAreEmpty } from "./system-model";

/** Overview and content rules share the schema's limit. */
export const SYSTEM_PROSE_MAX_CHARS = 20_000;
const SOURCE_SUGGESTIONS = ["logo", "brand_guide", "existing_design"] as const;

type ProseField = "overview" | "content";

/** One editable block of prose (brand overview or writing rules). */
function ProseBlock({ field, value, writable, saving, onSave }: {
  field: ProseField;
  value: string;
  writable: boolean;
  saving: boolean;
  onSave: (text: string) => Promise<boolean>;
}) {
  const fieldId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  const tooLong = draft.length > SYSTEM_PROSE_MAX_CHARS;

  const submit = async () => {
    if (tooLong || saving) return;
    if (await onSave(draft.trim())) setEditing(false);
  };

  return <div data-system-prose={field} className="grid gap-2">
    <div className="flex min-h-8 items-center justify-between gap-2">
      <h3 id={`${fieldId}-title`} className="text-sm font-medium">{t(`design_ui.system.prose.${field}`)}</h3>
      {writable && !editing ? <Button size="xs" variant="ghost" data-system-prose-edit={field} onClick={() => setEditing(true)}>
        <Pencil aria-hidden />{t("design_ui.system.edit")}
      </Button> : null}
    </div>
    {editing ? <form className="grid gap-2" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <Label htmlFor={fieldId} className="sr-only">{t(`design_ui.system.prose.${field}`)}</Label>
      <Textarea id={fieldId} data-system-prose-text={field} autoFocus rows={8} value={draft} aria-invalid={tooLong || undefined}
        placeholder={t(`design_ui.system.prose.${field}_placeholder`)} className="max-h-[50dvh] min-h-32"
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setEditing(false); } }} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={cn("text-xs tabular-nums text-muted-foreground", tooLong && "text-destructive")}>
          {t("design_ui.system.char_count", { count: draft.length.toLocaleString(), max: SYSTEM_PROSE_MAX_CHARS.toLocaleString() })}
        </span>
        <span className="flex gap-2">
          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => setEditing(false)}>{t("design_ui.system.cancel")}</Button>
          <Button type="submit" size="sm" data-system-prose-save={field} disabled={saving || tooLong || draft.trim() === value.trim()}>
            {saving ? t("design_ui.system.saving") : t("design_ui.system.save")}
          </Button>
        </span>
      </div>
    </form>
      : value.trim() ? <p data-system-prose-value={field} className="max-w-prose text-sm whitespace-pre-wrap text-foreground">{value}</p>
      : <p data-system-prose-empty={field} className="text-sm text-muted-foreground">{t(`design_ui.system.prose.${field}_empty`)}</p>}
  </div>;
}

/** Invites asking the agent to build the system from a source the person names. */
function BuildFromSource({ design, onAskAgent }: { design: DesignManifest; onAskAgent: (text: string, context?: string) => void }) {
  const fieldId = useId();
  const [source, setSource] = useState("");
  const send = () => {
    const from = source.trim() || t("design_ui.system.build.default_source");
    onAskAgent(t("design_ui.system.ask.build_from", { title: design.title, source: from }), TOKENS_FILE);
    setSource("");
  };
  return <form data-system-build className="grid max-w-xl gap-3 py-2" onSubmit={event => { event.preventDefault(); send(); }}>
    <Label htmlFor={fieldId} className="text-base font-semibold tracking-tight">{t("design_ui.system.build.title")}</Label>
    <div className="flex flex-col gap-2 sm:flex-row">
      <Input id={fieldId} data-system-build-source value={source} onChange={event => setSource(event.target.value)}
        placeholder={t("design_ui.system.build.placeholder")} maxLength={500} />
      <Button type="submit" data-system-build-send>{t("design_ui.system.ask_agent")}</Button>
    </div>
    <div className="flex flex-wrap gap-2">
      {SOURCE_SUGGESTIONS.map(item => <Button key={item} type="button" size="xs" variant="outline" data-system-build-suggestion={item}
        onClick={() => setSource(t(`design_ui.system.build.suggestion.${item}`))}>
        {t(`design_ui.system.build.suggestion.${item}`)}
      </Button>)}
    </div>
  </form>;
}

export function SystemOverviewSection({ design, tokens, writable, saving, onSave, onAskAgent }: {
  design: DesignManifest;
  tokens: DesignTokens;
  writable: boolean;
  saving: boolean;
  onSave: (patch: Partial<Pick<DesignTokens, ProseField>>) => Promise<boolean>;
  onAskAgent: (text: string, context?: string) => void;
}) {
  return <section aria-labelledby="system-overview-title" className="grid max-w-3xl gap-6">
    <h2 id="system-overview-title" className="text-base font-semibold tracking-tight">{t("design_ui.system.section.overview")}</h2>
    {tokensAreEmpty(tokens) ? <BuildFromSource design={design} onAskAgent={onAskAgent} /> : null}
    <ProseBlock field="overview" value={tokens.overview} writable={writable} saving={saving} onSave={text => onSave({ overview: text })} />
    <ProseBlock field="content" value={tokens.content} writable={writable} saving={saving} onSave={text => onSave({ content: text })} />
  </section>;
}

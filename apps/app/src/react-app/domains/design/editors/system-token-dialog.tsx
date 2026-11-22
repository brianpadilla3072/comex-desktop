/** @jsxImportSource react */
import { useId, useState } from "react";

import type { DesignTokens } from "@openwork/types/designs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";

import {
  TOKEN_FIELDS,
  buildToken,
  isCssColor,
  tokenFieldMultiline,
  tokenFieldRequired,
  tokenFormFrom,
  sectionTokens,
  type AnyToken,
  type TokenErrors,
  type TokenForm,
  type TokenKind,
} from "./system-model";

/** Adds or edits one token. Validation runs on save; the editor writes `tokens.json`. */
export function SystemTokenDialog({ kind, index, tokens, saving, error, onCancel, onSave }: {
  kind: TokenKind;
  /** Position being edited, or null to add. */
  index: number | null;
  tokens: DesignTokens;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (token: AnyToken) => Promise<boolean>;
}) {
  const baseId = useId();
  const list: readonly AnyToken[] = sectionTokens(tokens, kind);
  const [form, setForm] = useState<TokenForm>(() => tokenFormFrom(kind, index === null ? null : list[index] ?? null));
  const [errors, setErrors] = useState<TokenErrors>({});

  const submit = async () => {
    if (saving) return;
    const built = buildToken(kind, form, list, index);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    await onSave(built.token);
  };

  const colorPreview = kind === "colors" && isCssColor(form.value ?? "") ? form.value : null;

  return <Dialog open onOpenChange={open => { if (!open && !saving) onCancel(); }}>
    <DialogContent data-system-token-dialog={kind} className="lg:max-w-lg">
      <DialogHeader>
        <DialogTitle>{t(index === null ? `design_ui.system.dialog.add.${kind}` : `design_ui.system.dialog.edit.${kind}`)}</DialogTitle>
      </DialogHeader>
      <form className="grid gap-3" noValidate onSubmit={event => { event.preventDefault(); void submit(); }}>
        {TOKEN_FIELDS[kind].map((field, position) => {
          const id = `${baseId}-${field}`;
          const problem = errors[field];
          const common = {
            id,
            "data-system-field": field,
            value: form[field] ?? "",
            "aria-invalid": problem ? true : undefined,
            "aria-describedby": problem ? `${id}-error` : undefined,
            placeholder: t(field === "value" ? `design_ui.system.placeholder.value_${kind}` : `design_ui.system.placeholder.${field}`),
          };
          return <div key={field} className="grid gap-1.5">
            <Label htmlFor={id}>
              {t(`design_ui.system.field.${field}`)}
              {tokenFieldRequired(field) ? null : <span className="ml-1 font-normal text-muted-foreground">{t("design_ui.system.optional")}</span>}
            </Label>
            <div className="flex items-center gap-2">
              {field === "value" && kind === "colors" ? <span data-system-dialog-swatch aria-hidden className="size-9 shrink-0 rounded-lg border border-border"
                style={colorPreview ? { backgroundColor: colorPreview } : undefined} /> : null}
              {tokenFieldMultiline(field)
                ? <Textarea {...common} rows={3} onChange={event => setForm(current => ({ ...current, [field]: event.target.value }))} />
                : <Input {...common} autoFocus={position === 0} className={field === "name" || field === "role" || field === "group" ? undefined : "font-mono"}
                  onChange={event => setForm(current => ({ ...current, [field]: event.target.value }))} />}
            </div>
            {problem ? <p id={`${id}-error`} data-system-field-error={field} className="text-xs text-destructive">{t(problem)}</p> : null}
          </div>;
        })}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>{t("design_ui.system.cancel")}</Button>
          <Button type="submit" data-system-token-save disabled={saving}>{saving ? t("design_ui.system.saving") : t("design_ui.system.save")}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

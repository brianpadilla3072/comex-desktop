/** @jsxImportSource react */
import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

import { designErrorText } from "../design-client";
import { DesignFrame } from "../design-frame";
import type { DesignEditorProps } from "./types";

/**
 * The editor every kind starts with: the page list and the selected page. The kind's own
 * editor (slides, mockup, system, board) replaces it in the registry.
 */
export function PlaceholderEditor({ workspaceId, design, writable, client, onChanged, revision }: DesignEditorProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = design.pages.find(page => page.id === selectedId) ?? design.pages[0] ?? null;

  const addPage = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await client.addDesignPage(workspaceId, design.id, { afterPageId: selected?.id });
      const added = next.pages.find(page => !design.pages.some(old => old.id === page.id));
      if (added) setSelectedId(added.id);
      onChanged();
    } catch (cause) { setError(designErrorText(cause)); }
    finally { setBusy(false); }
  };

  return <div data-design-placeholder-editor className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row">
    <nav aria-label={t("design_ui.studio.pages")} className="flex shrink-0 gap-2 overflow-auto md:w-44 md:flex-col">
      <ol className="flex gap-2 md:flex-col">
        {design.pages.map((page, index) => <li key={page.id}>
          <button type="button" data-design-page-item={page.id} aria-current={selected?.id === page.id ? "page" : undefined}
            onClick={() => setSelectedId(page.id)}
            className={cn("flex w-32 flex-col gap-1 rounded-lg p-1.5 text-start text-xs transition-colors duration-150 ease-out hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring md:w-full",
              selected?.id === page.id && "bg-muted")}>
            <DesignFrame workspaceId={workspaceId} designId={design.id} page={page} reloadKey={revision} className="aspect-video w-full" client={client} />
            <span className="truncate"><span className="tabular-nums text-muted-foreground">{index + 1}</span> {page.title}</span>
          </button>
        </li>)}
      </ol>
      {writable && design.kind !== "board" ? <Button variant="outline" size="sm" data-design-add-page disabled={busy} onClick={() => void addPage()} className="shrink-0">
        <Plus className="size-4" aria-hidden />{t("design_ui.studio.add_page")}
      </Button> : null}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </nav>
    <section aria-label={selected?.title ?? t("design_ui.studio.pages")} className="flex min-h-64 min-w-0 flex-1 rounded-xl bg-muted/40 p-3">
      {selected ? <DesignFrame workspaceId={workspaceId} designId={design.id} page={selected} reloadKey={revision} interactive className="h-full w-full" client={client} />
        : <p className="m-auto text-sm text-muted-foreground">{t("design_ui.studio.no_pages")}</p>}
    </section>
  </div>;
}

/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { Download, FileText } from "lucide-react";

import type { DesignManifest } from "@openwork/types/designs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";

import type { SystemEditorClient } from "./system-editor";
import { CopyValueButton, SectionShell, TokenActions } from "./system-sections";
import { imageType, normalizeSearch, type DesignFileEntry, type TokenOf } from "./system-model";

const FONT_EXTENSIONS = new Set(["woff", "woff2", "ttf", "otf"]);
const fileExtension = (path: string) => path.split(".").pop()?.toLowerCase() ?? "";
const fileName = (path: string) => path.split("/").pop() ?? path;

/**
 * Brand fonts shipped as assets of the design (woff/woff2/ttf/otf) are registered under the
 * asset's name, so a typography token whose family is that name renders with it. Fonts are read
 * from the design folder through the server; nothing is fetched from the network. Missing fonts
 * fall back to the system stack.
 */
export function useDesignFonts(client: SystemEditorClient, workspaceId: string, designId: string, assets: readonly TokenOf<"assets">[]) {
  const fonts = assets.filter(asset => FONT_EXTENSIONS.has(fileExtension(asset.file)));
  const signature = fonts.map(asset => `${asset.name}\u0000${asset.file}`).join("\u0001");
  useEffect(() => {
    if (!signature || typeof FontFace === "undefined" || typeof document === "undefined" || !document.fonts) return;
    let cancelled = false;
    const added: FontFace[] = [];
    void (async () => {
      for (const asset of fonts) {
        try {
          const buffer = await (await client.readDesignFile(workspaceId, designId, asset.file)).arrayBuffer();
          if (cancelled) return;
          const face = await new FontFace(asset.name, buffer).load();
          if (cancelled) return;
          document.fonts.add(face);
          added.push(face);
        } catch {
          // A broken font only means the specimen uses the fallback stack.
        }
      }
    })();
    return () => {
      cancelled = true;
      for (const face of added) document.fonts.delete(face);
    };
    // `signature` captures the font list; the client is stable for a design page.
  }, [signature, workspaceId, designId]);
}

/** An image of the design folder, loaded through the server as a blob (no network, no markup). */
function AssetImage({ client, workspaceId, designId, file, alt }: { client: SystemEditorClient; workspaceId: string; designId: string; file: string; alt: string }) {
  const type = imageType(file);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!type || typeof URL.createObjectURL !== "function") return;
    let cancelled = false;
    let created: string | null = null;
    setFailed(false);
    client.readDesignFile(workspaceId, designId, file).then(blob => {
      if (cancelled) return;
      created = URL.createObjectURL(new Blob([blob], { type }));
      setUrl(created);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
      setUrl(null);
    };
  }, [client, workspaceId, designId, file, type]);
  if (!type || failed) return <span className="flex h-full flex-col items-center justify-center gap-1 p-3 text-center">
    <FileText className="size-5 text-muted-foreground" aria-hidden />
    <span className="font-mono text-xs break-all text-muted-foreground">{failed ? t("design_ui.system.asset_missing") : fileName(file)}</span>
  </span>;
  if (!url) return <Skeleton className="h-full w-full rounded-none" />;
  return <img data-system-asset-image src={url} alt={alt} className="h-full w-full object-contain p-3" draggable={false} />;
}

export function SystemAssetsSection({ client, workspaceId, designId, items, total, query, writable, onAdd, onEdit, onDelete, onAsk }: {
  client: SystemEditorClient;
  workspaceId: string;
  designId: string;
  items: { token: TokenOf<"assets">; index: number }[];
  total: number;
  query: string;
  writable: boolean;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  onAsk: () => void;
}) {
  return <SectionShell section="assets" total={total} shown={items.length} query={query} writable={writable} onAdd={onAdd} onAsk={onAsk}>
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-4">
      {items.map(({ token, index }) => <li key={`${token.name}-${index}`} data-system-asset={token.name} className="grid gap-2">
        <div className="aspect-square overflow-hidden rounded-xl border border-border bg-muted/30">
          <AssetImage client={client} workspaceId={workspaceId} designId={designId} file={token.file} alt={token.name} />
        </div>
        <span className="flex min-w-0 items-start justify-between gap-1">
          <span className="grid min-w-0">
            <span className="truncate text-sm font-medium">{token.name}</span>
            <span className="truncate font-mono text-xs text-muted-foreground">{token.file}</span>
          </span>
          <span className="flex shrink-0 items-center">
            <CopyValueButton value={`../${token.file}`} label={token.name} />
            <TokenActions name={token.name} writable={writable} index={index} onEdit={onEdit} onDelete={onDelete} />
          </span>
        </span>
      </li>)}
    </ul>
  </SectionShell>;
}

/** Saves a file of the design folder to the computer (read through the server, local only). */
async function downloadFile(client: SystemEditorClient, workspaceId: string, designId: string, path: string) {
  const blob = await client.readDesignFile(workspaceId, designId, path);
  if (typeof URL.createObjectURL !== "function") return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName(path);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SystemFilesSection({ client, workspaceId, design, files, query }: {
  client: SystemEditorClient;
  workspaceId: string;
  design: DesignManifest;
  files: readonly DesignFileEntry[];
  query: string;
}) {
  const needle = normalizeSearch(query);
  const shown = needle ? files.filter(file => normalizeSearch(file.path).includes(needle)) : files;
  const [failed, setFailed] = useState<string | null>(null);
  return <section aria-labelledby="system-files-title" className="grid gap-4">
    <h2 id="system-files-title" className="text-base font-semibold tracking-tight">
      {t("design_ui.system.section.files")}
      <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">{files.length}</span>
    </h2>
    {failed ? <p role="alert" className="text-sm text-destructive">{t("design_ui.system.error.download_failed", { file: failed })}</p> : null}
    {shown.length === 0 ? <p data-system-no-results className="text-sm text-muted-foreground">{t("design_ui.system.no_results", { query: query.trim() })}</p>
      : <ul className="grid divide-y divide-border">
        {shown.map(file => <li key={file.path} data-system-file={file.path} className="flex min-h-10 items-center justify-between gap-3 py-1.5">
          <span className="grid min-w-0">
            <span className="truncate font-mono text-xs">{file.path}</span>
            <span className="text-xs text-muted-foreground">{t(`design_ui.system.file_kind.${file.kind}`)}</span>
          </span>
          <Button type="button" size="icon-xs" variant="ghost" data-system-download={file.path}
            aria-label={t("design_ui.system.download_named", { file: fileName(file.path) })} title={t("design_ui.system.download")}
            onClick={() => { setFailed(null); downloadFile(client, workspaceId, design.id, file.path).catch(() => setFailed(fileName(file.path))); }}>
            <Download aria-hidden />
          </Button>
        </li>)}
      </ul>}
  </section>;
}

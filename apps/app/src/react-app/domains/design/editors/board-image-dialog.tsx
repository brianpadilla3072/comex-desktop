/** @jsxImportSource react */
import { useId, useRef, useState } from "react";
import { designRelativePathSchema, DESIGN_LIMITS } from "@openwork/types/designs";
import { Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";

import { imageMimeType } from "./board-export";

export const BOARD_IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml";

/** `assets/<safe-name>-<suffix>.<ext>` for an uploaded file; null when it is not a supported image. */
export function uploadAssetPath(fileName: string, suffix: string): string | null {
  const match = /^(.*?)(?:\.([A-Za-z0-9]+))?$/.exec(fileName.trim());
  const extension = (match?.[2] ?? "").toLowerCase();
  if (!imageMimeType(`x.${extension}`)) return null;
  const base = (match?.[1] ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 48) || "imagen";
  return `assets/${base}-${suffix}.${extension === "jpeg" ? "jpg" : extension}`;
}

/** A path the person typed: inside the design folder and an image. */
export function validAssetPath(value: string): boolean {
  return designRelativePathSchema.safeParse(value).success && imageMimeType(value) !== null;
}

/** Choose an image for the board: upload one into assets/ or use one already in the folder. */
export function BoardImageDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  knownAssets: string[];
  busy: boolean;
  error: string | null;
  onUpload: (file: File) => void;
  onChoose: (path: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [path, setPath] = useState("assets/");
  const pathId = useId();
  const valid = validAssetPath(path);
  return (
    <Dialog open={props.open} onOpenChange={open => props.onOpenChange(open)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("design_ui.board.image.title")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <input
            ref={fileRef}
            type="file"
            accept={BOARD_IMAGE_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={event => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) props.onUpload(file);
            }}
          />
          <Button type="button" variant="outline" disabled={props.busy} onClick={() => fileRef.current?.click()}>
            <Upload />
            {t("design_ui.board.image.upload")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("design_ui.board.image.limit", { size: Math.round(DESIGN_LIMITS.assetBytes / (1024 * 1024)) })}</p>
          {props.knownAssets.length ? (
            <ul aria-label={t("design_ui.board.image.known")} className="flex max-h-40 flex-col overflow-y-auto">
              {props.knownAssets.map(asset => (
                <li key={asset}>
                  <button
                    type="button"
                    className="w-full truncate rounded-lg px-2 py-1.5 text-start font-mono text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                    onClick={() => props.onChoose(asset)}
                  >
                    {asset}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <form
            className="flex flex-col gap-1.5"
            onSubmit={event => {
              event.preventDefault();
              if (valid) props.onChoose(path.trim());
            }}
          >
            <label htmlFor={pathId} className="text-xs font-medium text-muted-foreground">{t("design_ui.board.image.path_label")}</label>
            <div className="flex gap-2">
              <Input id={pathId} value={path} className="font-mono text-xs" onChange={event => setPath(event.currentTarget.value)} />
              <Button type="submit" variant="outline" disabled={!valid || props.busy}>{t("design_ui.board.image.insert")}</Button>
            </div>
          </form>
          {props.error ? <p role="alert" className="text-sm text-destructive">{props.error}</p> : null}
        </div>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}

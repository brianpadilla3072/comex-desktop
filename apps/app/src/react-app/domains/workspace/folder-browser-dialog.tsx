/** @jsxImportSource react */
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight, Folder, FolderPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  createdFolderSchema,
  folderBreadcrumbs,
  folderListingSchema,
  isValidNewFolderName,
  type FolderBrowserClient,
  type FolderListing,
} from "@/app/lib/web-folder-browser";
import { t } from "../../../i18n";

const ERROR_KEYS: Record<string, string> = {
  unauthorized: "web_folder_browser.error_unauthorized",
  folder_outside_roots: "web_folder_browser.error_outside",
  folder_not_found: "web_folder_browser.error_not_found",
  folder_unreadable: "web_folder_browser.error_unreadable",
  folder_exists: "web_folder_browser.error_exists",
  folder_name_invalid: "web_folder_browser.error_name",
  folder_name_too_long: "web_folder_browser.error_name",
  folder_create_rate_limited: "web_folder_browser.error_rate_limited",
};

function errorMessage(error: unknown, fallbackKey: string): string {
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "";
  return t(ERROR_KEYS[code] ?? fallbackKey);
}

export type FolderBrowserDialogProps = {
  open: boolean;
  client: FolderBrowserClient;
  onChoose: (path: string) => void;
  onCancel: () => void;
};

/** Pick a folder on the server's computer from the web app (docs/features/web-folder-browser). */
export function FolderBrowserDialog(props: FolderBrowserDialogProps) {
  const { client, open } = props;
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [newFolderName, setNewFolderName] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (path: string | null, hidden: boolean) => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const next = folderListingSchema.parse(await client.browseFolders(path, { hidden }));
      if (id === requestId.current) setListing(next);
    } catch (failure) {
      if (id === requestId.current) setError(errorMessage(failure, "web_folder_browser.error_load"));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    if (!open) return;
    setListing(null);
    setShowHidden(false);
    setNewFolderName(null);
    setCreateError(null);
    void load(null, false);
  }, [load, open]);

  const currentPath = listing?.path ?? null;
  const navigate = (path: string) => {
    setNewFolderName(null);
    setCreateError(null);
    void load(path, showHidden);
  };

  const submitNewFolder = async () => {
    const name = newFolderName ?? "";
    if (!currentPath || creating) return;
    if (!isValidNewFolderName(name)) {
      setCreateError(t("web_folder_browser.error_name"));
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const created = createdFolderSchema.parse(await client.createFolder(currentPath, name));
      setNewFolderName(null);
      await load(created.path, showHidden);
    } catch (failure) {
      setCreateError(errorMessage(failure, "web_folder_browser.error_create"));
    } finally {
      setCreating(false);
    }
  };

  const crumbs = listing ? folderBreadcrumbs(listing) : [];
  const otherRoots = listing ? listing.roots.filter(root => root.path !== listing.root) : [];

  return (
    <Dialog open={open} onOpenChange={next => { if (!next) props.onCancel(); }}>
      <DialogContent className="flex max-h-[85vh] min-h-0 w-full max-w-lg flex-col gap-4 sm:max-w-lg" data-web-folder-browser>
        <DialogHeader>
          <DialogTitle>{t("web_folder_browser.title")}</DialogTitle>
        </DialogHeader>

        <nav aria-label={t("web_folder_browser.breadcrumbs")} className="flex min-w-0 flex-wrap items-center gap-0.5 text-sm">
          {crumbs.map((crumb, index) => (
            <Fragment key={crumb.path}>
              {index > 0 ? <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : null}
              <Button
                variant="ghost"
                size="xs"
                className="max-w-40 truncate"
                aria-current={index === crumbs.length - 1 ? "page" : undefined}
                onClick={() => navigate(crumb.path)}
              >
                {crumb.name}
              </Button>
            </Fragment>
          ))}
          {otherRoots.map(root => (
            <Button key={root.path} variant="link" size="xs" className="ms-auto" onClick={() => navigate(root.path)}>
              {root.name}
            </Button>
          ))}
        </nav>

        <div className="min-h-48 flex-1 overflow-y-auto rounded-xl border border-border" aria-busy={loading}>
          {loading && !listing ? (
            <div className="space-y-2 p-3">{[0, 1, 2, 3].map(row => <Skeleton key={row} className="h-6 w-full" />)}</div>
          ) : error ? (
            <div className="flex flex-col items-start gap-2 p-4" role="alert">
              <p className="text-sm">{error}</p>
              <Button variant="outline" size="sm" onClick={() => void load(currentPath, showHidden)}>{t("web_folder_browser.retry")}</Button>
            </div>
          ) : listing && listing.entries.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{t("web_folder_browser.empty")}</p>
          ) : listing ? (
            listing.entries.map(entry => (
              <button
                key={entry.path}
                type="button"
                className="flex h-10 w-full items-center gap-2 border-b border-border px-3 text-start text-sm last:border-b-0 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                onClick={() => navigate(entry.path)}
                data-folder-entry={entry.name}
              >
                <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                {entry.hasOpencode ? <span className="text-xs text-muted-foreground">{t("web_folder_browser.has_agents")}</span> : null}
                {entry.isGitRepo ? <span className="text-xs text-muted-foreground">{t("web_folder_browser.git")}</span> : null}
              </button>
            ))
          ) : null}
        </div>
        {listing?.truncated ? <p className="text-xs text-muted-foreground">{t("web_folder_browser.truncated")}</p> : null}

        <div className="flex flex-wrap items-center gap-3">
          <Field orientation="horizontal" className="w-auto">
            <Checkbox
              id="web-folder-browser-hidden"
              checked={showHidden}
              onCheckedChange={checked => {
                setShowHidden(checked);
                void load(currentPath, checked);
              }}
            />
            <FieldLabel htmlFor="web-folder-browser-hidden" className="text-xs text-muted-foreground">{t("web_folder_browser.show_hidden")}</FieldLabel>
          </Field>
          {newFolderName === null ? (
            <Button variant="ghost" size="sm" className="ms-auto" disabled={!currentPath} onClick={() => { setNewFolderName(""); setCreateError(null); }}>
              <FolderPlus className="size-4" aria-hidden />
              {t("web_folder_browser.new_folder")}
            </Button>
          ) : (
            <form
              className="ms-auto flex items-center gap-2"
              onSubmit={event => { event.preventDefault(); void submitNewFolder(); }}
            >
              <Input
                autoFocus
                aria-label={t("web_folder_browser.new_folder_name")}
                placeholder={t("web_folder_browser.new_folder_name")}
                value={newFolderName}
                onChange={event => setNewFolderName(event.target.value)}
                className="h-8 w-44"
              />
              <Button type="submit" size="sm" disabled={creating || !newFolderName.trim()}>{t("web_folder_browser.create_folder")}</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => { setNewFolderName(null); setCreateError(null); }}>{t("common.cancel")}</Button>
            </form>
          )}
        </div>
        {createError ? <p className="text-xs text-destructive" role="alert">{createError}</p> : null}

        <DialogFooter>
          <Button variant="outline" onClick={props.onCancel}>{t("common.cancel")}</Button>
          <Button disabled={!currentPath || loading} onClick={() => { if (currentPath) props.onChoose(currentPath); }}>
            {t("web_folder_browser.choose")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type WebFolderPickerAvailability = "unknown" | "available" | "needs_owner" | "unavailable";

/**
 * Web stand-in for the desktop's native folder picker. Probes the owner-only route once per client
 * (a collaborator or a server with the flag off answers with an error), then `pick()` opens the
 * dialog and resolves to the chosen folder or null. Render `dialog` inside the dialog that asks.
 */
export function useWebFolderPicker(client: FolderBrowserClient | null, enabled: boolean): {
  availability: WebFolderPickerAvailability;
  pick: () => Promise<string | null>;
  dialog: ReactNode;
} {
  const [availability, setAvailability] = useState<WebFolderPickerAvailability>("unknown");
  const [pending, setPending] = useState<{ resolve: (path: string | null) => void } | null>(null);

  useEffect(() => {
    if (!enabled || !client) { setAvailability("unavailable"); return; }
    let cancelled = false;
    setAvailability("unknown");
    client.browseFolders().then(
      () => { if (!cancelled) setAvailability("available"); },
      (failure: unknown) => {
        if (cancelled) return;
        const status = typeof failure === "object" && failure !== null && "status" in failure ? failure.status : null;
        setAvailability(status === 401 || status === 403 ? "needs_owner" : "unavailable");
      },
    );
    return () => { cancelled = true; };
  }, [client, enabled]);

  const pick = useCallback(() => new Promise<string | null>(resolve => {
    setPending(previous => { previous?.resolve(null); return { resolve }; });
  }), []);
  const settle = (path: string | null) => {
    pending?.resolve(path);
    setPending(null);
  };

  const dialog = client && enabled ? (
    <FolderBrowserDialog open={pending !== null} client={client} onChoose={path => settle(path)} onCancel={() => settle(null)} />
  ) : null;
  return { availability, pick, dialog };
}

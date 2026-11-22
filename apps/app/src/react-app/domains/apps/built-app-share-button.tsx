import { useState } from "react";
import { t } from "@/i18n";
import { Blocks } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useLibraryCloud } from "../settings/use-library-cloud";
import { LibrarySharePage } from "../settings/pages/library-share-page";
import { useAppsClient } from "./use-apps";

export function BuiltAppShareButton({
  pluginId,
  title,
}: {
  pluginId: string;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t("extensions.add_plugin_share")}
      </Button>
      <BuiltAppShareDialog pluginId={pluginId} title={title} open={open} onOpenChange={setOpen} />
    </>
  );
}

/** The sharing dialog alone, for callers that open it from a menu item. */
export function BuiltAppShareDialog({
  pluginId,
  title,
  open,
  onOpenChange,
}: {
  pluginId: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const context = useAppsClient();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader className="sr-only">
          <DialogTitle>{t("secondary_ui.dashboard.share_named", { name: title })}</DialogTitle>
        </DialogHeader>
        {context.client && context.orgId && context.identityVerified ? (
          <AppSharing
            key={JSON.stringify(context.scope)}
            context={context}
            pluginId={pluginId}
            title={title}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <p role="status" className="text-sm">
            {t("secondary_ui.dashboard.share_artifact.sign_in")}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AppSharing({
  context,
  pluginId,
  title,
  onClose,
}: {
  context: ReturnType<typeof useAppsClient>;
  pluginId: string;
  title: string;
  onClose: () => void;
}) {
  // The caller verifies these before mounting. Avoid retaining another member's grants.
  if (!context.client || !context.orgId)
    throw new Error(t("secondary_ui.dashboard.share_artifact.sign_in"));
  const library = useLibraryCloud({
    client: context.client,
    organizationId: context.orgId,
    baseUrl: JSON.stringify(context.scope),
    enabled: true,
  });
  if (library.sharingError)
    return (
      <div className="flex items-center gap-2">
        <p role="alert" className="text-sm">
          {t("secondary_ui.dashboard.share_artifact.load_failed")}
        </p>
        <Button variant="outline" onClick={() => void library.refresh()}>
          {t("session.remote_task_retry")}
        </Button>
      </div>
    );
  if (!library.ready || !library.directory)
    return (
      <div role="status" aria-label={t("secondary_ui.dashboard.share_artifact.checking")}>
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="mt-4 h-40 w-full" />
      </div>
    );
  const plugin = library.pluginById.get(pluginId);
  if (!plugin || !library.ownedPluginIds.has(pluginId))
    return (
      <p role="status" className="text-sm">
        {t("secondary_ui.dashboard.share_artifact.owner_only")}
      </p>
    );
  if (!library.grantsReadyFor(pluginId))
    return <Skeleton className="h-40 w-full" />;
  return (
    <LibrarySharePage
      name={title}
      description={null}
      taxonomy="plugin"
      icon={<Blocks className="size-4" />}
      directory={library.directory}
      initialAudience={library.audienceFor(pluginId)}
      canShareOrgWide={context.canManage}
      onCancel={onClose}
      onSave={async (targets) => {
        await library.setAudience(pluginId, targets);
        onClose();
      }}
    />
  );
}

import { PermissionModeMenu } from "./permission-mode-menu";
import { t } from "@/i18n";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Hand, LoaderCircle, ShieldAlert, ShieldCheck } from "lucide-react";
import type { OpenworkServerClient, WorkspaceRunMode } from "@/app/lib/openwork-server";
import { isDesktopRuntime } from "@/app/lib/runtime-env";
import { toast } from "@/components/ui/sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useComexWorkspaceEnabled, useDesktopRestriction } from "@/react-app/domains/cloud/desktop-config-provider";
import { useFeatureFlagsPreferences } from "@/react-app/domains/settings/state/feature-flags-preferences";

type Props = { client: OpenworkServerClient | null; workspaceId: string | null; busy: boolean };

const modes = [
  { value: "approve", labelKey: "session_ui.run_mode_approve", descriptionKey: "session_ui.run_mode_approve_description", icon: Hand },
  { value: "default", labelKey: "session_ui.run_mode_default", descriptionKey: "session_ui.run_mode_default_description", icon: ShieldCheck },
  { value: "run-everything", labelKey: "session_ui.run_mode_run_everything", descriptionKey: "session_ui.run_mode_run_everything_description", icon: ShieldAlert },
] satisfies { value: WorkspaceRunMode; labelKey: string; descriptionKey: string; icon: typeof Hand }[];

export function WorkspaceRunModeMenu(props: Props) {
  const { workspaceRunModeEnabled } = useFeatureFlagsPreferences();
  const comex = useComexWorkspaceEnabled();
  const restricted = useDesktopRestriction("allowControlSettings");
  if (comex && !restricted && props.client && props.workspaceId) return <PermissionModeMenu key={`${props.client.baseUrl}:${props.workspaceId}`} client={props.client} workspaceId={props.workspaceId} busy={props.busy} />;
  if ((!workspaceRunModeEnabled && !comex) || restricted || !isDesktopRuntime() || !props.client || !props.workspaceId) return null;
  // Remount on endpoint/workspace changes so a pending confirmation cannot
  // apply the previous pane's choice to a newly selected workspace.
  return <WorkspaceRunModePicker key={`${props.client.baseUrl}:${props.workspaceId}`} client={props.client} workspaceId={props.workspaceId} busy={props.busy} />;
}

function WorkspaceRunModePicker({ client, workspaceId, busy }: { client: OpenworkServerClient; workspaceId: string; busy: boolean }) {
  const comex = useComexWorkspaceEnabled();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const queryClient = useQueryClient();
  const queryKey = ["workspace-run-mode", client.baseUrl, workspaceId];
  const mode = useQuery({ queryKey, queryFn: () => client.getWorkspaceRunMode(workspaceId), retry: false });
  const mutation = useMutation({
    mutationKey: queryKey,
    mutationFn: (value: WorkspaceRunMode) => client.setWorkspaceRunMode(workspaceId, value),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKey, result);
      setConfirm(false);
      setOpen(false);
      if (result.refreshPending) toast.warning(result.reason ?? t("session_ui.run_mode_saved_reload"));
      else toast.success(t("session_ui.run_mode_updated"));
    },
    onError: (error: Error) => {
      toast.error(error.message);
      void mode.refetch();
    },
  });
  const selected = modes.find((item) => item.value === mode.data?.mode);
  const label = mode.isError ? t("session_ui.run_mode_unavailable_short") : selected ? t(selected.labelKey) : mode.isPending ? t("session_ui.loading") : t("session_ui.run_mode_custom");
  const displayLabel = comex ? ({ approve: "Pedir aprobación", default: "Permisos del espacio", "run-everything": "Aprobar automáticamente" })[mode.data?.mode ?? "default"] : label;
  const Icon = mode.data?.supported === false || mode.isError || mode.data?.refreshPending ? ShieldAlert : selected?.icon ?? ShieldCheck;
  const locked = busy || mutation.isPending || mode.isFetching || !mode.data?.supported;
  const select = (value: unknown) => {
    if (locked || (value !== "default" && value !== "approve" && value !== "run-everything")) return;
    if (value === "run-everything") {
      setOpen(false);
      setConfirm(true);
    } else mutation.mutate(value);
  };
  return (
    <>
      <DropdownMenu open={open} onOpenChange={(next) => { setOpen(next); if (next) void mode.refetch(); }}>
        <DropdownMenuTrigger
          data-testid="workspace-run-mode-trigger"
          aria-label={t(mode.data?.refreshPending ? "session_ui.run_mode_trigger_pending" : "session_ui.run_mode_trigger", { mode: label })}
          title={t(mode.data?.refreshPending ? "session_ui.run_mode_trigger_pending_title" : "session_ui.run_mode_trigger", { mode: label })}
          className={`inline-flex h-9 ${comex ? "max-w-52 gap-1.5 px-1.5" : "w-9"} shrink-0 items-center justify-center rounded-md transition-colors hover:bg-gray-3 ${mode.data?.mode === "run-everything" || mode.data?.refreshPending ? "text-orange-600 dark:text-orange-400" : "text-gray-10"}`}
        >
          {mutation.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Icon className="size-4 shrink-0" />}
          {comex ? <span className="hidden truncate text-sm @min-[560px]/composer:block">{mode.isError ? "Permisos no disponibles" : mode.isPending ? "Consultar permisos" : displayLabel}</span> : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" sideOffset={10} className="w-[min(390px,calc(100vw-32px))] p-2">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-3 text-sm">{t("session_ui.run_mode_question")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={mode.data?.mode ?? ""}>
              {modes.map((item) => (
                <DropdownMenuRadioItem key={item.value} value={item.value} onClick={() => select(item.value)} aria-label={t(item.labelKey)} data-testid={`run-mode-${item.value}`} disabled={locked} className={`gap-3 py-3 ${item.value === "run-everything" ? "text-orange-600 dark:text-orange-400" : ""}`}>
                  <item.icon className="size-5" />
                  <span className="min-w-0">
                    <span className="block">{t(item.labelKey)}</span>
                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{t(item.descriptionKey)}</span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <p className="px-3 py-2 text-xs text-muted-foreground">{t("session_ui.run_mode_scope_note")}</p>
          {busy ? <p role="status" className="px-3 pb-2 text-xs text-muted-foreground">{t("session_ui.run_mode_wait_busy")}</p> : null}
          {mode.isError ? <p role="alert" className="px-3 pb-2 text-xs text-destructive">{t("session_ui.run_mode_unavailable")} {mode.error.message}</p> : null}
          {mode.data?.reason ? <p role="status" className="px-3 pb-2 text-xs text-muted-foreground">{mode.data.reason}</p> : null}
          {mode.data?.refreshPending ? <p role="status" className="px-3 pb-2 text-xs text-orange-600">{t("session_ui.run_mode_refresh_pending")}</p> : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("session_ui.run_mode_confirm_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("session_ui.run_mode_confirm_body")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={locked} onClick={() => mutation.mutate("run-everything")}>{t("session_ui.run_mode_confirm_action")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

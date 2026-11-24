import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  OpenworkServerClient,
  SaveWorkspaceResourceResult,
  WorkspaceResourceInput,
} from "@/app/lib/openwork-server";

import { specialistErrorMessage } from "./error-message";

type SaveToWorkspaceProps = {
  applicationId: string;
  client: OpenworkServerClient;
  resource: WorkspaceResourceInput;
  workspaceId?: string;
};

type SaveToWorkspaceMenuProps = SaveToWorkspaceProps & {
  className?: string;
};

function useSaveToWorkspaceMutation({
  applicationId,
  client,
  resource,
  workspaceId,
}: SaveToWorkspaceProps) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (): Promise<SaveWorkspaceResourceResult> =>
      client.saveSpecialistWorkspaceResource(applicationId, resource, workspaceId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["specialist-workspace-resources", client.baseUrl, applicationId],
      });
    },
  });

  // El estado es breve: vuelve a la acción para poder guardar otro recurso.
  React.useEffect(() => {
    if (!mutation.isSuccess) return;
    const timer = window.setTimeout(() => mutation.reset(), 2500);
    return () => window.clearTimeout(timer);
  }, [mutation.isSuccess, mutation.reset]);

  return mutation;
}

type MutationStatus = ReturnType<typeof useSaveToWorkspaceMutation>;

function SaveToWorkspaceAction({ mutation }: { mutation: MutationStatus }) {
  let label = "Guardar en workspace";
  if (mutation.isPending) label = "Guardando…";
  else if (mutation.isSuccess) {
    label = mutation.data?.created ? "Guardado en el workspace" : "Ya estaba guardado";
  } else if (mutation.error) {
    label = specialistErrorMessage(mutation.error, "No se pudo guardar en el workspace.");
  }

  return (
    <DropdownMenuItem
      className="flex-col items-start gap-0.5"
      onClick={() => {
        if (mutation.isPending) return;
        mutation.mutate();
      }}
      closeOnClick={false}
      disabled={mutation.isPending}
    >
      <span>{label}</span>
      <span className="text-muted-foreground text-xs font-normal">
        Queda en proyecto/recursos/ y no se pierde al recargar
      </span>
    </DropdownMenuItem>
  );
}

/** Opción reutilizable para menús «…» que ya existen en la interfaz. */
export function SaveToWorkspaceMenuItem(props: SaveToWorkspaceProps) {
  const mutation = useSaveToWorkspaceMutation(props);
  if (!props.applicationId || !props.client) return null;
  return <SaveToWorkspaceAction mutation={mutation} />;
}

/** Menú de tres puntos para guardar un recurso en el workspace de la app. */
export function SaveToWorkspaceMenu({
  className,
  ...props
}: SaveToWorkspaceMenuProps) {
  const mutation = useSaveToWorkspaceMutation(props);

  if (!props.applicationId) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={className ?? "size-8 shrink-0"}
            aria-label="Más opciones"
            title="Más opciones"
          />
        }
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <SaveToWorkspaceAction mutation={mutation} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

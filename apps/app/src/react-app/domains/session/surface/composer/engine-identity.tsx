import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ModelOption, ModelRef } from "@/app/types";
import { createOpenworkServerClient, type EngineV2PreviewStatus } from "@/app/lib/openwork-server";
import { resolveOpenworkConnection } from "@/react-app/shell/openwork-connection";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function engineIdentity(status?: EngineV2PreviewStatus) {
  if (!status) return "Sin verificar";
  if (status.chatRouting && status.running) return status.connectionSource === "installed" ? "OpenCode instalado" : "OpenCode v2";
  if (status.chatRouting) return "OpenCode v2 desconectado";
  return "OpenCode legacy";
}

/** One quiet entry; connection details are fetched only when requested. */
export function EngineIdentity({ model, option }: { model: ModelRef; option?: ModelOption }) {
  const [open, setOpen] = useState(false);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const changed = () => { setOpen(false); setGeneration(value => value + 1); };
    window.addEventListener("openwork-server-settings-changed", changed);
    return () => window.removeEventListener("openwork-server-settings-changed", changed);
  }, []);
  const query = useQuery({ queryKey: ["composer-engine-identity", generation], enabled: open, staleTime: 0, gcTime: 0, retry: false,
    queryFn: async () => {
      const connection = await resolveOpenworkConnection();
      if (!connection.normalizedBaseUrl || !connection.resolvedToken) throw new Error("Sin conexión");
      const status = await createOpenworkServerClient({ baseUrl: connection.normalizedBaseUrl, token: connection.resolvedToken, hostToken: connection.resolvedHostToken }).getEngineV2PreviewStatus();
      const hostname = new URL(connection.normalizedBaseUrl).hostname;
      return { status, local: ["localhost", "127.0.0.1", "[::1]"].includes(hostname) };
    },
  });
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<Button type="button" variant="ghost" size="sm" className="h-7 px-1.5 text-xs text-muted-foreground" aria-label="Ver motor y conexión" />}>OpenCode</PopoverTrigger>
    <PopoverContent side="top" align="end" className="w-72" aria-label="Motor y conexión">
      <p className="text-sm font-medium">Motor y conexión</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
        <dt className="text-muted-foreground">Motor</dt><dd>{query.isError ? "No se pudo verificar" : query.isFetching ? "Consultando…" : engineIdentity(query.data?.status)}</dd>
        <dt className="text-muted-foreground">Versión</dt><dd>{query.data?.status.version ?? "Sin verificar"}</dd>
        <dt className="text-muted-foreground">Conexión</dt><dd>{query.data ? query.data.local ? "Esta computadora" : "Servidor remoto" : "Sin verificar"}</dd>
        <dt className="text-muted-foreground">Proveedor</dt><dd className="break-all">{model.providerID}</dd>
        <dt className="text-muted-foreground">Modelo</dt><dd className="break-all">{model.modelID}</dd>
      </dl>
      <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Funciones informadas por el motor</summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
          <dt className="text-muted-foreground">Herramientas</dt><dd>{option?.guideObservation?.tools === true ? "Admitidas" : option?.guideObservation?.tools === false ? "No declaradas" : "Sin verificar"}</dd>
          <dt className="text-muted-foreground">Imágenes</dt><dd>{option?.guideObservation ? option.guideObservation.input.includes("image") ? "Admitidas" : "No declaradas" : "Sin verificar"}</dd>
          <dt className="text-muted-foreground">Esfuerzo</dt><dd>{option?.guideObservation?.efforts.length ? option.guideObservation.efforts.join(", ") : "Sin opciones declaradas"}</dd>
          <dt className="text-muted-foreground">Contexto</dt><dd>{option?.guideObservation?.context?.toLocaleString("es-AR") ?? "Sin verificar"}</dd>
        </dl>
      </details>
      {query.data && <p className="text-xs text-muted-foreground">{query.isError ? "Último dato conocido" : "Consultado"}: {new Date(query.dataUpdatedAt).toLocaleString("es-AR")}</p>}
      {model.providerID === "opencode-go" && <p className="text-xs text-muted-foreground">OpenCode Go requiere suscripción. La conexión al motor no confirma el plan ni el saldo.</p>}
      {query.isError && <Button size="sm" variant="outline" onClick={() => void query.refetch()}>Volver a verificar</Button>}
    </PopoverContent>
  </Popover>;
}

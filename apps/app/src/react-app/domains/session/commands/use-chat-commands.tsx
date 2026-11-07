import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import type { Client, McpServerEntry, McpStatusMap, ModelRef } from "@/app/types";
import type { OpenworkServerClient, OpenworkSessionMessage } from "@/app/lib/openwork-server";
import { unwrap } from "@/app/lib/opencode";
import { isOpencodeV2BaseUrl } from "@/app/lib/opencode-v2-adapter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import { useSessionManagementStore } from "../sidebar/session-management-store";
import { useWorkbenchStore } from "../chat/workbench-store";
import { useChatCommandHost } from "./host";
import { chatCommandOptions, type ChatCommandId } from "./catalog";
import { downloadShare, shareTranscript } from "./share-snapshot";
import { SketchDialog } from "./sketch-dialog";
import { useLocalPet } from "./local-pet";

export type ChatCommandTarget = {
  client: OpenworkServerClient | null; nativeClient: Client | null; workspaceId: string; opencodeBaseUrl: string;
  sessionId?: string; title?: string; secondary?: boolean; loadTranscript?: () => Promise<OpenworkSessionMessage[]>;
  fork?: () => Promise<void>; contextLimit?: number; messages?: readonly OpenworkSessionMessage[];
};
type Props = ChatCommandTarget & { busy: boolean; canAttach: boolean; model: ModelRef; onAttach: (files: File[]) => void; listMcp?: () => Promise<{ servers: McpServerEntry[]; statuses: McpStatusMap; status: string | null }> };
const compactionReceipt = z.object({ data: z.object({ sessionID: z.string(), id: z.string(), type: z.literal("compaction") }) });
const INITIAL = { kind: null, text: "" };
export function useChatCommands(p: Props) {
  const host = useChatCommandHost(); const pinStore = useSessionManagementStore;
  const pinned = pinStore(state => Boolean(p.sessionId && state.pinnedIds.includes(p.sessionId)));
  const feature = useQuery({ queryKey: ["comex-feature", p.client?.baseUrl], queryFn: () => p.client ? p.client.getComexFeatures() : Promise.resolve({ enabled: false, comexChatCommands: false }), enabled: Boolean(p.client), staleTime: 15_000, retry: false });
  const enabled = feature.data?.comexChatCommands === true;
  const [dialog, setDialog] = useState<{ kind: ChatCommandId | null; text: string }>(INITIAL);
  const [pending, setPending] = useState(false); const inFlight = useRef(false); const [error, setError] = useState("");
  const [connections, setConnections] = useState<{ servers: McpServerEntry[]; statuses: McpStatusMap; status: string | null } | null>(null);
  const owner = `${p.client?.baseUrl}:${p.workspaceId}:${p.sessionId ?? "new"}`; const ownerRef = useRef(owner); ownerRef.current = owner;
  useEffect(() => { setDialog(INITIAL); setError(""); setConnections(null); }, [owner]);
  const hasSession = Boolean(p.sessionId?.startsWith("ses_")); const nativeV2 = isOpencodeV2BaseUrl(p.opencodeBaseUrl);
  const canArchive = Boolean(host && p.nativeClient); const canFork = Boolean(p.fork); const secondary = Boolean(p.secondary); const hasMessages = Boolean(p.messages?.length);
  const options = useMemo(() => chatCommandOptions({ hasSession, busy: p.busy, nativeV2, canArchive, canFork, canAttach: p.canAttach, secondary, pending, pinned, hasMessages }), [hasSession, p.busy, nativeV2, canArchive, canFork, p.canAttach, secondary, pending, pinned, hasMessages]);
  const work = async (job: () => Promise<void>) => {
    if (inFlight.current) return; inFlight.current = true; setPending(true); setError(""); const current = owner;
    try { await job(); } catch (e) { if (ownerRef.current === current) setError(e instanceof Error ? e.message : "No se pudo completar el comando."); }
    finally { inFlight.current = false; setPending(false); }
  };
  const run = async (id: ChatCommandId) => {
    if (!enabled) return;
    const disabled = options.find(option => option.appCommand === id)?.disabledReason;
    if (disabled) { toast.error(disabled); return; }
    if (id === "init") return; // Composer inserts the engine's own /init command.
    if (id === "pin") { if (p.sessionId) pinStore.getState().togglePin(p.sessionId); return; }
    if (id === "pet") { useLocalPet.getState().toggle(); return; }
    if (id === "compact" || id === "draw" || id === "status") { setError(""); setDialog({ kind: id, text: "" }); return; }
    await work(async () => {
      const current = owner;
      if (id === "archive" && p.sessionId && host) { const result = await host.archive(p.sessionId); if (result.kind === "verification_failed" || result.kind === "archive_outcome_unknown") throw new Error(result.message); return; }
      if (id === "fork" && p.fork) { await p.fork(); return; }
      if (id === "side" && p.nativeClient && p.sessionId) {
        const session = unwrap(await p.nativeClient.session.create({ title: "Chat lateral" }));
        if (!session?.id) throw new Error("El motor no devolvió el chat lateral.");
        if (ownerRef.current !== current) { toast("Se creó Chat lateral. Lo podés abrir desde el proyecto."); return; }
        const workbench = useWorkbenchStore.getState();
        workbench.openTab({ workspaceId: p.workspaceId, sessionId: session.id, title: session.title ?? "Chat lateral" });
        workbench.setSideChat({ workspaceId: p.workspaceId, sessionId: p.sessionId, title: p.title ?? "Chat principal" }, { workspaceId: p.workspaceId, sessionId: session.id, title: session.title ?? "Chat lateral" }); return;
      }
      if (id === "share") {
        if (!p.loadTranscript) throw new Error("No se pudo leer el historial completo. Volvé a abrir el chat.");
        const text = shareTranscript(await p.loadTranscript());
        if (text.length > 2_000_000) throw new Error("El chat supera el límite de exportación. Exportá un tramo más corto.");
        if (ownerRef.current === current) setDialog({ kind: "share", text }); return;
      }
      if (id === "mcp") {
        if (!p.listMcp) throw new Error("Las conexiones no están disponibles en esta vista.");
        const value = await p.listMcp(); if (ownerRef.current === current) { setConnections(value); setDialog({ kind: "mcp", text: "" }); } return;
      }
    });
  };
  const limits = useQuery({ queryKey: ["chat-command-limits", p.client?.baseUrl, p.workspaceId], queryFn: () => p.client ? p.client.getChatUsageLimits(p.workspaceId) : null, enabled: dialog.kind === "status" && isOpencodeV2BaseUrl(p.opencodeBaseUrl), retry: false, staleTime: 30_000 });
  const latest = dialog.kind === "status" ? p.messages?.findLast(message => message.info.role === "assistant") : undefined;
  const tokens = latest?.info.role === "assistant" ? latest.info.tokens : null;
  const used = tokens ? tokens.input + tokens.output + tokens.cache.read + tokens.cache.write : null;
  const close = () => { if (!pending) { setDialog(INITIAL); setError(""); } };
  const surface = <>
    {error && !dialog.kind && <p role="alert" className="px-2 py-1 text-xs text-destructive">{error}</p>}
    <SketchDialog open={enabled && dialog.kind === "draw"} onClose={close} onAttach={p.onAttach} />
    <Dialog open={enabled && dialog.kind !== null && dialog.kind !== "draw"} onOpenChange={value => { if (!value) close(); }}><DialogContent aria-describedby={undefined} className="max-h-[85dvh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>{dialog.kind === "compact" ? "Compactar contexto" : dialog.kind === "share" ? "Compartir una copia del chat" : dialog.kind === "mcp" ? "Conexiones MCP" : "Estado del chat"}</DialogTitle></DialogHeader>
      {dialog.kind === "compact" && <><p className="text-sm text-muted-foreground">OpenCode resumirá el contexto con el modelo actual. Puede consumir tokens y perder detalles; el historial se conserva. Si hay una tarea en curso, el motor decide cuándo ejecutarlo.</p><DialogFooter><Button variant="ghost" onClick={close}>Cancelar</Button><Button disabled={pending} onClick={() => void work(async () => { if (!p.client || !p.sessionId) return; const receipt = compactionReceipt.safeParse(await p.client.compactChat(p.workspaceId, p.sessionId)); if (!receipt.success || receipt.data.data.sessionID !== p.sessionId) throw new Error("El motor no confirmó la solicitud. Revisá el estado antes de reintentar."); setDialog(INITIAL); toast("OpenCode admitió la compactación; se verá en el chat cuando termine."); })}>Solicitar compactación</Button></DialogFooter></>}
      {dialog.kind === "share" && <><p className="text-xs text-muted-foreground">Copia local del texto de usuario y asistente. Revisá datos privados antes de descargar. No incluye herramientas, razonamiento ni archivos adjuntos.</p><Textarea aria-label="Texto de la copia para compartir" className="min-h-64 text-xs" maxLength={2_000_000} value={dialog.text} onChange={event => setDialog({ ...dialog, text: event.target.value })} /><DialogFooter><Button variant="ghost" onClick={close}>Cancelar</Button><Button disabled={!dialog.text.trim()} onClick={() => { try { downloadShare(p.title ?? "Conversación", dialog.text); close(); } catch (e) { setError(e instanceof Error ? e.message : "No se pudo exportar."); } }}>Descargar copia HTML</Button></DialogFooter></>}
      {dialog.kind === "status" && <><dl className="space-y-3 text-sm">{[["Chat", p.sessionId], ["Modelo", `${p.model.providerID}/${p.model.modelID}`], ["Actividad", p.busy ? "En curso" : "En pausa"], ["Tokens de la última interacción", used === null ? "Sin datos" : used.toLocaleString()], ["Ventana del modelo", p.contextLimit ? `${p.contextLimit.toLocaleString()} tokens` : "Sin datos"]].map(([label, value]) => <div key={label} className="flex justify-between gap-4"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 break-all text-right">{value}</dd></div>)}</dl><UsageLimits value={limits.data} pending={limits.isLoading} failed={limits.isError} /><p className="text-xs text-muted-foreground">Los tokens de una respuesta no equivalen al contexto total ocupado. Los límites solo se muestran cuando el proveedor los informa.</p></>}
      {dialog.kind === "mcp" && <div className="divide-y divide-border">{connections?.status && <p role="status" className="py-2 text-xs text-muted-foreground">{connections.status}</p>}{connections?.servers.length ? connections.servers.map(server => <div key={server.name} className="flex min-h-10 items-center justify-between gap-3 py-2 text-sm"><span className="min-w-0 truncate">{server.name}</span><span className="text-xs text-muted-foreground">{mcpStatusLabel(connections.statuses[server.name]?.status)}</span></div>) : <p className="py-2 text-sm text-muted-foreground">No hay conexiones configuradas.</p>}</div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </DialogContent></Dialog>
  </>;
  return { enabled, options, run, surface, pending };
}
const meter = z.object({ percent: z.number().min(0).max(100), limited: z.boolean(), resetsAt: z.number() });
const usageEnvelope = z.object({ data: z.object({ go: z.object({ rolling: meter, weekly: meter, monthly: meter }).optional(), budgets: z.array(z.object({ limit: z.number(), spent: z.number(), resetsAt: z.number() })).optional() }).nullable() });
function UsageLimits({ value, pending, failed }: { value: unknown; pending: boolean; failed: boolean }) {
  const data = usageEnvelope.safeParse(value);
  const go = data.success ? data.data.data?.go : undefined;
  const budgets = data.success ? data.data.data?.budgets ?? [] : [];
  return <div className="border-t border-border pt-3 text-sm"><p className="mb-2 font-medium">Límites de OpenCode</p>{go ? Object.entries(go).map(([period, meter]) => <p key={period} className="text-xs text-muted-foreground">{period === "rolling" ? "Ventana actual" : period === "weekly" ? "Semana" : "Mes"}: {meter.percent}% usado{meter.limited ? " · Límite alcanzado" : ""} · Renueva {new Date(meter.resetsAt).toLocaleString()}</p>) : !budgets.length && <p className="text-xs text-muted-foreground">{pending ? "Consultando al motor…" : failed ? "No se pudieron consultar los límites." : "El motor no informa límites para esta conexión."}</p>}{budgets.slice(0, 20).map((budget, index) => <p key={index} className="text-xs text-muted-foreground">Presupuesto {index + 1}: {budget.spent} / {budget.limit} USD · Renueva {new Date(budget.resetsAt).toLocaleString()}</p>)}{budgets.length > 20 && <p className="text-xs text-muted-foreground">Mostrando 20 de {budgets.length} presupuestos.</p>}</div>;
}

function mcpStatusLabel(status?: string) {
  const labels: Record<string, string> = { connected: "Conectado", disabled: "Desactivado", failed: "Error de conexión", needs_auth: "Requiere iniciar sesión", reconnect_required: "Requiere reconectar", needs_client_registration: "Requiere configuración" };
  return status ? labels[status] ?? status : "Sin confirmar";
}

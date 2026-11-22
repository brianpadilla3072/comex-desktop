import type { SlashCommandOption } from "@/app/types";

export type ChatCommandId = "archive" | "fork" | "compact" | "share" | "draw" | "status" | "pin" | "init" | "side" | "mcp" | "pet" | "design" | "marca";
export type ChatCommand = { id: ChatCommandId; name: string; label: string; description: string; aliases: readonly string[]; session?: boolean; group?: string };
export const CHAT_COMMANDS: readonly ChatCommand[] = [
  { id: "archive", name: "archivar", label: "Archivar", description: "Archivar el chat actual", aliases: ["archive"], session: true },
  { id: "fork", name: "bifurcar", label: "Bifurcar chat", description: "Continuar una copia del historial en otro chat", aliases: ["fork", "branch"], session: true },
  { id: "compact", name: "compactar", label: "Compactar", description: "Reducir el contexto con el modelo actual", aliases: ["compact", "summarize"], session: true },
  { id: "share", name: "compartir", label: "Compartir chat", description: "Revisar y descargar una copia HTML del chat", aliases: ["share", "export"], session: true },
  { id: "draw", name: "dibujar", label: "Dibujar", description: "Hacer un boceto y adjuntarlo al mensaje", aliases: ["draw", "sketch"] },
  { id: "status", name: "estado", label: "Estado", description: "Modelo, contexto y límites disponibles", aliases: ["status"], session: true },
  { id: "pin", name: "fijar", label: "Fijar chat", description: "Fijar o quitar el chat de la barra lateral", aliases: ["pin"], session: true },
  { id: "init", name: "iniciar", label: "Iniciar", description: "Revisar las instrucciones AGENTS.md del proyecto", aliases: ["init"] },
  { id: "side", name: "lateral", label: "Lateral", description: "Abrir un chat paralelo guardado en este proyecto", aliases: ["side", "sidechat"], session: true },
  { id: "mcp", name: "mcp", label: "MCP", description: "Consultar el estado de las conexiones", aliases: ["connections", "conexiones"] },
  { id: "pet", name: "mascota", label: "Mascota", description: "Mostrar u ocultar la mascota local de la app", aliases: ["pet"] },
  { id: "design", name: "diseño", label: "Diseño", description: "Abrir el estudio de diseño (galería o el diseño en curso)", aliases: ["design", "diseno"], group: "Design" },
  { id: "marca", name: "marca", label: "Sistema de marca", description: "Cargar el contexto del sistema de diseño de marca y arrancar el flujo", aliases: ["brand", "sistema-marca"], group: "Design" },
];
export type ChatCommandOption = SlashCommandOption & { appCommand: ChatCommandId; label: string; aliases: readonly string[]; disabledReason?: string; group?: string };
export type ChatCommandRuntime = { hasSession: boolean; busy: boolean; nativeV2: boolean; canArchive: boolean; canFork: boolean; canAttach: boolean; secondary: boolean; pending?: boolean; pinned?: boolean; hasMessages?: boolean; designStudioEnabled?: boolean };
export function chatCommandOptions(runtime: ChatCommandRuntime): ChatCommandOption[] {
  return CHAT_COMMANDS.map(command => {
    const disabledReason = runtime.pending ? "Hay otro comando en curso." : command.session && !runtime.hasSession ? "Abre una conversación primero."
      : command.id === "archive" && !runtime.canArchive ? "No hay conexión para archivar."
      : command.id === "fork" && runtime.hasMessages === false ? "Todavía no hay mensajes para bifurcar."
      : command.id === "fork" && !runtime.canFork ? "No hay conexión para bifurcar."
      : command.id === "draw" && !runtime.canAttach ? "El modelo actual no admite adjuntos."
      : command.id === "side" && runtime.secondary ? "Ya estás en un chat lateral." 
      : (command.id === "design" || command.id === "marca") && runtime.designStudioEnabled === false ? "El estudio de diseño no está disponible."
      : undefined;
    return { id: `app:${command.id}`, name: command.name, label: command.id === "pin" && runtime.pinned ? "Quitar de fijados" : command.label,
      description: command.description, source: "command", appCommand: command.id, aliases: command.aliases, group: command.group, ...(disabledReason ? { disabledReason } : {}) };
  });
}
const commandByName = new Map(CHAT_COMMANDS.flatMap(command => [command.name, ...command.aliases].map(name => [name, command])));
export function resolveChatCommand(text: string): ChatCommand | null {
  const match = text.trim().match(/^\/([a-z0-9_-]+)\s*$/i);
  return match?.[1] ? commandByName.get(match[1].toLowerCase()) ?? null : null;
}
export function appCommandForOption(command: SlashCommandOption): ChatCommandId | null {
  return CHAT_COMMANDS.find(item => command.id === `app:${item.id}`)?.id ?? null;
}

/**
 * The video actions, shared by the chat's `+` menu and the video panel, so both
 * send exactly the same request. Only "grabar" is different: it opens the
 * recorder dialog instead of filling a prompt.
 */
export type VideoAction = "nuevo" | "grabar" | "analizar" | "renderizar";

/** Prompt for the actions that ask the agent for work. */
export function videoActionPrompt(
  action: Exclude<VideoAction, "grabar">,
  input: { sessionId?: string | null; workspaceId?: string | null } = {},
): string {
  const session = input.sessionId ? `"sessionId": "${input.sessionId}", ` : "";
  const workspace = input.workspaceId ? `"workspaceId": "${input.workspaceId}", ` : "";
  switch (action) {
    case "nuevo":
      return `Quiero hacer un video con video-studio, usando las referencias de la biblioteca (la propia en video-library/ o la global si no hay). Preguntame el brief y creá el proyecto. Al crear la carpeta en video-projects/<slug>/, escribí project.json con {"title": "<nombre corto del video>", ${session}${workspace}"createdAt": "<ISO>"} para que el video quede en el panel. Si existe video-settings.json con voice, usá esa voz.`;
    case "analizar":
      return "Analizá las referencias de la biblioteca de video (primero la propia del workspace en video-library/ con --library video-library, después la global): listá los sets con refs.mjs list, analizá sus videos con video-inspiracion y dejá el style.json y el style.md del set.";
    case "renderizar":
      return "Renderizá el video de este proyecto con video-studio y mostrame los stills antes del render final.";
  }
}

/** What to ask after the voice reference has been uploaded. */
export function videoVoiceSavedPrompt(path: string): string {
  return `Grabé la referencia de voz en ${path}. Convertila a WAV 48 kHz mono, normalizala y creá el perfil con voz-local.`;
}

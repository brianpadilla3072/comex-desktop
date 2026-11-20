import { OpenworkServerError } from "@/app/lib/openwork-server";

export const SPECIALIST_DESKTOP_ONLY_MESSAGE =
  "Esta acción solo está disponible en la app de escritorio. Desde el navegador puedes consultar la aplicación, pero no modificarla.";

/**
 * The message a person sees when a specialist action fails. Writes need the
 * desktop host's privileges, so a browser session gets a 401 "Invalid host
 * token" from the server; that is translated instead of shown raw.
 */
export function specialistErrorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof OpenworkServerError && cause.status === 401) return SPECIALIST_DESKTOP_ONLY_MESSAGE;
  return cause instanceof Error && cause.message.trim() ? cause.message : fallback;
}

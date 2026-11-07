import type { OpenworkSessionMessage } from "@/app/lib/openwork-server";
import { splitV2Prompt } from "../../../../app/lib/v2-prompt-context";
export function shareTranscript(messages: readonly OpenworkSessionMessage[]) {
  const blocks: string[] = []; let length = 0;
  for (const { info, parts } of messages) {
    if (info.role !== "user" && info.role !== "assistant") continue;
    const texts: string[] = [];
    for (const part of parts) {
      if (part.type !== "text" || part.synthetic) continue;
      if (length + part.text.length > 2_000_000) throw new Error("El chat supera el límite de exportación de 2 millones de caracteres.");
      const text = info.role === "user" ? splitV2Prompt(part.text).segments.flatMap(segment => segment.kind === "attachment" ? [] : [segment.text]).join("") : part.text;
      length += text.length; texts.push(text);
    }
    const text = texts.join("\n\n");
    if (text.trim()) blocks.push(`${info.role === "user" ? "Usuario" : "Asistente"}\n${text}`);
  }
  return blocks.join("\n\n---\n\n").replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,})\b/g, "[secreto omitido]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, "$1 [secreto omitido]")
    .replace(/\b((?:api[_ -]?key|access[_ -]?token|password|contraseña|secret)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;]+)/gi, "$1[secreto omitido]");
}
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
export function buildShareHtml(title: string, text: string) {
  if (text.length > 2_000_000) throw new Error("El chat supera el límite de exportación de 2 millones de caracteres.");
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeHtml(title)}</title><style>body{font:16px/1.6 system-ui;max-width:800px;margin:40px auto;padding:0 20px}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>${escapeHtml(title)}</h1><p>Copia del chat exportada el ${new Date().toLocaleDateString("es-AR")}. Incluye solo texto visible de usuario y asistente.</p><pre>${escapeHtml(text)}</pre></html>`;
}
export function downloadShare(title: string, text: string) {
  const url = URL.createObjectURL(new Blob([buildShareHtml(title, text)], { type: "text/html;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = "chat-compartido.html"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

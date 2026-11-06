import { readFile, realpath } from "node:fs/promises";
import { z } from "zod";
import { server as browserTools } from "../opencode-plugins/openwork-chrome-devtools.js";
import { addProviderSafeTool } from "../opencode-plugins/provider-safe-tool-schema.js";
import { approvalLoopbackFetch } from "../opencode-plugins/approval-loopback-fetch.js";

export const installedBrowserDescriptor = z.object({ directory: z.string(), url: z.string().url(), token: z.string().min(1) });
type Tool = { name: string; description: string; input: Record<string, unknown>; options: { codemode: boolean };
  execute(input: unknown, call: { sessionID: string; signal: AbortSignal }): Promise<unknown> };
type Context = { location?: { directory?: string }; tool: { transform(callback: (editor: { add(tool: Tool): void }) => void): Promise<{ dispose(): Promise<void> }> } };

/** Loaded only by native OpenCode in a Comex workspace. The engine, never the
 * model, supplies the requesting session. No global configuration is changed. */
export function installedBrowserPlugin(descriptorFile: string) {
  return { id: "comex.browser", async setup(context: Context) {
    const directory = context.location?.directory;
    if (!directory) return;
    const canonical = await realpath(directory);
    const descriptor = async () => {
      try {
        const value = installedBrowserDescriptor.parse(JSON.parse(await readFile(descriptorFile, "utf8")));
        const url = new URL(value.url);
        if (value.directory !== canonical || url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.pathname !== "/browser" || url.search || url.hash || url.username || url.password) throw new Error();
        return value;
      } catch { throw new Error("El navegador de Comex no está conectado a este proyecto. Abrí Comex y volvé a intentar."); }
    };
    const definitions = (await browserTools()).tool;
    const registration = await context.tool.transform(editor => {
      for (const [name, definition] of Object.entries(definitions)) addProviderSafeTool(editor, {
        name, description: definition.description, input: z.toJSONSchema(z.object(definition.args)), options: { codemode: false },
        async execute(input, call) {
          const target = await descriptor();
          const response = await approvalLoopbackFetch(target.url, { method: "POST", redirect: "error", signal: call.signal,
            headers: { Authorization: `Bearer ${target.token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ name, input, sessionId: call.sessionID }) });
          if (!response.ok) throw new Error(`El navegador de Comex rechazó la operación (${response.status}).`);
          return response.json();
        },
      });
    });
    return () => registration.dispose();
  } };
}

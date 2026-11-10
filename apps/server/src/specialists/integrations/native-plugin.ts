import { readFile, realpath } from "node:fs/promises";
import { z } from "zod";
import { addProviderSafeTool } from "../../opencode-plugins/provider-safe-tool-schema.js";
import { executeTavily, researchOperations } from "./research-factory.js";

export const researchDescriptor = z.object({ directory: z.string(), enabled: z.boolean(), cli: z.string(), home: z.string(), provider: z.literal("tavily") });
type Tool = { name: string; description: string; input: Record<string, unknown>; options: { codemode: boolean }; execute(input: unknown, call: { signal: AbortSignal }): Promise<unknown> };
type Context = { location?: { directory?: string }; tool: { transform(callback: (editor: { add(tool: Tool): void }) => void): Promise<{ dispose(): Promise<void> }> } };

/** Native plugin factory: tool schemas come from the adapter, identity remains in SQLite. */
export function createResearchPlugin(descriptorFile: string) {
  return { id: "comex.research", async setup(context: Context) {
    if (!context.location?.directory) return;
    const directory = await realpath(context.location.directory);
    const read = async () => {
      try {
        const descriptor = researchDescriptor.parse(JSON.parse(await readFile(descriptorFile, "utf8")));
        if (descriptor.directory !== directory || !descriptor.enabled) throw new Error();
        return descriptor;
      } catch { throw new Error("La investigación web está desactivada en este perfil. Revisá Herramientas y fuentes."); }
    };
    // Keep registered tools stable while enabling/disabling without disposing chat history.
    const registration = await context.tool.transform(editor => {
      for (const operation of Object.keys(researchOperations)) {
        if (!(operation in researchOperations)) continue;
        // Object keys are validated rather than cast to a trusted operation.
        const name = z.enum(["search", "extract", "map", "crawl", "research"]).parse(operation);
        const definition = researchOperations[name];
        addProviderSafeTool(editor, { name: `tavily_${name}`, description: definition.description, input: z.toJSONSchema(definition.schema), options: { codemode: false },
          async execute(input, call) {
            // A failed research call must reach the model as readable text, not as a null result.
            try {
              const descriptor = await read();
              const result = await executeTavily(descriptor, name, input, directory, call.signal);
              // The v2 runner reads content blocks off the result; a bare object showed up to the
              // model as the text "undefined" and the search looked empty.
              return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
            } catch (error) {
              return { content: [{ type: "text" as const, text: `${error instanceof Error ? error.message : "La búsqueda falló sin detalle."} No inventes resultados: decile a la persona qué pasó.` }] };
            }
          },
        });
      }
    });
    return () => registration.dispose();
  } };
}

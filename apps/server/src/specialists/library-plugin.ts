import { readFile, realpath } from "node:fs/promises";
import { z } from "zod";
import { addProviderSafeTool } from "../opencode-plugins/provider-safe-tool-schema.js";

const descriptorSchema = z.object({ directory: z.string(), token: z.string().min(16), url: z.string().url() });
type Tool = { name: string; description: string; input: Record<string, unknown>; options: { codemode: boolean }; execute(input: unknown, call: { signal: AbortSignal }): Promise<unknown> };
type Context = { location?: { directory?: string }; tool: { transform(callback: (editor: { add(tool: Tool): void }) => void): Promise<{ dispose(): Promise<void> }> } };

const listSchema = z.object({});
const readSchema = z.object({ path: z.string().describe("Ruta relativa dentro de la biblioteca, por ejemplo agents/revisor.md o skills/metodo/SKILL.md") });
const writeSchema = z.object({ path: readSchema.shape.path, content: z.string().describe("Contenido Markdown completo, con su encabezado YAML") });
const deleteSchema = z.object({ path: readSchema.shape.path });
const createSchema = z.object({
  name: z.string().describe("kebab-case, 1-64 caracteres"),
  description: z.string().describe("Qué hace y cuándo se usa (1-1024 caracteres)"),
  content: z.string().describe("Contenido Markdown completo. Opcional: sin contenido se crea una plantilla.").optional(),
});
const contextSchema = z.object({ content: z.string().describe("Instrucciones propias de la aplicación, hasta 8000 caracteres") });
const proposeSchema = z.object({
  kind: z.enum(["skill", "agent", "context"]),
  name: createSchema.shape.name,
  description: createSchema.shape.description,
  content: z.string().describe("Procedimiento destilado de la conversación, en Markdown"),
  reason: z.string().describe("Por qué vale la pena guardarlo y en qué se notó que se va a repetir"),
});

const TOOLS = [
  { name: "specialist_library_list", description: "Listar el contexto, los agentes y las skills de la aplicación especialista actual.", schema: listSchema },
  { name: "specialist_library_read", description: "Leer un archivo de la biblioteca de la aplicación (agents/*.md, skills/*/SKILL.md o recursos).", schema: readSchema },
  { name: "specialist_library_write", description: "Crear o editar un archivo de la biblioteca. Usarla solo cuando la persona te pidió explícitamente crear o editar algo; antes de editar, leer el archivo actual.", schema: writeSchema },
  { name: "specialist_library_delete", description: "Eliminar un agente o una skill de la biblioteca, a pedido explícito de la persona.", schema: deleteSchema },
  { name: "specialist_agent_create", description: "Crear un agente nuevo en la biblioteca de la aplicación, a pedido explícito de la persona.", schema: createSchema },
  { name: "specialist_skill_create", description: "Crear una skill nueva en la biblioteca de la aplicación, a pedido explícito de la persona.", schema: createSchema },
  { name: "specialist_context_write", description: "Escribir el contexto propio de la aplicación (instrucciones que se agregan a cada conversación), a pedido explícito de la persona.", schema: contextSchema },
  { name: "specialist_propose", description: "Guardar una PROPUESTA de skill o agente cuando la persona te enseñó un procedimiento que se va a repetir y no pidió explícitamente guardarlo. La persona revisa la propuesta en el menú de su aplicación antes de que exista. Nunca la apliques vos.", schema: proposeSchema },
] as const;

/** Native plugin factory: the OpenWork server owns the library; this file only bridges tool calls with the project's scoped credential. */
export function createSpecialistLibraryPlugin(descriptorFile: string) {
  return { id: "comex.library", async setup(context: Context) {
    if (!context.location?.directory) return;
    const directory = await realpath(context.location.directory);
    const read = async () => {
      try {
        const descriptor = descriptorSchema.parse(JSON.parse(await readFile(descriptorFile, "utf8")));
        if (descriptor.directory !== directory) throw new Error();
        const url = new URL(descriptor.url);
        if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/specialist-tool" || url.search || url.hash) throw new Error();
        return descriptor;
      } catch { throw new Error("La biblioteca de la aplicación no está disponible en este proyecto. Revisá el menú de la aplicación en Comex."); }
    };
    const registration = await context.tool.transform(editor => {
      for (const definition of TOOLS) {
        addProviderSafeTool(editor, {
          name: definition.name,
          description: definition.description,
          input: z.toJSONSchema(definition.schema),
          options: { codemode: false },
          async execute(input, call) {
            const descriptor = await read();
            const response = await fetch(descriptor.url, {
              method: "POST",
              redirect: "error",
              signal: call.signal,
              headers: { Authorization: `Bearer ${descriptor.token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ name: definition.name, input: input ?? {} }),
            });
            const text = await response.text();
            if (!response.ok) throw new Error(`La biblioteca rechazó la operación (${response.status}): ${text.slice(0, 400)}`);
            return text;
          },
        });
      }
    });
    return () => registration.dispose();
  } };
}

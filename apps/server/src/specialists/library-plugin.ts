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
  kind: z.enum(["skill", "agent", "context", "task", "plan"]),
  name: createSchema.shape.name,
  description: createSchema.shape.description,
  content: z.string().describe("Para skill/agent/context: el procedimiento en Markdown. Para task: JSON {prompt, schedule} con model opcional \"provider/model\". Para plan: JSON {skill?, dataset?, task?, panel?} con las piezas que se aplican juntas al aceptar"),
  reason: z.string().describe("Por qué vale la pena guardarlo y en qué se notó que se va a repetir"),
});
const scheduleSchema = z.object({
  kind: z.enum(["interval", "daily", "weekly", "once"]),
  everyMinutes: z.number().int().min(1).describe("Para kind=interval: cada cuántos minutos (1..43200)").optional(),
  hour: z.number().int().min(0).max(23).describe("Para daily/weekly: hora local").optional(),
  minute: z.number().int().min(0).max(59).describe("Para daily/weekly: minuto local").optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).describe("Para weekly: 0=domingo … 6=sábado").optional(),
  at: z.number().int().describe("Para once: epoch ms de la ejecución").optional(),
});
const taskCreateSchema = z.object({
  name: z.string().describe("Nombre legible de la tarea, 1-120 caracteres"),
  prompt: z.string().describe("Instrucción que recibirá el agente en cada corrida, 1-8000 caracteres"),
  schedule: scheduleSchema,
  model: z.string().regex(/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/).describe("Opcional: modelo fijo de las corridas, como \"opencode/gpt-5-nano\". Sin esto se usa el predeterminado del motor.").optional(),
});
const taskIdSchema = z.object({ taskId: z.string().describe("Id de la tarea (task_…), visible en specialist_task_list") });
const datasetIdSchema = z.object({ id: z.string().describe("id del dataset, visible en specialist_dataset_list") });
const sourceReadSchema = z.object({
  id: z.string().describe("id de la fuente (src_…), visible en el registro de fuentes del proyecto"),
  chunk: z.number().int().min(0).describe("Nº de pasaje a leer (el de la cita [fuente:id#n]). Sin este campo se devuelve el índice de pasajes.").optional(),
});
const datasetDeriveSchema = z.object({
  sourceId: z.string().describe("id del dataset del que derivás estos datos, visible en specialist_dataset_list"),
  name: z.string().describe("Nombre legible del dataset derivado, 1-120 caracteres"),
  payload: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]).describe("Datos limpios o transformados: un arreglo de filas o un objeto con las series; hasta 1 MB"),
});

const panelWriteSchema = z.object({
  name: z.string().describe("kebab-case, 1-64 caracteres (nombre del panel)"),
  spec: z.record(z.string(), z.unknown()).describe("Especificación declarativa: {title, source:{dataset|file}, refresh?:{watch:'latest'}, blocks:[stat|line|bar|table|markdown|changes]}. Sin campos desconocidos."),
});
const panelNameSchemaTool = z.object({ name: z.string().describe("kebab-case del panel, visible en specialist_panel_list") });
const outputGenerateSchema = z.object({
  kind: z.enum(["mindmap", "report", "flashcards", "quiz", "table"]).describe("Tipo de salida"),
  title: z.string().describe("Título legible, 1-200 caracteres"),
  content: z.string().describe("Contenido según el kind: mindmap/report en Markdown (mindmap con fence mindmap/graph), table = array JSON de filas, flashcards = [{front,back}], quiz = [{question, options: [2..6 textos], answer: índice 0-based de la opción correcta}]. Sin campos extra en cada objeto. Incluí citas [fuente:<id>#<n>] verificadas con specialist_source_read."),
  fromDatasets: z.array(z.string()).describe("ids de datasets usados (de specialist_dataset_list)").default([]),
  fromSources: z.array(z.string()).describe("ids de fuentes citadas").default([]),
  focus: z.string().describe("Foco opcional de la salida (qué se preguntó)").default(""),
  id: z.string().describe("id de una salida existente para regenerarla/actualizarla; sin id se crea una nueva").optional(),
});
const outputIdSchema = z.object({ id: z.string().describe("id de la salida (out-…), visible en specialist_output_list") });
const sourceAddSchema = z.object({
  path: z.string().describe("Ruta relativa en el proyecto de un archivo de texto (.md/.txt/.csv/.json/.html) que pasa a ser fuente citable"),
  title: z.string().describe("Título legible opcional").optional(),
});
const openapiProposeSchema = z.object({
  spec: z.string().describe("Documento OpenAPI completo en JSON (lo que pegó la persona)"),
  title: z.string().describe("Nombre legible del pack (opcional; si no, se usa info.title del spec)").optional(),
});
const TOOLS = [
  { name: "specialist_library_list", description: "Listar el contexto, los agentes y las skills de la aplicación especialista actual.", schema: listSchema },
  { name: "specialist_library_read", description: "Leer un archivo de la biblioteca de la aplicación (agents/*.md, skills/*/SKILL.md o recursos).", schema: readSchema },
  { name: "specialist_library_write", description: "Crear o editar un archivo de la biblioteca. Usarla solo cuando la persona te pidió explícitamente crear o editar algo; antes de editar, leer el archivo actual.", schema: writeSchema },
  { name: "specialist_library_delete", description: "Eliminar un agente o una skill de la biblioteca, a pedido explícito de la persona.", schema: deleteSchema },
  { name: "specialist_agent_create", description: "Crear un agente nuevo en la biblioteca de la aplicación, a pedido explícito de la persona.", schema: createSchema },
  { name: "specialist_skill_create", description: "Crear una skill nueva en la biblioteca de la aplicación, a pedido explícito de la persona.", schema: createSchema },
  { name: "specialist_context_write", description: "Escribir el contexto propio de la aplicación (instrucciones que se agregan a cada conversación), a pedido explícito de la persona.", schema: contextSchema },
  { name: "specialist_propose", description: "Guardar una PROPUESTA (skill, agente, contexto, tarea o plan compuesto) cuando la persona te enseñó un procedimiento que se va a repetir y no pidió explícitamente guardarlo. La persona revisa la propuesta en el menú de su aplicación antes de que exista; una tarea propuesta se crea PAUSADA al aceptarla. Nunca la apliques vos.", schema: proposeSchema },
  { name: "specialist_task_create", description: "Crear una tarea programada para la aplicación (cada N minutos, diaria, semanal o una vez), solo cuando la persona lo pidió explícitamente. El prompt guardado es lo que hará el agente en cada corrida.", schema: taskCreateSchema },
  { name: "specialist_task_list", description: "Listar las tareas programadas de la aplicación con su próxima corrida y último estado.", schema: listSchema },
  { name: "specialist_task_pause", description: "Pausar una tarea programada (no se borra; retoma la persona desde la app o con specialist_task_create de reemplazo).", schema: taskIdSchema },
  { name: "specialist_task_delete", description: "Eliminar una tarea programada, a pedido explícito de la persona.", schema: taskIdSchema },
  { name: "specialist_dataset_list", description: "Listar los datasets de investigación guardados en este proyecto (cada consulta de investigación queda como dataset con sus snapshots).", schema: listSchema },
  { name: "specialist_dataset_read", description: "Leer un dataset: su consulta, las fechas de sus snapshots y el último snapshot. Usarla proactivamente después de investigar, para responder con los datos ya guardados en vez de volver a consultar.", schema: datasetIdSchema },
  { name: "specialist_dataset_refresh", description: "Volver a ejecutar la consulta guardada de un dataset y dejar un snapshot nuevo (necesita el proveedor de investigación conectado). Solo cuando la persona pidió explícitamente actualizar o reverificar los datos. Si falla, decilo en voz alta: nunca inventes las cifras.", schema: datasetIdSchema },
  { name: "specialist_dataset_derive", description: "Registrar un dataset DERIVADO de otro: una vista limpia o transformada (sin consulta re-ejecutable, con linaje al origen). Usarla proactivamente cuando convertiste los datos de una investigación en algo reutilizable para el proyecto.", schema: datasetDeriveSchema },
  { name: "specialist_source_read", description: "Leer una FUENTE citable del proyecto: sin chunk devuelve el índice de pasajes; con chunk devuelve el texto exacto del pasaje. Obligatorio antes de citar [fuente:<id>#<n>] en una respuesta: nunca cites de memoria ni inventes un ancla.", schema: sourceReadSchema },
  { name: "specialist_source_add", description: "Registrar un archivo LOCAL del proyecto (texto, CSV, Markdown, HTML) como fuente citable con sus [fuente:<id>#<n>] — a pedido explícito de la persona. El contenido se copia al registro (snapshot) para que la cita no se mueva.", schema: sourceAddSchema },
  { name: "specialist_panel_list", description: "Listar los paneles declarativos de la aplicación (vistas vivas sobre datasets).", schema: listSchema },
  { name: "specialist_panel_write", description: "Crear o editar un panel declarativo (stat/line/bar/table/markdown/changes sobre un dataset o archivo). El render es determinista y se repinta solo cuando cambia el snapshot; nunca incluye código propio.", schema: panelWriteSchema },
  { name: "specialist_panel_read", description: "Leer la especificación de un panel y resolverla contra este proyecto (datos del último snapshot o el error exacto si no se puede dibujar).", schema: panelNameSchemaTool },
  { name: "specialist_panel_delete", description: "Eliminar un panel de la aplicación, a pedido explícito de la persona.", schema: panelNameSchemaTool },
  { name: "specialist_openapi_propose", description: "Proponer un pack de consulta desde un spec OpenAPI pegado por la persona: skill de consulta + dataset re-ejecutable (endpoint GET) + panel de tabla, como propuesta plan para que revise. Nunca embebe credenciales.", schema: openapiProposeSchema },
  { name: "specialist_output_generate", description: "Generar una SALIDA del mini-Studio (mindmap, informe, flashcards, quiz o tabla) sobre los datasets/fuentes del proyecto. El contenido se valida según el kind y la herramienta devuelve la auditoría de citas: avisá lo que dice (sin anclas o con citas rotas) en vez de ignorarlo.", schema: outputGenerateSchema },
  { name: "specialist_output_list", description: "Listar las salidas del mini-Studio guardadas en este proyecto.", schema: listSchema },
  { name: "specialist_output_read", description: "Leer una salida con su contenido y la auditoría de sus citas (qué anclas resuelven y cuáles no).", schema: outputIdSchema },
] as const;

const failedTool = (error: unknown) => ({
  content: [{ type: "text" as const, text: `${error instanceof Error ? error.message : "La herramienta falló sin detalle."} Corregí la llamada o contale el problema a la persona; no la repitas igual.` }],
});

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
      } catch { throw new Error("La biblioteca de la aplicación no está disponible en este proyecto. Revisá la biblioteca desde el menú de la aplicación."); }
    };
    const registration = await context.tool.transform(editor => {
      for (const definition of TOOLS) {
        addProviderSafeTool(editor, {
          name: definition.name,
          description: definition.description,
          input: z.toJSONSchema(definition.schema),
          options: { codemode: false },
          async execute(input, call) {
            // Failures travel as text the model can read and correct from: a thrown error reached
            // the chat as a null result, so a rejected payload was retried blindly.
            let descriptor;
            try { descriptor = await read(); }
            catch (error) { return failedTool(error); }
            let response: Response;
            try {
              response = await fetch(descriptor.url, {
                method: "POST",
                redirect: "error",
                signal: call.signal,
                headers: { Authorization: `Bearer ${descriptor.token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ name: definition.name, input: input ?? {} }),
              });
            } catch (error) {
              return failedTool(new Error(`La biblioteca no respondió: ${error instanceof Error ? error.message : "sin detalle"}`));
            }
            const text = await response.text();
            if (!response.ok) return failedTool(new Error(`La biblioteca rechazó la operación (${response.status}): ${text.slice(0, 400)}`));
            // The v2 tool runner reads `output`/`content` off the result; a bare string made every
            // specialist tool fail with "a is not an Object (evaluating 'output' in a)".
            return { content: [{ type: "text" as const, text }] };
          },
        });
      }
    });
    return () => registration.dispose();
  } };
}

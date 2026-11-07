import { z } from "zod";
import { parseFrontmatter } from "../frontmatter.js";

/** Factories expose domain objects; neither the catalog nor portable definitions
 * depend on an OpenCode/Claude/Codex SDK. Vendor translation belongs to adapters. */
export interface Factory<Options, Product> { id: string; label: string; create(options: Options): Product }
export class FactoryRegistry<Options, Product> {
  private readonly factories = new Map<string, Factory<Options, Product>>();
  constructor(entries: readonly Factory<Options, Product>[]) { for (const entry of entries) this.register(entry); }
  register(factory: Factory<Options, Product>) {
    if (this.factories.has(factory.id)) throw new Error(`La fábrica ${factory.id} ya está registrada.`);
    this.factories.set(factory.id, factory);
  }
  catalog() { return [...this.factories.values()].map(({ id, label }) => ({ id, label })); }
  create(id: string, options: Options): Product {
    const factory = this.factories.get(id);
    if (!factory) throw new Error("No hay un adaptador instalado para esa fábrica. No se cambió de proveedor automáticamente.");
    return factory.create(options);
  }
}

export const portableDefinition = z.object({
  kind: z.enum(["agent", "skill"]), name: z.string().min(1), description: z.string().min(1), instructions: z.string(),
  capabilities: z.array(z.string()).default([]),
  // Preserve vendor settings for round trips; another adapter may report unsupported ones.
  extensions: z.record(z.string(), z.unknown()).default({}),
});
export type PortableDefinition = z.infer<typeof portableDefinition>;
type DefinitionInput = { name: string; content: string };
export const definitionFactories = new FactoryRegistry<DefinitionInput, PortableDefinition>(["agent", "skill"].map(kind => ({
  id: kind, label: kind === "agent" ? "Agente" : "Skill",
  create: ({ name, content }) => {
    const parsed = parseFrontmatter(content);
    const { name: _name, description, ...vendorOptions } = parsed.data;
    return portableDefinition.parse({ kind, name, description, instructions: parsed.body, capabilities: [], extensions: Object.keys(vendorOptions).length ? { opencode: vendorOptions } : {} });
  },
})));
export function exportPortableDefinitions(files: Array<{ path: string; data: Uint8Array }>) {
  return files.flatMap(file => {
    if (/^agents\/[^/]+\.md$/.test(file.path)) return [definitionFactories.create("agent", { name: file.path.slice(7, -3), content: Buffer.from(file.data).toString("utf8") })];
    if (/^skills\/[^/]+\/SKILL\.md$/.test(file.path)) return [definitionFactories.create("skill", { name: file.path.split("/")[1]!, content: Buffer.from(file.data).toString("utf8") })];
    return [];
  });
}

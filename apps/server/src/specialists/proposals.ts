import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { specialistDirectory } from "./store.js";
import type { ServerConfig } from "../types.js";

export const proposalSchema = z.object({
  id: z.string(),
  kind: z.enum(["skill", "agent", "context"]),
  name: z.string(),
  description: z.string(),
  content: z.string(),
  reason: z.string(),
  createdAt: z.number(),
});
export type SpecialistProposal = z.infer<typeof proposalSchema>;

const LIMIT = 20;

const proposalsFile = (config: Pick<ServerConfig, "configPath">, id: string) => join(specialistDirectory(config), id, "proposals.json");
const failure = (message: string) => new ApiError(422, "invalid_proposal", message);

export async function listProposals(config: Pick<ServerConfig, "configPath">, id: string): Promise<SpecialistProposal[]> {
  try {
    const value: unknown = JSON.parse(await readFile(proposalsFile(config, id), "utf8"));
    if (!Array.isArray(value)) return [];
    return value.flatMap(entry => { try { return [proposalSchema.parse(entry)]; } catch { return []; } });
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

async function save(config: Pick<ServerConfig, "configPath">, id: string, proposals: SpecialistProposal[]) {
  const file = proposalsFile(config, id);
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(proposals), { mode: 0o600 });
  await rename(temporary, file);
}

export async function addProposal(config: Pick<ServerConfig, "configPath">, id: string, input: Omit<SpecialistProposal, "id" | "createdAt">) {
  const name = input.name.trim();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) && input.kind !== "context") throw failure("El nombre propuesto debe ser kebab-case (minúsculas, números y guiones).");
  if (!input.description.trim() || input.description.length > 1024) throw failure("La descripción propuesta debe tener entre 1 y 1024 caracteres.");
  if (!input.content.trim() || input.content.length > 200_000) throw failure("El contenido propuesto está vacío o supera 200 KB.");
  if (input.reason.length > 500) throw failure("El motivo propuesto supera 500 caracteres.");
  const existing = await listProposals(config, id);
  const duplicate = existing.find(proposal => proposal.kind === input.kind && proposal.name === name);
  const proposal: SpecialistProposal = { ...input, name, reason: input.reason.trim(), id: `prop_${randomUUID()}`, createdAt: Date.now() };
  const next = [proposal, ...existing.filter(entry => entry !== duplicate)].slice(0, LIMIT);
  await save(config, id, next);
  return { proposals: next, replaced: duplicate !== undefined };
}

export async function removeProposal(config: Pick<ServerConfig, "configPath">, id: string, proposalId: string) {
  const existing = await listProposals(config, id);
  if (!existing.some(proposal => proposal.id === proposalId)) throw new ApiError(404, "proposal_not_found", "Esa propuesta ya no está.");
  await save(config, id, existing.filter(proposal => proposal.id !== proposalId));
  return existing.find(proposal => proposal.id === proposalId)!;
}

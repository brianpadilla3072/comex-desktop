import { z } from "zod";
export const memoryScopeSchema = z.enum(["conversation", "project", "application"]);
export type MemoryScope = z.infer<typeof memoryScopeSchema>;
export const memoryScopeLabels: Record<MemoryScope, string> = { conversation: "Conversación", project: "Proyecto", application: "Aplicación" };
export const memoryNoteInputSchema = z.string().trim().min(1).max(800);
export const memoryNoteSchema = z.object({ id: z.string().uuid(), text: memoryNoteInputSchema, updatedAt: z.iso.datetime() }).strict();
export const memorySnapshotSchema = z.object({ revision: z.number().int().nonnegative(), notes: z.array(memoryNoteSchema).max(24) }).strict();
export type MemorySnapshot = z.infer<typeof memorySnapshotSchema>;
export type MemoryNote = z.infer<typeof memoryNoteSchema>;

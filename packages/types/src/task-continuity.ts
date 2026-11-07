import { z } from "zod";

export const goalInputSchema = z.strictObject({
  objective: z.string().trim().min(1).max(1600),
  criteria: z.string().trim().min(1).max(2400),
  maxTurns: z.number().int().min(1).max(30).default(8),
});
export const taskStateSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  workspaceId: z.string(), sessionId: z.string(),
  objective: z.string().max(1600), criteria: z.string().max(2400),
  status: z.enum(["idle", "active", "paused", "complete", "blocked"]),
  phase: z.enum(["work", "review"]),
  maxTurns: z.number().int().min(1).max(30), turns: z.number().int().nonnegative(),
  model: z.literal("opencode/big-pickle"),
  summary: z.string().max(6000), evidence: z.string().max(2000),
  lastMessageId: z.string().nullable(),
  awaiting: z.boolean(),
  updatedAt: z.number(), reason: z.string().max(500),
  worktree: z.string().nullable(),
  codeBaseline: z.string().nullable(),
  codeTouched: z.boolean().default(false),
});
export type TaskState = z.infer<typeof taskStateSchema>;
export type GoalInput = z.infer<typeof goalInputSchema>;

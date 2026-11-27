import { z } from "zod";

const inputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("click"), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict(),
  z.object({ type: z.literal("scroll"), deltaY: z.number().int().min(-1200).max(1200) }).strict(),
  z.object({ type: z.literal("text"), text: z.string().min(1).max(8000) }).strict(),
  z.object({ type: z.literal("key"), key: z.enum(["Enter", "Tab", "Backspace", "Delete", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]) }).strict(),
]);
export const browserWebRequestSchema = z.object({
  sessionId: z.string().min(1).max(256), tabId: z.string().min(1).max(256).optional(),
  operation: z.enum(["state", "open", "pause", "resume", "input", "navigate", "back", "forward", "reload"]),
  url: z.string().url().max(8000).refine(value => ["http:", "https:"].includes(new URL(value).protocol)).optional(),
  input: inputSchema.optional(),
}).strict();
export const browserWebReplySchema = z.discriminatedUnion("ok", [
  z.object({ version: z.literal(1), ok: z.literal(true), tab: z.object({
    id: z.string(), url: z.string(), title: z.string(), control: z.enum(["agent", "person"]),
    canGoBack: z.boolean(), canGoForward: z.boolean(),
  }).strict(), frame: z.object({ mimeType: z.literal("image/jpeg"), data: z.string().max(6_000_000), width: z.number().int().positive(), height: z.number().int().positive() }).strict().optional() }).strict(),
  z.object({ version: z.literal(1), ok: z.literal(false), code: z.string(), error: z.string() }).strict(),
]);
export type BrowserWebRequest = z.infer<typeof browserWebRequestSchema>;
export type BrowserWebReply = z.infer<typeof browserWebReplySchema>;

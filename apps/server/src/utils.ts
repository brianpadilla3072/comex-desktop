import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import type { z } from "zod";

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

/** Reads a JSON file through `schema`; a missing, unreadable or invalid file is `null`. */
export async function readJsonFile<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function shortId(): string {
  return randomUUID();
}

export function parseList(input: string | undefined): string[] {
  if (!input) return [];
  const trimmed = input.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item)).filter(Boolean);
      }
    } catch {
      return [];
    }
  }
  return trimmed
    .split(/[,;]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

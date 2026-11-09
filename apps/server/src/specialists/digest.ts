import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";

export const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

export async function statOrNull(path: string) {
  try { return await lstat(path); }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return null; throw error; }
}

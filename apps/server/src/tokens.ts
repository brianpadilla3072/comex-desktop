import { dirname, join, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { openworkConfigDir } from "@openwork/paths";
import { z } from "zod";

import type { ServerConfig, TokenScope } from "./types.js";
import { ensureDir, exists, hashToken, shortId } from "./utils.js";

export type TokenRecord = {
  id: string;
  hash: string;
  scope: TokenScope;
  createdAt: number;
  label?: string;
};

type TokenStoreFile = {
  schemaVersion: number;
  updatedAt: number;
  tokens: TokenRecord[];
};

/** `tokens.json` as read. A wrong-typed field falls back to its default. */
const tokenStoreFileSchema = z.object({
  schemaVersion: z.number().optional().catch(undefined),
  updatedAt: z.number().optional().catch(undefined),
  tokens: z.array(z.unknown()).catch([]),
});

/** One stored token; an entry without id, hash or a known scope is skipped. */
const storedTokenSchema = z.object({
  id: z.string().min(1),
  hash: z.string().min(1),
  scope: z.enum(["owner", "collaborator", "viewer"]),
  createdAt: z.number().optional().catch(undefined),
  label: z.string().optional().catch(undefined),
});

function resolveTokenStorePath(config: ServerConfig): string {
  const override = (process.env.OPENWORK_TOKEN_STORE ?? "").trim();
  if (override) return resolve(override);

  const configPath = config.configPath?.trim();
  const configDir = configPath ? dirname(configPath) : openworkConfigDir();
  return join(configDir, "tokens.json");
}

async function readTokenStore(path: string): Promise<TokenStoreFile> {
  if (!(await exists(path))) {
    return { schemaVersion: 1, updatedAt: Date.now(), tokens: [] };
  }
  try {
    const raw = await readFile(path, "utf8");
    const store = tokenStoreFileSchema.safeParse(JSON.parse(raw));
    if (!store.success) return { schemaVersion: 1, updatedAt: Date.now(), tokens: [] };
    const parsed = store.data;
    const tokens = parsed.tokens.flatMap((token): TokenRecord[] => {
      // A malformed entry is skipped; the other tokens stay valid.
      const entry = storedTokenSchema.safeParse(token);
      if (!entry.success) return [];
      const { id, hash, scope, createdAt, label } = entry.data;
      return [{ id, hash, scope, createdAt: createdAt ?? Date.now(), ...(label ? { label } : {}) }];
    });
    return {
      schemaVersion: parsed.schemaVersion ?? 1,
      updatedAt: parsed.updatedAt ?? Date.now(),
      tokens,
    };
  } catch {
    return { schemaVersion: 1, updatedAt: Date.now(), tokens: [] };
  }
}

async function writeTokenStore(path: string, tokens: TokenRecord[]): Promise<void> {
  await ensureDir(dirname(path));
  const payload: TokenStoreFile = {
    schemaVersion: 1,
    updatedAt: Date.now(),
    tokens,
  };
  await writeFile(path, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

export class TokenService {
  private config: ServerConfig;
  private path: string;
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();
  private tokens: TokenRecord[] = [];
  private byHash = new Map<string, TokenRecord>();

  constructor(config: ServerConfig) {
    this.config = config;
    this.path = resolveTokenStorePath(config);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.loadPromise) {
      this.loadPromise = readTokenStore(this.path)
        .then((store) => {
          this.tokens = store.tokens;
          this.byHash = new Map(store.tokens.map((token) => [token.hash, token]));
          this.loaded = true;
        })
        .finally(() => {
          this.loadPromise = null;
        });
    }
    await this.loadPromise;
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.catch(() => {}).then(operation);
    this.mutationQueue = run.then(() => {}, () => {});
    return run;
  }

  async list(): Promise<Array<Omit<TokenRecord, "hash">>> {
    await this.ensureLoaded();
    return this.tokens.map(({ hash: _hash, ...rest }) => rest);
  }

  async create(scope: TokenScope, options?: { label?: string }): Promise<{ id: string; token: string; scope: TokenScope; createdAt: number; label?: string }> {
    return this.enqueueMutation(async () => {
      await this.ensureLoaded();

      const id = shortId();
      const token = `owt_${shortId().replace(/-/g, "")}`;
      const createdAt = Date.now();
      const record: TokenRecord = {
        id,
        hash: hashToken(token),
        scope,
        createdAt,
        label: options?.label?.trim() || undefined,
      };

      const next = [record, ...this.tokens];
      await writeTokenStore(this.path, next);
      this.tokens = next;
      this.byHash.set(record.hash, record);
      return { id, token, scope, createdAt, label: record.label };
    });
  }

  async revoke(id: string): Promise<boolean> {
    return this.enqueueMutation(async () => {
      await this.ensureLoaded();
      const removed = this.tokens.find((token) => token.id === id);
      if (!removed) return false;
      const next = this.tokens.filter((token) => token.id !== id);
      await writeTokenStore(this.path, next);
      this.tokens = next;
      this.byHash.delete(removed.hash);
      return true;
    });
  }

  /** The stored record (never the config's own client token), for checks that need the label. */
  async recordForToken(token: string): Promise<Omit<TokenRecord, "hash"> | null> {
    const trimmed = token.trim();
    if (!trimmed || trimmed === this.config.token) return null;
    await this.ensureLoaded();
    const found = this.byHash.get(hashToken(trimmed));
    if (!found) return null;
    const { hash: _hash, ...rest } = found;
    return rest;
  }

  async scopeForToken(token: string): Promise<TokenScope | null> {
    const trimmed = token.trim();
    if (!trimmed) return null;
    if (trimmed === this.config.token) return "collaborator";
    await this.ensureLoaded();
    const found = this.byHash.get(hashToken(trimmed));
    return found?.scope ?? null;
  }
}

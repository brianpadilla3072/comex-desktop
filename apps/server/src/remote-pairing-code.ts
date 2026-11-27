import { randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { openworkConfigDir } from "@openwork/paths";
import { z } from "zod";
import { normalizePairingCode } from "./device-pairing.js";
import { ApiError } from "./errors.js";

export const REMOTE_PAIRING_CODE_STORE_FILENAME = "remote-pairing-code.json";
export const REMOTE_PAIRING_CODE_STORE_SCHEMA_VERSION = 1;
export const REMOTE_PAIRING_CODE_LENGTH = 16;
export const REMOTE_PAIRING_CODE_MIN_LENGTH = 12;
export const REMOTE_PAIRING_CODE_MAX_LENGTH = 128;
export const REMOTE_PAIRING_CODE_MAX_FAILURES = 5;
export const REMOTE_PAIRING_CODE_BLOCK_MS = 5 * 60_000;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const SALT_BYTES = 16;
const HASH_BYTES = 64;
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** The only persisted representation. Plaintext codes never enter this schema or the file. */
export const remotePairingCodeStoreSchema = z.object({
  schemaVersion: z.literal(REMOTE_PAIRING_CODE_STORE_SCHEMA_VERSION),
  algorithm: z.literal("scrypt"),
  salt: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).length(24),
  hash: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).length(88),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict();

export const remotePairingCodeBodySchema = z.object({
  code: z.string().max(256).optional(),
}).strict();

export const pairingStatusSchema = z.object({
  enabled: z.boolean(),
  remoteCodeEnabled: z.boolean(),
  remoteCodeConfigured: z.boolean(),
  remoteCodeSource: z.enum(["stored", "development", "none"]),
}).strict();

export const remotePairingCodeCreatedSchema = z.object({
  code: z.string(),
  createdAt: z.number().int().nonnegative(),
}).strict();

export const remotePairingCodeMutationResultSchema = z.object({
  ok: z.literal(true),
}).strict();

export type RemotePairingCodeStoreRecord = z.infer<typeof remotePairingCodeStoreSchema>;
export type RemotePairingCodeSource = "stored" | "development" | "none";
export type RemotePairingCodeStatus = {
  configured: boolean;
  source: RemotePairingCodeSource;
};
export type RemotePairingCodeMatch = {
  available: boolean;
  matched: boolean;
};

export function resolveRemotePairingCodeStorePath(configPath?: string): string {
  const override = (process.env.OPENWORK_REMOTE_PAIRING_CODE_STORE ?? "").trim();
  if (override) return resolve(override);
  const configDir = configPath?.trim() ? dirname(resolve(configPath)) : openworkConfigDir();
  return join(configDir, REMOTE_PAIRING_CODE_STORE_FILENAME);
}

export function normalizeConfiguredRemotePairingCode(input: string): string | null {
  const normalized = normalizePairingCode(input);
  if (normalized.length < REMOTE_PAIRING_CODE_MIN_LENGTH || normalized.length > REMOTE_PAIRING_CODE_MAX_LENGTH) {
    return null;
  }
  return normalized;
}

/** Dev mode alone never enables a known code; the launcher must opt in explicitly. */
export function resolveDevelopmentRemotePairingCode(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.OPENWORK_DEV_PAIRING_CODE;
  if (configured === undefined) return null;
  const normalized = normalizePairingCode(configured);
  if (!normalized || normalized.length > REMOTE_PAIRING_CODE_MAX_LENGTH) return null;
  return normalized;
}

export function generateRemotePairingCode(): string {
  return Array.from(
    { length: REMOTE_PAIRING_CODE_LENGTH },
    () => BASE32_ALPHABET[randomInt(BASE32_ALPHABET.length)],
  ).join("");
}

function sameSecret(left: string | Buffer, right: string | Buffer): boolean {
  const a = typeof left === "string" ? Buffer.from(left) : left;
  const b = typeof right === "string" ? Buffer.from(right) : right;
  return a.length === b.length && timingSafeEqual(a, b);
}

function deriveScryptHash(code: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolveHash, reject) => {
    scrypt(code, salt, HASH_BYTES, SCRYPT_OPTIONS, (error, hash) => {
      if (error) reject(error);
      else resolveHash(hash);
    });
  });
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function invalidStoreError(): ApiError {
  return new ApiError(
    409,
    "remote_pairing_code_store_invalid",
    "El archivo del código remoto no es válido. Repáralo o elimínalo desde la app.",
  );
}

async function readStoreRecord(path: string): Promise<RemotePairingCodeStoreRecord | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw invalidStoreError();
  }
  try {
    return remotePairingCodeStoreSchema.parse(JSON.parse(raw));
  } catch {
    throw invalidStoreError();
  }
}

async function writeStoreRecord(path: string, record: RemotePairingCodeStoreRecord): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `.${REMOTE_PAIRING_CODE_STORE_FILENAME}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    try {
      await chmod(temporary, 0o600);
    } catch (error) {
      if (process.platform !== "win32") throw error;
    }
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Persistent reusable pairing codes. One instance owns one store path and one mutation queue;
 * the server creates it per route registry, so concurrent rotates/deletes/verifications cannot
 * interleave. Verification shares the queue so a redemption is ordered before or after a rotate.
 */
export class RemotePairingCodeStore {
  private readonly path: string;
  private readonly now: () => number;
  private readonly generateCode: () => string;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(options: {
    configPath?: string;
    path?: string;
    now?: () => number;
    generateCode?: () => string;
  } = {}) {
    this.path = options.path ? resolve(options.path) : resolveRemotePairingCodeStorePath(options.configPath);
    this.now = options.now ?? Date.now;
    this.generateCode = options.generateCode ?? generateRemotePairingCode;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.catch(() => {}).then(operation);
    this.mutationQueue = run.then(() => {}, () => {});
    return run;
  }

  async status(developmentCode: string | null): Promise<RemotePairingCodeStatus> {
    return this.enqueue(async () => {
      const record = await readStoreRecord(this.path);
      if (record) return { configured: true, source: "stored" };
      return { configured: false, source: developmentCode === null ? "none" : "development" };
    });
  }

  async configure(code?: string): Promise<{ code: string; createdAt: number }> {
    return this.enqueue(async () => {
      // Never let a rotate/create request silently replace a corrupt security store.
      await readStoreRecord(this.path);
      const normalized = code === undefined ? this.generateCode() : normalizeConfiguredRemotePairingCode(code);
      if (!normalized || normalized.length < REMOTE_PAIRING_CODE_MIN_LENGTH || normalized.length > REMOTE_PAIRING_CODE_MAX_LENGTH) {
        throw new ApiError(400, "invalid_remote_pairing_code", "El código debe tener al menos 12 caracteres válidos.");
      }
      const createdAt = this.now();
      const salt = randomBytes(SALT_BYTES);
      const hash = await deriveScryptHash(normalized, salt);
      const record: RemotePairingCodeStoreRecord = {
        schemaVersion: REMOTE_PAIRING_CODE_STORE_SCHEMA_VERSION,
        algorithm: "scrypt",
        salt: salt.toString("base64"),
        hash: hash.toString("base64"),
        createdAt,
        updatedAt: createdAt,
      };
      await writeStoreRecord(this.path, record);
      return { code: normalized, createdAt };
    });
  }

  async match(input: string, options: { developmentCode: string | null; skipVerification?: boolean }): Promise<RemotePairingCodeMatch> {
    return this.enqueue(async () => {
      const normalized = normalizePairingCode(input);
      const record = await readStoreRecord(this.path);
      if (record) {
        if (options.skipVerification === true) return { available: true, matched: false };
        const candidate = await deriveScryptHash(normalized, Buffer.from(record.salt, "base64"));
        return { available: true, matched: sameSecret(candidate, Buffer.from(record.hash, "base64")) };
      }
      if (options.developmentCode !== null) {
        return {
          available: true,
          matched: options.skipVerification !== true && sameSecret(normalized, options.developmentCode),
        };
      }
      return { available: false, matched: false };
    });
  }

  async remove(): Promise<void> {
    return this.enqueue(async () => {
      await rm(this.path, { force: true });
    });
  }
}

/** Process-local throttle shared by every remote caller, including Tailscale loopback proxies. */
export function createRemotePairingCodeRateLimiter(options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  let failures = 0;
  let blockedUntil = 0;

  const clearExpiredBlock = (): void => {
    if (blockedUntil > 0 && blockedUntil <= now()) {
      failures = 0;
      blockedUntil = 0;
    }
  };

  return {
    isBlocked(): boolean {
      clearExpiredBlock();
      return blockedUntil > now();
    },
    retryAfterMs(): number {
      clearExpiredBlock();
      return Math.max(0, blockedUntil - now());
    },
    recordFailure(): void {
      clearExpiredBlock();
      if (blockedUntil > now()) return;
      failures += 1;
      if (failures >= REMOTE_PAIRING_CODE_MAX_FAILURES) {
        failures = 0;
        blockedUntil = now() + REMOTE_PAIRING_CODE_BLOCK_MS;
      }
    },
    reset(): void {
      failures = 0;
      blockedUntil = 0;
    },
  };
}

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  normalizeConfiguredRemotePairingCode,
  RemotePairingCodeStore,
  remotePairingCodeStoreSchema,
  resolveDevelopmentRemotePairingCode,
} from "../src/remote-pairing-code.js";

const vectorsSchema = z.object({
  schemaVersion: z.literal(1),
  normalization: z.array(z.object({
    input: z.string(),
    normalized: z.string(),
    valid: z.boolean(),
  }).strict()),
  developmentFallback: z.array(z.object({
    override: z.enum(["absent", "empty", "custom"]),
    value: z.string().optional(),
    expected: z.string().nullable(),
  }).strict()),
  fallbackVerification: z.array(z.object({
    developmentCode: z.string().nullable(),
    input: z.string(),
    available: z.boolean(),
    matched: z.boolean(),
  }).strict()),
  storedVerification: z.object({
    record: remotePairingCodeStoreSchema,
    cases: z.array(z.object({
      developmentCode: z.string().nullable(),
      input: z.string(),
      available: z.boolean(),
      matched: z.boolean(),
    }).strict()),
    reusable: z.object({
      developmentCode: z.string().nullable(),
      input: z.string(),
      attempts: z.number().int().positive(),
      available: z.literal(true),
      matched: z.literal(true),
    }).strict(),
  }).strict(),
}).strict();

async function readVectors() {
  const url = new URL("../../../contracts/remote-pairing-code/v1/vectors.json", import.meta.url);
  const value: unknown = JSON.parse(await readFile(url, "utf8"));
  return vectorsSchema.parse(value);
}

test("remote pairing code contract vectors pin normalization and development fallback resolution", async () => {
  const vectors = await readVectors();
  for (const vector of vectors.normalization) {
    assert.equal(
      normalizeConfiguredRemotePairingCode(vector.input),
      vector.valid ? vector.normalized : null,
      vector.input,
    );
  }
  for (const vector of vectors.developmentFallback) {
    const env: NodeJS.ProcessEnv = {};
    if (vector.override !== "absent") env.OPENWORK_DEV_PAIRING_CODE = vector.value ?? "";
    assert.equal(resolveDevelopmentRemotePairingCode(env), vector.expected, vector.override);
  }
});

test("remote pairing code contract vectors pin production/dev fallback and fixed scrypt verification", async () => {
  const vectors = await readVectors();
  const dir = mkdtempSync(join(tmpdir(), "remote-pairing-contract-"));
  try {
    const fallbackStore = new RemotePairingCodeStore({ path: join(dir, "missing.json") });
    for (const vector of vectors.fallbackVerification) {
      assert.deepEqual(
        await fallbackStore.match(vector.input, { developmentCode: vector.developmentCode }),
        { available: vector.available, matched: vector.matched },
        vector.input,
      );
    }

    const storedPath = join(dir, "stored.json");
    writeFileSync(storedPath, `${JSON.stringify(vectors.storedVerification.record, null, 2)}\n`, { mode: 0o600 });
    const storedStore = new RemotePairingCodeStore({ path: storedPath });
    for (const vector of vectors.storedVerification.cases) {
      assert.deepEqual(
        await storedStore.match(vector.input, { developmentCode: vector.developmentCode }),
        { available: vector.available, matched: vector.matched },
        vector.input,
      );
    }

    const reusable = vectors.storedVerification.reusable;
    for (let attempt = 0; attempt < reusable.attempts; attempt += 1) {
      assert.deepEqual(
        await storedStore.match(reusable.input, { developmentCode: reusable.developmentCode }),
        { available: reusable.available, matched: reusable.matched },
        `reuse ${attempt + 1}`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

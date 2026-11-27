import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveServerConfig } from "../src/config.js";
import { ApiError } from "../src/errors.js";
import {
  createRemotePairingCodeRateLimiter,
  REMOTE_PAIRING_CODE_BLOCK_MS,
  REMOTE_PAIRING_CODE_MAX_FAILURES,
  RemotePairingCodeStore,
  remotePairingCodeStoreSchema,
  resolveDevelopmentRemotePairingCode,
  resolveRemotePairingCodeStorePath,
} from "../src/remote-pairing-code.js";
import { TokenService } from "../src/tokens.js";

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "remote-pairing-store-"));
  try {
    await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the store persists only a salted hash, survives recreation, rotates, and restores dev fallback on delete", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "remote-pairing-code.json");
    let now = 1_000;
    const store = new RemotePairingCodeStore({ path, now: () => now });
    const configured = await store.configure("persist-code-123");
    assert.equal(configured.code, "PERSISTCODE123");
    assert.equal(configured.createdAt, 1_000);

    const raw = readFileSync(path, "utf8");
    const value: unknown = JSON.parse(raw);
    const record = remotePairingCodeStoreSchema.parse(value);
    assert.equal(record.algorithm, "scrypt");
    assert.equal(Object.hasOwn(record, "code"), false);
    assert.equal(raw.includes(configured.code), false);
    assert.deepEqual(readdirSync(dir), ["remote-pairing-code.json"]);
    if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);

    const recreated = new RemotePairingCodeStore({ path, now: () => now });
    assert.deepEqual(await recreated.match(configured.code, { developmentCode: null }), { available: true, matched: true });
    assert.deepEqual(await recreated.match(configured.code, { developmentCode: null }), { available: true, matched: true });
    assert.deepEqual(await recreated.status(null), { configured: true, source: "stored" });

    if (process.platform !== "win32") chmodSync(path, 0o644);
    now = 2_000;
    const rotated = await recreated.configure("rotated-code-1234");
    assert.equal(rotated.createdAt, 2_000);
    assert.deepEqual(await recreated.match(configured.code, { developmentCode: null }), { available: true, matched: false });
    assert.deepEqual(await recreated.match(rotated.code, { developmentCode: null }), { available: true, matched: true });
    if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);

    await recreated.remove();
    assert.equal(existsSync(path), false);
    assert.deepEqual(await recreated.status(null), { configured: false, source: "none" });
    assert.deepEqual(await recreated.status("3570"), { configured: false, source: "development" });
    assert.deepEqual(await recreated.match("3570", { developmentCode: "3570" }), { available: true, matched: true });
    assert.deepEqual(await recreated.match("3570", { developmentCode: null }), { available: false, matched: false });
  });
});

test("configured codes require twelve normalized characters and malformed stores fail closed", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "remote-pairing-code.json");
    const store = new RemotePairingCodeStore({ path });
    await assert.rejects(
      store.configure("muy-corto"),
      error => error instanceof ApiError && error.code === "invalid_remote_pairing_code",
    );
    assert.equal(existsSync(path), false);

    const isInvalidStore = (error: unknown): boolean =>
      error instanceof ApiError && error.status === 409 && error.code === "remote_pairing_code_store_invalid";
    for (const corrupted of ["{not-json", JSON.stringify({ schemaVersion: 99 })]) {
      writeFileSync(path, corrupted, { mode: 0o600 });
      await assert.rejects(store.status("3570"), isInvalidStore);
      await assert.rejects(store.match("3570", { developmentCode: "3570" }), isInvalidStore);
      await assert.rejects(store.match("3570", { developmentCode: null }), isInvalidStore);
      await assert.rejects(store.configure("repair-code-1234"), isInvalidStore);
      await store.remove();
      assert.deepEqual(await store.status("3570"), { configured: false, source: "development" });
    }

    const repaired = await store.configure("repair-code-1234");
    assert.deepEqual(await store.match(repaired.code, { developmentCode: null }), { available: true, matched: true });
    assert.equal(remotePairingCodeStoreSchema.safeParse(JSON.parse(readFileSync(path, "utf8"))).success, true);
  });
});

test("the path override wins over the server config directory", async () => {
  await withTempDir(async (dir) => {
    const previous = process.env.OPENWORK_REMOTE_PAIRING_CODE_STORE;
    const override = join(dir, "custom", "pairing.json");
    process.env.OPENWORK_REMOTE_PAIRING_CODE_STORE = override;
    try {
      const configPath = join(dir, "elsewhere", "server.json");
      assert.equal(resolveRemotePairingCodeStorePath(configPath), override);
      const store = new RemotePairingCodeStore({ configPath });
      await store.configure("override-code-1234");
      assert.equal(existsSync(override), true);
      assert.equal(existsSync(join(dir, "elsewhere", "remote-pairing-code.json")), false);
    } finally {
      if (previous === undefined) delete process.env.OPENWORK_REMOTE_PAIRING_CODE_STORE;
      else process.env.OPENWORK_REMOTE_PAIRING_CODE_STORE = previous;
    }
  });
});

test("mutations are queued so concurrent rotations cannot lose the final code", async () => {
  await withTempDir(async (dir) => {
    let now = 0;
    const store = new RemotePairingCodeStore({ path: join(dir, "remote-pairing-code.json"), now: () => ++now });
    const codes = Array.from({ length: 8 }, (_, index) => `queue-code-${String(index).padStart(3, "0")}`);
    const configured = await Promise.all(codes.map(code => store.configure(code)));
    assert.deepEqual(configured.map(entry => entry.createdAt), [1, 2, 3, 4, 5, 6, 7, 8]);
    for (let index = 0; index < codes.length - 1; index += 1) {
      assert.deepEqual(await store.match(configured[index].code, { developmentCode: null }), { available: true, matched: false });
    }
    assert.deepEqual(await store.match(configured[codes.length - 1].code, { developmentCode: null }), { available: true, matched: true });
  });
});

test("the reusable-code rate limiter blocks after five failures and clears after five minutes", () => {
  let now = 10_000;
  const limiter = createRemotePairingCodeRateLimiter({ now: () => now });
  for (let attempt = 0; attempt < REMOTE_PAIRING_CODE_MAX_FAILURES; attempt += 1) {
    assert.equal(limiter.isBlocked(), false);
    limiter.recordFailure();
  }
  assert.equal(limiter.isBlocked(), true);
  assert.equal(limiter.retryAfterMs(), REMOTE_PAIRING_CODE_BLOCK_MS);
  now += REMOTE_PAIRING_CODE_BLOCK_MS - 1;
  assert.equal(limiter.isBlocked(), true);
  now += 1;
  assert.equal(limiter.isBlocked(), false);
  assert.equal(limiter.retryAfterMs(), 0);
  limiter.recordFailure();
  assert.equal(limiter.isBlocked(), false);
  limiter.reset();
  assert.equal(limiter.retryAfterMs(), 0);
});

test("a development fallback requires an explicit non-empty OPENWORK_DEV_PAIRING_CODE", () => {
  assert.equal(resolveDevelopmentRemotePairingCode({}), null);
  assert.equal(resolveDevelopmentRemotePairingCode({ OPENWORK_DEV_PAIRING_CODE: "" }), null);
  assert.equal(resolveDevelopmentRemotePairingCode({ OPENWORK_DEV_PAIRING_CODE: "3570" }), "3570");
  assert.equal(resolveDevelopmentRemotePairingCode({ OPENWORK_DEV_PAIRING_CODE: "eval-code" }), "EVALCODE");
});

test("TokenService serializes concurrent creates and revokes without losing persisted tokens", async () => {
  await withTempDir(async (dir) => {
    const previous = process.env.OPENWORK_TOKEN_STORE;
    process.env.OPENWORK_TOKEN_STORE = join(dir, "tokens.json");
    try {
      const config = await resolveServerConfig({
        configPath: join(dir, "server.json"),
        workspaces: [dir],
        port: 0,
        token: "pairing-client",
        hostToken: "pairing-host",
        logRequests: false,
      });
      const tokens = new TokenService(config);
      const created = await Promise.all(Array.from({ length: 20 }, (_, index) =>
        tokens.create("owner", { label: `device:Concurrent-${index}` }),
      ));
      assert.equal(new Set(created.map(token => token.id)).size, created.length);
      assert.equal(new Set(created.map(token => token.token)).size, created.length);
      assert.equal((await new TokenService(config).list()).length, created.length);

      const revoked = await Promise.all(created.slice(0, 10).map(token => tokens.revoke(token.id)));
      assert.equal(revoked.every(Boolean), true);
      const remaining = await new TokenService(config).list();
      assert.equal(remaining.length, 10);
      assert.equal(remaining.some(token => created.slice(0, 10).some(entry => entry.id === token.id)), false);
    } finally {
      if (previous === undefined) delete process.env.OPENWORK_TOKEN_STORE;
      else process.env.OPENWORK_TOKEN_STORE = previous;
    }
  });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkpointPath, ContinuityError, readComexCheckpoint, redactMemorySecrets, writeComexCheckpoint } from "../src/comex/continuity.js";
import { readComexMemory } from "../src/comex/seed.js";

const input = { objective: "Terminar el informe", decisions: ["Destino confirmado"], progress: ["Fuentes: fuentes.md"], pending: ["Validar cifras"], artifacts: [{ path: "informe.docx", evidence: "Borrador generado; revisión pendiente" }] };
async function setup(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "comex-continuity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("checkpoint survives reread and stays isolated by session and project", async t => {
  const root = await setup(t); const other = await setup(t);
  assert.equal((await readComexCheckpoint(root, "ses_a")).status, "missing");
  const result = await writeComexCheckpoint(root, "ses_a", input, 0);
  assert.equal(result.revision, 1);
  assert.deepEqual((await readComexCheckpoint(root, "ses_a")).checkpoint, result);
  assert.equal((await readComexCheckpoint(root, "ses_b")).status, "missing");
  assert.equal((await readComexCheckpoint(other, "ses_a")).status, "missing");
  if (process.platform !== "win32") assert.equal((await stat(join(root, checkpointPath("ses_a")))).mode & 0o777, 0o600);
});

test("concurrent writes admit one revision and never lose a completed update", async t => {
  const root = await setup(t);
  const results = await Promise.allSettled([writeComexCheckpoint(root, "ses_a", input, 0), writeComexCheckpoint(root, "ses_a", { ...input, objective: "Otro objetivo" }, 0)]);
  assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(results.filter(item => item.status === "rejected").length, 1);
  await assert.rejects(writeComexCheckpoint(root, "ses_a", input, 0), error => error instanceof ContinuityError && error.code === "conflict");
  const previous = await readComexCheckpoint(root, "ses_a");
  assert.equal(previous.revision, 1);
  await writeComexCheckpoint(root, "ses_a", { ...input, pending: ["Revisado"] }, 1);
  assert.equal((await readComexCheckpoint(root, "ses_a")).revision, 2);
});

test("a writer never steals another process lock, even an old one", async t => {
  const root = await setup(t);
  await mkdir(join(root, "comex/sesiones"), { recursive: true });
  const lock = join(root, `${checkpointPath("ses_a")}.lock`);
  await writeFile(lock, "another writer");
  await assert.rejects(writeComexCheckpoint(root, "ses_a", input, 0), error => error instanceof ContinuityError && error.code === "busy");
  assert.equal(await readFile(lock, "utf8"), "another writer");
});

test("invalid and oversized files are excluded without silently resetting history", async t => {
  const root = await setup(t);
  await writeComexCheckpoint(root, "ses_a", input, 0);
  const path = join(root, checkpointPath("ses_a"));
  await writeFile(path, "{partial write");
  assert.equal((await readComexCheckpoint(root, "ses_a")).status, "invalid");
  await assert.rejects(writeComexCheckpoint(root, "ses_a", input, 0), /conservado/);
  assert.equal(await readFile(path, "utf8"), "{partial write");
  await writeFile(path, "x".repeat(50 * 1024));
  assert.equal((await readComexCheckpoint(root, "ses_a")).status, "invalid");
});

test("strict input limits reject oversized notes and unexpected fields", async t => {
  const root = await setup(t);
  for (const value of [{ ...input, decisions: Array(17).fill("nota") }, { ...input, objective: "x".repeat(1601) }, { ...input, pending: ["x".repeat(801)] }, { ...input, arbitrary: true }]) {
    await assert.rejects(writeComexCheckpoint(root, "ses_a", value, 0), error => error instanceof ContinuityError && error.code === "invalid");
  }
  await assert.rejects(writeComexCheckpoint(root, "ses_a", input, -1));
  await assert.rejects(writeComexCheckpoint(root, "../../outside", input, 0));
});

test("known credentials are redacted on disk and again when injected from external edits", async t => {
  const root = await setup(t);
  const credential = "sk-" + "a".repeat(25);
  const text = `api_key=${credential} password=private-value Bearer abc.def.ghi https://user:password@example.test/data`;
  const checkpoint = await writeComexCheckpoint(root, "ses_a", { ...input, decisions: [text] }, 0);
  const path = join(root, checkpointPath("ses_a"));
  assert.doesNotMatch(await readFile(path, "utf8"), /private-value|abc\.def\.ghi|user:password/);
  await writeFile(path, JSON.stringify({ ...checkpoint, objective: credential }));
  const read = await readComexCheckpoint(root, "ses_a");
  assert.equal(read.checkpoint?.objective, "[secreto omitido]");
  assert.equal(redactMemorySecrets("-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----"), "[secreto omitido]");
  assert.equal(redactMemorySecrets("-----BEGIN PRIVATE KEY-----\ntruncated-secret"), "[secreto omitido]");
  for (const text of ['{"password": "example-secret-123"}', 'Authorization: Basic dXNlcjpwYXNzd29yZA==', 'password="example secret phrase"', "api_key='example secret phrase'"]) {
    assert.doesNotMatch(redactMemorySecrets(text), /example|secret phrase|dXNlcjpwYXNzd29yZA/);
    assert.equal(redactMemorySecrets(redactMemorySecrets(text)), redactMemorySecrets(text));
  }
});

test("symbolic files and parents cannot redirect persistence outside the project", async t => {
  const root = await setup(t); const outside = await setup(t);
  await symlink(outside, join(root, "comex"), "dir");
  await assert.rejects(writeComexCheckpoint(root, "ses_a", input, 0), /enlaces simbólicos/);
  await assert.rejects(readComexCheckpoint(root, "ses_a"), /enlaces simbólicos/);
});

test("memory injection includes structured continuity only when its feature is enabled", async t => {
  const root = await setup(t);
  const before = process.env.DEN_FEATURE_COMEX_CONTINUITY;
  t.after(async () => { if (before === undefined) delete process.env.DEN_FEATURE_COMEX_CONTINUITY; else process.env.DEN_FEATURE_COMEX_CONTINUITY = before; });
  await writeComexCheckpoint(root, "ses_a", input, 0);
  process.env.DEN_FEATURE_COMEX_CONTINUITY = "false";
  assert.equal((await readComexMemory(root, "ses_a")).continuity, undefined);
  process.env.DEN_FEATURE_COMEX_CONTINUITY = "true";
  const memory = await readComexMemory(root, "ses_a");
  assert.deepEqual(memory.continuity?.checkpoint?.pending, input.pending);
});

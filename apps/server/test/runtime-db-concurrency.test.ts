import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openRuntimeSqliteDatabase } from "../src/runtime-db.js";

test("runtime DB readers see committed data while a second writer waits for a competing transaction", async () => {
  const root = await mkdtemp(join(tmpdir(), "runtime-contention-"));
  const path = join(root, "runtime.sqlite");
  const db = await openRuntimeSqliteDatabase(path);
  if (db.kind !== "node") throw new Error("Run this native SQLite contention test with Node 24.");
  if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
  db.sqlite.exec("CREATE TABLE counters (n INTEGER); INSERT INTO counters VALUES (1)");
  const worker = new Worker(`const {parentPort,workerData}=require('node:worker_threads');const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(workerData);db.exec('BEGIN IMMEDIATE; UPDATE counters SET n=2');parentPort.postMessage('locked');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);db.exec('COMMIT');db.close();`, { eval: true, workerData: path });
  const exited = once(worker, "exit");
  try {
    await once(worker, "message");
    assert.equal(db.sqlite.prepare("SELECT n FROM counters").get()?.n, 1);
    db.sqlite.exec("INSERT INTO counters VALUES (3)");
    await exited;
    assert.deepEqual(db.sqlite.prepare("SELECT n FROM counters ORDER BY n").all().map(row => row.n), [2, 3]);
  } finally { await worker.terminate(); db.close(); await rm(root, { recursive: true, force: true }); }
});

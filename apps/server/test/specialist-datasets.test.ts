import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiError } from "../src/errors.js";
import {
  deleteDataset, listDatasets, listSnapshotDates, readDatasetQuery, readLatestSnapshot, recordDatasetRun, refreshDataset,
} from "../src/specialists/datasets.js";

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "specialists-datasets-"));
  await mkdir(join(root, "comex", "fuentes", "tavily"), { recursive: true });
  return root;
}

async function evidence(root: string, name: string, payload: unknown) {
  const relative = `comex/fuentes/tavily/${name}.json`;
  await writeFile(join(root, relative), JSON.stringify(payload));
  return relative;
}

const query = { provider: "tavily", operation: "search", input: { query: "aranceles soja china", maxResults: 5 } };

test("the same exact query re-runs into one dataset with timestamped snapshots", async () => {
  const root = await workspace();
  try {
    const first = await recordDatasetRun(root, query, await evidence(root, "a", { results: [1] }));
    assert.equal(first.created, true);
    assert.equal(first.dataset.operation, "search");
    assert.equal(first.dataset.question, "aranceles soja china");
    const second = await recordDatasetRun(root, { ...query, input: { ...query.input, query: "otra cosa" } }, await evidence(root, "b", { results: [2] }));
    assert.equal(second.created, true);
    const again = await recordDatasetRun(root, query, await evidence(root, "c", { results: [3] }));
    assert.equal(again.created, false);
    assert.equal(again.dataset.id, first.dataset.id);
    assert.equal(again.dataset.snapshots, 2);
    assert.equal((await listDatasets(root)).length, 2);
    assert.deepEqual(await readLatestSnapshot(root, first.dataset.id), { results: [3] });
    assert.equal((await listSnapshotDates(root, first.dataset.id)).length, 2);
    assert.deepEqual(await readDatasetQuery(root, first.dataset.id), query);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("snapshot retention keeps the newest fifty and LATEST points at one of them", async () => {
  const root = await workspace();
  try {
    const recorded = await recordDatasetRun(root, query, await evidence(root, "x", { n: 0 }));
    const folder = join(root, "comex", "datasets", recorded.dataset.id, "snapshots");
    for (let i = 1; i <= 52; i++) await writeFile(join(folder, `2020-01-0${i % 9}T00-00-0${i % 10}-000Z.json`), JSON.stringify({ n: i }));
    await recordDatasetRun(root, query, await evidence(root, "y", { n: 99 }));
    const dates = await listSnapshotDates(root, recorded.dataset.id);
    assert.equal(dates.length, 50);
    assert.deepEqual(await readLatestSnapshot(root, recorded.dataset.id), { n: 99 });
    assert.equal((await listDatasets(root)).find(entry => entry.id === recorded.dataset.id)?.snapshots, 50);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a dataset re-runs through an injected runner without importing providers", async () => {
  const root = await workspace();
  try {
    const recorded = await recordDatasetRun(root, query, await evidence(root, "a", { results: [1] }));
    const refreshed = await refreshDataset(root, recorded.dataset.id, async value => {
      assert.deepEqual(value, query);
      return { evidencePath: await evidence(root, "again", { results: [2] }) };
    });
    assert.equal(refreshed.created, false);
    assert.equal(refreshed.dataset.snapshots, 2);
    assert.deepEqual(await readLatestSnapshot(root, recorded.dataset.id), { results: [2] });
    await assert.rejects(refreshDataset(root, "ds_inventado", async () => ({ evidencePath: "x" })), (error) => error instanceof Error);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("dataset ids, pointers and removal are validated", async () => {
  const root = await workspace();
  try {
    const recorded = await recordDatasetRun(root, query, await evidence(root, "a", { results: [1] }));
    await assert.rejects(readDatasetQuery(root, `../escape`), (error) => error instanceof ApiError && error.code === "invalid_dataset");
    const folder = join(root, "comex", "datasets", recorded.dataset.id);
    await writeFile(join(folder, "LATEST"), "not-a-snapshot.sh", "utf8");
    await assert.rejects(readLatestSnapshot(root, recorded.dataset.id), (error) => error instanceof ApiError && error.code === "invalid_dataset");
    await deleteDataset(root, recorded.dataset.id);
    assert.equal((await listDatasets(root)).length, 0);
    await assert.rejects(deleteDataset(root, recorded.dataset.id), (error) => error instanceof ApiError && error.code === "dataset_not_found");
    // The index survives a manually corrupt line: bad entries drop, the rest stay.
    await recordDatasetRun(root, query, await evidence(root, "b", { results: [3] }));
    const index = join(root, "comex", "datasets", "index.json");
    await writeFile(index, JSON.stringify([{ basura: true }, ...(JSON.parse(await readFile(index, "utf8")))]));
    assert.equal((await listDatasets(root)).length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";
import { nodeReadableToWeb } from "../src/node-web-stream.js";
import { serve } from "../src/serve-node.js";

test("a file streams through a Fetch Response byte for byte", async () => {
  const root = await mkdtemp(join(tmpdir(), "openwork-web-stream-"));
  try {
    const path = join(root, "blob.bin");
    const bytes = randomBytes(3 * 1024 * 1024 + 17);
    await writeFile(path, bytes);
    const body = new Uint8Array(await new Response(nodeReadableToWeb(createReadStream(path))).arrayBuffer());
    assert.equal(Buffer.compare(Buffer.from(body), bytes), 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cancelling the web stream destroys the Node stream, and string chunks become bytes", async () => {
  const source = Readable.from(["ab", "cd"], { objectMode: true });
  const reader = nodeReadableToWeb(source).getReader();
  const first = await reader.read();
  assert.ok(first.value instanceof Uint8Array);
  assert.equal(Buffer.from(first.value).toString("utf8"), "ab");
  await reader.cancel();
  assert.equal(source.destroyed, true);
});

test("a stream of non-byte chunks errors instead of passing them on", async () => {
  const reader = nodeReadableToWeb(Readable.from([{ not: "bytes" }])).getReader();
  await assert.rejects(reader.read(), TypeError);
});

test("the Node adapter hands a large request body to the handler intact", async () => {
  const server = await serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async request => new Response(Buffer.from(await request.arrayBuffer()).toString("base64")),
  });
  try {
    const bytes = randomBytes(2 * 1024 * 1024 + 3);
    const response = await fetch(`http://127.0.0.1:${server.port}/upload`, { method: "POST", body: bytes });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), bytes.toString("base64"));
  } finally {
    await server.stop();
  }
});

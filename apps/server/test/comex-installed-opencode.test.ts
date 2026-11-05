import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInstalledOpencodeEngine, readInstalledOpencodeConnection } from "../src/comex/installed-opencode.js";
import { openworkPromotionsEnabled } from "../src/comex/features.js";

test("installed service reuses native accounts without changing configuration or stopping the service", async () => {
  const root = await mkdtemp(join(tmpdir(), "comex-service-"));
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (request.headers.authorization !== `Basic ${Buffer.from("opencode:transport-fixture").toString("base64")}`) { response.writeHead(401).end(); return; }
    response.setHeader("content-type", "application/json");
    const path = new URL(request.url!, "http://localhost").pathname;
    response.end(JSON.stringify(path === "/api/info" ? { version: "2.2.0", pid: 1234 }
      : { data: path === "/api/provider" ? [{ id: "native-provider" }] : [{ id: "fixture-model", providerID: "native-provider" }] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const file = join(root, "service.json");
  await writeFile(file, JSON.stringify({ url: `http://127.0.0.1:${address.port}`, password: "transport-fixture", pid: 1234 }));
  const engine = createInstalledOpencodeEngine(file, true);
  try {
    await engine.ensureWorkspaceReady("/fixture project");
    const status = engine.status();
    assert.equal(status.running, true);
    assert.equal(status.connectionSource, "installed");
    assert.deepEqual(status.mirroredProviderIds, ["native-provider"]);
    assert.equal(JSON.stringify(status).includes("transport-fixture"), false);
    assert.ok(engine.connection());
    await assert.rejects(engine.setChatRouting(false), /managed/);
    await assert.rejects(engine.settleWorkspaceMcp("workspace", "/fixture", "server"), /OpenCode instalado/);
    await engine.stop();
    assert.equal(engine.connection(), undefined);
    assert.ok(requests.every(request => request.startsWith("GET /api/")));
    assert.equal((await fetch(`http://127.0.0.1:${address.port}/api/info`, { headers: { authorization: `Basic ${Buffer.from("opencode:transport-fixture").toString("base64")}` } })).status, 200);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});

test("remote, credential-bearing, malformed and symlink receipts fail without revealing secrets", async () => {
  const root = await mkdtemp(join(tmpdir(), "comex-service-"));
  const file = join(root, "service.json");
  try {
    for (const url of ["https://127.0.0.1:1234", "http://example.com:1234", "http://127.0.0.1:1234/private", "http://user:secret@127.0.0.1:1234", "http://127.0.0.1:1234/?secret"]) {
      await writeFile(file, JSON.stringify({ url, password: "private-fixture", pid: 1234 }));
      assert.throws(() => readInstalledOpencodeConnection(file), error => error instanceof Error && !error.message.includes("private-fixture") && /OpenCode instalado/.test(error.message));
    }
    await symlink(file, join(root, "link"));
    assert.throws(() => readInstalledOpencodeConnection(join(root, "link")));
    await writeFile(file, '{"password":"private-fixture"');
    const engine = createInstalledOpencodeEngine(file, true);
    await assert.rejects(engine.refreshProviders(), /OpenCode instalado/);
    assert.equal(engine.status().running, false);
    assert.equal(engine.connection(), undefined);
    assert.equal(JSON.stringify(engine.status()).includes("private-fixture"), false);
    await engine.stop();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("service restart refreshes its transport address and password without copying provider keys", async () => {
  const root = await mkdtemp(join(tmpdir(), "comex-service-"));
  const file = join(root, "service.json");
  try {
    await writeFile(file, JSON.stringify({ url: "http://127.0.0.1:1234", password: "first", pid: 1 }));
    assert.equal(readInstalledOpencodeConnection(file).password, "first");
    await writeFile(file, JSON.stringify({ url: "http://127.0.0.1:4321", password: "second", pid: 2 }));
    assert.equal(readInstalledOpencodeConnection(file).url, "http://127.0.0.1:4321");
    assert.equal(readInstalledOpencodeConnection(file).password, "second");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("promotions have a true/false operator flag and default to false", () => {
  assert.equal(openworkPromotionsEnabled({}), false);
  assert.equal(openworkPromotionsEnabled({ DEN_FEATURE_OPENWORK_PROMOTIONS: "false" }), false);
  assert.equal(openworkPromotionsEnabled({ DEN_FEATURE_OPENWORK_PROMOTIONS: "true" }), true);
  assert.equal(openworkPromotionsEnabled({ DEN_FEATURE_OPENWORK_PROMOTIONS: "invalid" }), false);
});

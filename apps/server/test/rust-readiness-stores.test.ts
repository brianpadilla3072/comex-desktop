// Files on disk are read through their schemas: a corrupt or foreign file falls back the same way
// it did before validation, and a malformed entry never reaches callers half-typed.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { openworkAuditLogPath, readAuditEntries, readLastAudit } from "../src/audit.js";
import { resolveServerConfig } from "../src/config.js";
import { EnvService, EnvStoreReadError } from "../src/env-file.js";
import { parseMcpAppSandboxCsp } from "../src/mcp-app-sandbox.js";
import { TokenService } from "../src/tokens.js";
import { hashToken } from "../src/utils.js";

const roots: string[] = [];
after(async () => { await Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))); });

async function scratch(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openwork-rust-readiness-"));
  roots.push(root);
  return root;
}

async function writeText(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, "utf8");
}

test("server.json fields with the wrong type are ignored, the rest still applies", async () => {
  const root = await scratch();
  const configPath = join(root, "server.json");
  await writeText(configPath, JSON.stringify({ host: 42, port: 9123, readOnly: "yes", logFormat: "text", corsOrigins: ["https://a.example"] }));
  const config = await resolveServerConfig({ workspaces: [], configPath });
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 9123);
  assert.equal(config.readOnly, false);
  assert.equal(config.logFormat, "pretty");
  assert.deepEqual(config.corsOrigins, ["https://a.example"]);
});

test("a server.json that is not an object is treated as empty", async () => {
  const root = await scratch();
  for (const text of ["[1,2]", "null", "{not json"]) {
    const configPath = join(root, "server.json");
    await writeText(configPath, text);
    const config = await resolveServerConfig({ workspaces: [], configPath });
    assert.equal(config.port, 8787);
    assert.deepEqual(config.corsOrigins, ["*"]);
  }
});

test("tokens.json skips malformed entries and survives a corrupt file", async () => {
  const root = await scratch();
  const configPath = join(root, "server.json");
  await writeText(configPath, "{}");
  const config = await resolveServerConfig({ workspaces: [], configPath });
  const storePath = join(root, "tokens.json");
  const previous = process.env.OPENWORK_TOKEN_STORE;
  process.env.OPENWORK_TOKEN_STORE = storePath;
  try {
    await writeText(storePath, JSON.stringify({
      schemaVersion: 1,
      tokens: [
        null,
        { id: "a", hash: hashToken("secret-a"), scope: "owner", createdAt: 5, label: "Laptop" },
        { id: "b", hash: hashToken("secret-b"), scope: "admin" },
        { id: "", hash: hashToken("secret-c"), scope: "viewer" },
        { id: "d", hash: hashToken("secret-d"), scope: "viewer", createdAt: "yesterday", label: 7 },
      ],
    }));
    const tokens = await new TokenService(config).list();
    assert.deepEqual(tokens.map(token => token.id), ["a", "d"]);
    assert.deepEqual(tokens[0], { id: "a", scope: "owner", createdAt: 5, label: "Laptop" });
    assert.equal(typeof tokens[1]?.createdAt, "number");
    assert.equal("label" in (tokens[1] ?? {}), false);

    await writeText(storePath, "{\"tokens\": 3}");
    assert.deepEqual(await new TokenService(config).list(), []);
    await writeText(storePath, "not json");
    assert.deepEqual(await new TokenService(config).list(), []);
  } finally {
    if (previous === undefined) delete process.env.OPENWORK_TOKEN_STORE;
    else process.env.OPENWORK_TOKEN_STORE = previous;
  }
});

async function envListError(path: string): Promise<string> {
  try {
    await new EnvService({ path }).list();
  } catch (error) {
    assert.ok(error instanceof EnvStoreReadError);
    return error.message;
  }
  return "no error";
}

test("the env store keeps its invalid-format error and tolerant injection read", async () => {
  const root = await scratch();
  const path = join(root, "env.json");
  for (const text of ["[]", "null", "{\"variables\": {}}"]) {
    await writeText(path, text);
    assert.match(await envListError(path), /invalid format/);
    assert.deepEqual(await EnvService.readForInjection(path), {});
  }
  await writeText(path, "{oops");
  assert.match(await envListError(path), /invalid JSON/);
  await writeText(path, JSON.stringify({ variables: [null, { key: "API_TOKEN", value: "x", updatedAt: 1 }] }));
  assert.deepEqual((await new EnvService({ path }).list()).map(entry => entry.key), ["API_TOKEN"]);
});

test("audit logs skip lines that are not audit entries", async () => {
  const root = await scratch();
  const entry = { id: "1", workspaceId: "ws-audit", actor: { type: "host" }, action: "config.write", target: "x", summary: "s", timestamp: 1 };
  await writeText(openworkAuditLogPath(root), [JSON.stringify(entry), "{broken", JSON.stringify({ id: 2 }), JSON.stringify({ ...entry, id: "3", extra: true })].join("\n"));
  const entries = await readAuditEntries(root, "ws-audit-missing");
  assert.deepEqual(entries.map(item => item.id), ["3", "1"]);
  assert.equal((await readLastAudit(root, "ws-audit-missing"))?.id, "3");
  await writeText(openworkAuditLogPath(root), `${JSON.stringify(entry)}\n[1]`);
  assert.equal(await readLastAudit(root, "ws-audit-missing"), null);
});

test("an MCP App csp query that is not an object allows nothing", () => {
  const empty = { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] };
  for (const value of ["null", "[\"https://a.example\"]", "\"x\"", "{\"connectDomains\": \"https://a.example\"}"]) {
    assert.deepEqual(parseMcpAppSandboxCsp(value), empty);
  }
  assert.deepEqual(parseMcpAppSandboxCsp(JSON.stringify({ frameDomains: ["https://a.example", "javascript:x"] })).frameDomains, ["https://a.example"]);
});

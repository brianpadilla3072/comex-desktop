import { readFile, writeFile, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { startServer } from "../apps/server/src/server.js";
import type { ServerConfig } from "../apps/server/src/types.js";
const proof = JSON.parse(await readFile("docs/features/task-continuity/native-proof.json", "utf8"));
const root = dirname(proof.workspace);
process.env.DEN_FEATURE_TASK_CONTINUITY = "true";
process.env.DEN_FEATURE_COMEX_GIT_WORKSPACE = "true";
process.env.OPENWORK_COMEX_OPENCODE_SERVICE_FILE ??= join(homedir(), ".local/state/opencode/service.json");
const config: ServerConfig = { host: "127.0.0.1", port: 0, token: randomBytes(24).toString("hex"), hostToken: randomBytes(24).toString("hex"), approval: { mode: "auto", timeoutMs: 30000 }, corsOrigins: ["http://127.0.0.1:5189", "http://localhost:5189"], workspaces: [{ id: "ws_proof", name: "Prueba de objetivos", path: proof.workspace, workspaceType: "local", preset: "specialist" }], authorizedRoots: [proof.workspace], readOnly: false, startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated", logFormat: "json", logRequests: false, configPath: join(root, "runtime/server.json") };
const server = await startServer(config);
const base = `http://127.0.0.1:${server.port}`;
const privateFile = join(root, "ui-connection.json");
await writeFile(privateFile, JSON.stringify({ base, token: config.token, hostToken: config.hostToken, sessionId: proof.sessionId }), { mode: 0o600 });
const vite = spawn(process.execPath, [resolve("apps/app/node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", "5189"], { cwd: resolve("apps/app"), env: { ...process.env, OPENWORK_DEV_MODE: "1", VITE_OPENWORK_URL: base, VITE_OPENWORK_TOKEN: config.token, VITE_OPENWORK_HOST_TOKEN: config.hostToken }, stdio: "ignore" });
try {
  for (let n = 0; n < 60; n++) { if (await fetch("http://127.0.0.1:5189").then(r => r.ok).catch(() => false)) break; await delay(500); }
  for (const suffix of [`/workspace/ws_proof/git/review?codeOnly=true&session=${proof.sessionId}`, `/workspace/ws_proof/tasks/${proof.sessionId}/worktrees`]) {
    const r = await fetch(base + suffix, { headers: { authorization: `Bearer ${config.token}`, "x-openwork-host-token": config.hostToken } });
    console.log("Git UI API", r.status, r.ok ? "ready" : await r.text());
  }
  const child = spawn("python3", [resolve("scripts/task-continuity-ui-proof.py"), privateFile], { stdio: "inherit" });
  const code = await new Promise(resolveExit => child.once("exit", resolveExit));
  if (code !== 0) throw new Error("UI proof failed");
} finally { vite.kill(); await server.stop(); await rm(privateFile, { force: true }); }

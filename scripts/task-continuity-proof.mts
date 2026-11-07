/** Real HTTP + installed OpenCode + Big Pickle proof, restricted to disposable projects/chats. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { startServer } from "../apps/server/src/server.js";
import type { ServerConfig } from "../apps/server/src/types.js";
import { taskController } from "../apps/server/src/task-continuity.js";
import { taskStateSchema } from "../packages/types/src/task-continuity.ts";
import { isRecord } from "../apps/server/src/workspace-kv-store.js";

const root = await mkdtemp(join(tmpdir(), "task-native-proof-"));
const workspace = join(root, "project"); await mkdir(workspace);
process.env.DEN_FEATURE_TASK_CONTINUITY = "true";
process.env.DEN_FEATURE_COMEX_GIT_WORKSPACE = "true";
process.env.OPENWORK_COMEX_OPENCODE_SERVICE_FILE ??= join(homedir(), ".local/state/opencode/service.json");
process.env.OPENWORK_DATA_DIR = join(root, "openwork");
const config: ServerConfig = { host: "127.0.0.1", port: 0, token: randomBytes(24).toString("hex"), hostToken: randomBytes(24).toString("hex"), approval: { mode: "auto", timeoutMs: 30000 }, corsOrigins: ["http://localhost:5189"], workspaces: [{ id: "ws_proof", name: "Prueba de objetivos", path: workspace, workspaceType: "local", preset: "specialist" }], authorizedRoots: [workspace], readOnly: false, startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated", logFormat: "json", logRequests: false, configPath: join(root, "runtime/server.json") };
const git = (...args: string[]) => execFileSync("git", ["-C", workspace, ...args], { encoding: "utf8" }).trim();
git("init", "-q"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
await writeFile(join(workspace, "README.md"), "Disposable verification workspace\n"); git("add", "README.md"); git("commit", "-qm", "fixture");
let server = await startServer(config);
let base = `http://127.0.0.1:${server.port}`;
async function call(path: string, body?: unknown, method = body === undefined ? "GET" : "POST", host = false) {
  const response = await fetch(base + path, { method, headers: { authorization: `Bearer ${host ? config.hostToken : config.token}`, "content-type": "application/json", ...(host ? { "x-openwork-host-token": config.hostToken } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text();
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : null;
}
let sessionId = "";
const report: Record<string, unknown> = { startedAt: new Date().toISOString(), model: "opencode/big-pickle", workspace, assertions: [] };
const checks: string[] = [];
try {
  for (let attempt = 0; attempt < 50; attempt++) { const status = await call("/experimental/engine-v2-preview/status"); if (status.running) break; await delay(300); }
  const created = await call("/workspace/ws_proof/opencode2/api/session", { title: "Prueba aislada de objetivos", location: { directory: workspace }, model: { providerID: "opencode", id: "big-pickle" }, permissions: [{ action: "*", resource: "*", effect: "allow" }] });
  sessionId = created.data.id;
  const taskPath = `/workspace/ws_proof/tasks/${sessionId}`;
  await call(taskPath, { revision: 0, action: "start", goal: { objective: "Creá suma.mjs exportando suma(a,b) y suma.test.mjs usando node:test. Verificá la suma y el caso de números negativos con node --test suma.test.mjs. Trabajá únicamente en esta carpeta temporal.", criteria: "Ambos archivos existen y node --test suma.test.mjs pasa. Revisá el código si hay cambios. Al finalizar informá la evidencia concreta.", maxTurns: 6 } }, "PUT", true);
  const deadline = Date.now() + 240000;
  let state = taskStateSchema.parse(await call(taskPath));
  let last = "";
  while (Date.now() < deadline) {
    await taskController(config)!.tick();
    state = taskStateSchema.parse(await call(taskPath));
    const label = `${state.status}:${state.phase}:${state.turns}`;
    if (label !== last) { console.log(label, state.reason); last = label; }
    if (["complete", "blocked", "paused"].includes(state.status)) break;
    await delay(1000);
  }
  assert.equal(state.status, "complete", state.reason + "\n" + state.summary);
  assert.equal(state.phase, "review");
  const output = execFileSync(process.execPath, ["--test", "suma.test.mjs"], { cwd: workspace, encoding: "utf8" });
  assert.match(output, /(?:pass|✔)/); checks.push("Big Pickle creó código y pruebas; las pruebas pasan fuera del agente");
  checks.push("El objetivo abrió un turno separado de revisión de código y terminó con evidencia");
  assert.ok(state.summary.length); const savedSummary = state.summary;
  await server.stop(); config.port = 0; server = await startServer(config); base = `http://127.0.0.1:${server.port}`;
  const restored = taskStateSchema.parse(await call(taskPath)); assert.equal(restored.summary, savedSummary); checks.push("Objetivo y continuidad sobreviven al reinicio del servidor");
  const head = git("rev-parse", "HEAD");
  await call(taskPath + "/worktrees", { action: "isolate", expectedHead: head }, "POST", true);
  const isolated = taskStateSchema.parse(await call(taskPath)); assert.ok(isolated.worktree);
  const native = await call(`/workspace/ws_proof/opencode2/api/session/${sessionId}`);
  assert.equal(native.data.location.directory, isolated.worktree); checks.push("El mismo chat conserva su identidad e historial al pasar a un worktree");
  await call(taskPath + "/worktrees", { action: "return" }, "POST", true);
  const home = await call(`/workspace/ws_proof/opencode2/api/session/${sessionId}`); assert.equal(home.data.location.directory, workspace);
  await call(taskPath + "/worktrees", { action: "remove", path: isolated.worktree, expectedHead: head }, "POST", true); checks.push("El chat vuelve al proyecto y retira el worktree limpio sin perder los archivos originales");
  const denied = await fetch(base + taskPath, { method: "PUT", headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" }, body: JSON.stringify({ revision: restored.revision, action: "pause" }) });
  assert.equal(denied.status, 401); checks.push("El token de cliente no puede activar ni cambiar objetivos");
  const prose = await call("/workspace/ws_proof/opencode2/api/session", { title: "Prueba de documento sin revisión de código", location: { directory: workspace }, model: { providerID: "opencode", id: "big-pickle" }, permissions: [{ action: "*", resource: "*", effect: "allow" }] });
  const prosePath = `/workspace/ws_proof/tasks/${prose.data.id}`;
  await call(prosePath, { revision: 0, action: "start", goal: { objective: "Creá informe.md con el texto Prueba documental verificada. No crees ni modifiques código.", criteria: "informe.md existe y se leyó para comprobar su contenido.", maxTurns: 3 } }, "PUT", true);
  let proseState = taskStateSchema.parse(await call(prosePath));
  const proseDeadline = Date.now() + 120000;
  while (Date.now() < proseDeadline && proseState.status === "active") { await delay(1000); await taskController(config)!.tick(); proseState = taskStateSchema.parse(await call(prosePath)); }
  assert.equal(proseState.status, "complete", proseState.reason + proseState.summary); assert.equal(proseState.phase, "work"); assert.equal(proseState.turns, 1);
  assert.match(await readFile(join(workspace, "informe.md"), "utf8"), /Prueba documental verificada/);
  checks.push("Un documento real termina en un turno, sin activar revisión de código");
  report.status = "Passed";
  console.log("PROOF PASSED", checks);
} catch (error) { report.status = "Failed"; report.error = error instanceof Error ? error.message : String(error); throw error; }
finally {
  report.assertions = checks; report.sessionId = sessionId; report.finishedAt = new Date().toISOString();
  await mkdir(resolve("docs/features/task-continuity"), { recursive: true });
  await writeFile(resolve("docs/features/task-continuity/native-proof.json"), JSON.stringify(report, null, 2) + "\n");
  if (sessionId) await call(`/workspace/ws_proof/opencode2/api/session/${sessionId}/interrupt`, {}).catch(() => undefined);
  await server.stop();
  console.log("Disposable proof workspace:", root);
}

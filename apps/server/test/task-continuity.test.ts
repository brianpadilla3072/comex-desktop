import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createTaskContinuity, goalVerdict } from "../src/task-continuity.js";
import type { ServerConfig, WorkspaceInfo } from "../src/types.js";
import { codeChangeFingerprint, createGitWorktree, listGitWorktrees, removeGitWorktree, reviewGitWorkspace } from "../src/comex/git.js";

const goal = { objective: "Crear un resultado comprobable", criteria: "Archivo verificado", maxTurns: 3 };
const assistant = (id: string, text: string) => ({ id, type: "assistant", time: { created: Date.now(), completed: Date.now() }, content: [{ type: "text", text }] });
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "task-continuity-"));
  const old = process.env.DEN_FEATURE_TASK_CONTINUITY;
  process.env.DEN_FEATURE_TASK_CONTINUITY = "true";
  const workspace: WorkspaceInfo = { id: "ws_fixture", name: "Fixture", path: root, workspaceType: "local" };
  const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "client-fixture", hostToken: "host-fixture", approval: { mode: "auto", timeoutMs: 30000 }, corsOrigins: [], workspaces: [workspace], authorizedRoots: [root], readOnly: false, startedAt: 0, tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false, configPath: join(root, "runtime/config.json") };
  const calls: { path: string; body: unknown }[] = [];
  let messages: Record<string, unknown>[] = [];
  let outcome = "succeeded";
  let pending = false;
  let models = true;
  let lost = false;
  let onModel: ((req: Request) => Promise<void>) | undefined;
  const request = async (req: Request) => {
    const path = new URL(req.url).pathname.split("/opencode2")[1]!;
    const body: unknown = req.method === "POST" ? await req.json() : null;
    calls.push({ path, body });
    if (req.method === "POST") {
      if (path.endsWith("/model") && onModel) await onModel(req);
      if (path.endsWith("/prompt") && lost) throw new Error("ack lost");
      return path.endsWith("/model") ? new Response(null, { status: 204 }) : Response.json({ data: { id: "msg_sent" } });
    }
    return Response.json({ data: path === "/api/model" ? models ? [{ providerID: "opencode", id: "big-pickle" }] : []
      : path === "/api/session/active" ? {} : path.endsWith("/message") ? [...messages].reverse()
      : path.endsWith("/permission") ? pending ? [{}] : [] : path.endsWith("/form") ? []
      : { id: "ses_fixture", location: { directory: root }, outcome } });
  };
  let controller = await createTaskContinuity(config, request);
  t.after(async () => { await controller.stop(); await rm(root, { recursive: true, force: true }); if (old === undefined) delete process.env.DEN_FEATURE_TASK_CONTINUITY; else process.env.DEN_FEATURE_TASK_CONTINUITY = old; });
  return { root, workspace, config, calls, get controller() { return controller; }, setMessages(v: Record<string, unknown>[]) { messages = v; }, setOutcome(v: string) { outcome = v; }, setPending(v: boolean) { pending = v; }, setModels(v: boolean) { models = v; }, loseAck() { lost = true; }, stallModel(fn: (req: Request) => Promise<void>) { onModel = fn; }, async restart() { await controller.stop(); controller = await createTaskContinuity(config, request); }, prompts() { return calls.filter(c => c.path.endsWith("/prompt")); } };
}

test("goal survives restart, starts with exact Big Pickle, deduplicates turns and stops at its budget", async t => {
  const f = await fixture(t);
  await f.controller.update(f.workspace, "ses_fixture", 0, "start", { ...goal, maxTurns: 1 });
  await f.controller.tick();
  assert.equal(f.prompts().length, 1);
  assert.deepEqual(f.calls.find(c => c.path.endsWith("/model") && c.body !== null)?.body, { model: { providerID: "opencode", id: "big-pickle" } });
  await f.controller.tick(); assert.equal(f.prompts().length, 1);
  f.setMessages([assistant("msg_a", "Avance parcial")]);
  await f.controller.tick();
  assert.equal(f.controller.get(f.workspace.id, "ses_fixture").status, "paused");
  assert.match(f.controller.get(f.workspace.id, "ses_fixture").summary, /Avance parcial/);
  await f.restart();
  assert.equal(f.controller.get(f.workspace.id, "ses_fixture").objective, goal.objective);
  assert.match(f.controller.get(f.workspace.id, "ses_fixture").summary, /Avance parcial/);
  await f.controller.tick(); assert.equal(f.prompts().length, 1);
});

test("completed prose skips code review, redacts memory and pauses on explicit stop", async t => {
  const f = await fixture(t);
  await f.controller.update(f.workspace, "ses_fixture", 0, "start", goal); await f.controller.tick();
  await writeFile(join(f.root, "informe.md"), "informe");
  f.setMessages([assistant("msg_a", 'password=private-fixture\nTASK_RESULT: {"status":"complete","evidence":"informe.md verificado"}')]);
  await f.controller.tick();
  const state = f.controller.get(f.workspace.id, "ses_fixture");
  assert.equal(state.status, "complete"); assert.equal(state.phase, "work"); assert.equal(f.prompts().length, 1);
  assert.ok(!state.summary.includes("private-fixture"));
  await f.controller.update(f.workspace, "ses_fixture", state.revision, "start", goal);
  const req = new Request("http://localhost", { method: "POST" });
  await f.controller.forward(f.workspace, "/api/session/ses_fixture/interrupt", req, async () => new Response(null, { status: 204 }));
  await f.controller.tick(); assert.equal(f.controller.get(f.workspace.id, "ses_fixture").status, "paused"); assert.equal(f.prompts().length, 1);
});

test("permissions, model absence and unknown admission never cause retries or bypasses", async t => {
  const f = await fixture(t);
  await f.controller.update(f.workspace, "ses_fixture", 0, "start", goal);
  f.setPending(true); await f.controller.tick(); assert.equal(f.prompts().length, 0);
  f.setPending(false); f.setModels(false); await f.controller.tick();
  assert.equal(f.controller.get(f.workspace.id, "ses_fixture").status, "blocked"); assert.equal(f.prompts().length, 0);
  f.setModels(true);
  await f.controller.update(f.workspace, "ses_fixture", f.controller.get(f.workspace.id, "ses_fixture").revision, "resume");
  f.loseAck(); await f.controller.tick(); await f.controller.tick();
  assert.equal(f.prompts().length, 1); assert.equal(f.controller.get(f.workspace.id, "ses_fixture").status, "paused");
});

test("code changes trigger a separate review turn, and review findings return to implementation", async t => {
  const f = await fixture(t);
  const git = (...args: string[]) => execFileSync("git", ["-C", f.root, ...args], { stdio: "ignore" });
  git("init"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
  await writeFile(join(f.root, "app.ts"), "export const x = 1;\n"); git("add", "app.ts"); git("commit", "-m", "fixture");
  await f.controller.update(f.workspace, "ses_fixture", 0, "start", { ...goal, maxTurns: 5 }); await f.controller.tick();
  await writeFile(join(f.root, "app.ts"), "export const x = 2;\n");
  f.setMessages([assistant("msg_a", 'TASK_RESULT: {"status":"complete","evidence":"app.ts y prueba"}')]);
  await f.controller.tick(); assert.equal(f.prompts().length, 2); assert.equal(f.controller.get(f.workspace.id, "ses_fixture").phase, "review");
  f.setMessages([assistant("msg_b", 'TASK_RESULT: {"status":"continue","evidence":"Falta cubrir el caso vacío"}')]);
  await f.controller.tick(); assert.equal(f.controller.get(f.workspace.id, "ses_fixture").phase, "work"); assert.equal(f.prompts().length, 3);
});

test("automatic continuity follows manual turns without an active goal and survives restart", async t => {
  const f = await fixture(t);
  await f.controller.watch(f.workspace, "ses_fixture");
  f.setMessages([assistant("msg_manual", "Resultado del trabajo manual")]); await f.controller.tick();
  assert.equal(f.prompts().length, 0); assert.match(f.controller.get(f.workspace.id, "ses_fixture").summary, /trabajo manual/);
  await f.restart(); assert.match(f.controller.get(f.workspace.id, "ses_fixture").summary, /trabajo manual/);
  const s = f.controller.get(f.workspace.id, "ses_fixture");
  await assert.rejects(f.controller.update(f.workspace, "ses_fixture", s.revision - 1, "start", goal), /objetivo cambió/);
});

test("worktree lifecycle retains dirty files and unmerged commits; code fingerprint ignores prose", async t => {
  const f = await fixture(t);
  const git = (...args: string[]) => execFileSync("git", ["-C", f.root, ...args], { encoding: "utf8" }).trim();
  git("init", "-q"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
  await writeFile(join(f.root, "README.md"), "fixture\n"); git("add", "README.md"); git("commit", "-qm", "fixture");
  assert.equal(await codeChangeFingerprint(f.root), null);
  await writeFile(join(f.root, "README.md"), "updated\n"); assert.equal(await codeChangeFingerprint(f.root), null);
  const onlyCode = await reviewGitWorkspace(f.root, { codeOnly: true });
  assert.deepEqual(onlyCode.status, []); assert.equal(onlyCode.diff, "");
  const head = git("rev-parse", "HEAD");
  const w = await createGitWorktree(f.root, join(f.root, "runtime"), head);
  assert.ok((await listGitWorktrees(f.root)).some(x => x.path === w.path));
  await writeFile(join(w.path, "new.ts"), "export const x=1;"); assert.ok(await codeChangeFingerprint(w.path));
  await assert.rejects(removeGitWorktree(f.root, w.path, head), /cambios/);
  execFileSync("git", ["-C", w.path, "add", "new.ts"]); execFileSync("git", ["-C", w.path, "commit", "-qm", "isolated"]);
  const newHead = execFileSync("git", ["-C", w.path, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  await assert.rejects(removeGitWorktree(f.root, w.path, newHead), /integrados/);
  await rm(join(f.root, "README.md")); git("restore", "README.md"); git("merge", "--ff-only", newHead);
  await removeGitWorktree(f.root, w.path, newHead);
  assert.ok(!(await listGitWorktrees(f.root)).some(x => x.path === w.path));
});

test("only an explicit terminal assistant verdict counts", () => {
  assert.equal(goalVerdict('texto TASK_RESULT: {"status":"complete","evidence":"x"} luego'), null);
  assert.equal(goalVerdict('TASK_RESULT: {"status":"complete","evidence":"x"} extra'), null);
  assert.equal(goalVerdict('TASK_RESULT: {"status":"complete","evidence":"x"}')?.status, "complete");
});


test("native code snapshots require review even when the agent already committed its changes", async t => {
  const f = await fixture(t);
  await f.controller.update(f.workspace, "ses_fixture", 0, "start", goal); await f.controller.tick();
  f.setMessages([{ ...assistant("msg_committed", 'TASK_RESULT: {"status":"complete","evidence":"Código confirmado y probado"}'), snapshot: { files: ["src/app.ts"] } }]);
  await f.controller.tick();
  assert.equal(f.controller.get(f.workspace.id, "ses_fixture").phase, "review");
  assert.equal(f.prompts().length, 2);
});

test("turns admitted while the feature is disabled never start goals or persist memory", async t => {
  const f = await fixture(t);
  process.env.DEN_FEATURE_TASK_CONTINUITY = "false";
  await f.controller.watch(f.workspace, "ses_fixture"); await f.controller.tick();
  assert.equal(f.controller.get(f.workspace.id, "ses_fixture").revision, 0); assert.equal(f.prompts().length, 0);
});


test("Stop cancels an in-flight automatic admission before it can send a prompt", async t => {
  const f = await fixture(t);
  let entered: () => void = () => {};
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  f.stallModel(async req => { entered(); await new Promise<void>((_resolve, reject) => req.signal.addEventListener("abort", () => reject(new Error("stopped")), { once: true })); });
  await f.controller.update(f.workspace, "ses_fixture", 0, "start", goal);
  const tick = f.controller.tick(); await waiting;
  await f.controller.forward(f.workspace, "/opencode2/api/session/ses_fixture/interrupt", new Request("http://localhost", { method: "POST" }), async () => new Response(null, { status: 204 }));
  await tick;
  assert.equal(f.prompts().length, 0); assert.equal(f.controller.get(f.workspace.id, "ses_fixture").status, "paused");
});


test("resuming after an interrupted native turn admits new work instead of re-pausing on the old outcome", async t => {
  const f = await fixture(t);
  f.setOutcome("interrupted");
  f.setMessages([{ ...assistant("msg_old", "Turno anterior detenido"), error: { name: "MessageAbortedError" } }]);
  await f.controller.update(f.workspace, "ses_fixture", 0, "start", goal);
  await f.controller.tick(); assert.equal(f.prompts().length, 1);
});


test("goal completion also accepts the readable result line shown in the conversation", () => {
  assert.deepEqual(goalVerdict("Trabajo terminado.\nEstado del objetivo: completo — node --test pasó 3/3"), { status: "complete", evidence: "node --test pasó 3/3" });
  assert.equal(goalVerdict("Estado del objetivo: completo — "), null);
});

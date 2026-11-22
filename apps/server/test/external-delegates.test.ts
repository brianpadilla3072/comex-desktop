import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import * as core from "../src/delegation/core.js";
import { acpUpdateEffect, mergeToolCall } from "../src/delegation/acp.js";
import { DelegationError, delegateRecipe, permissionPolicy } from "../src/delegation/schema.js";
import { DelegationService, type DelegationApprovals } from "../src/delegation/service.js";
import { delegatesMcpToken, delegationToolNames, handleDelegatesMcp } from "../src/delegation/mcp.js";

// Runs contracts/delegation/v1/vectors.json (docs/rust-readiness.md, R5) and
// exercises the delegation service against fake agent CLIs on this machine.

const vectorsPath = new URL("../../../contracts/delegation/v1/vectors.json", import.meta.url);
const vectors = z.object({
  version: z.literal(1),
  recipeProblems: z.array(z.object({ name: z.string(), recipe: z.unknown(), expect: z.array(z.string()) })),
  renderCommand: z.array(z.object({ name: z.string(), template: z.array(z.string()), values: z.object({ prompt: z.string().optional(), sessionId: z.string().optional() }), expect: z.array(z.string()) })),
  escapeCmdArgument: z.array(z.object({ arg: z.string(), doubleEscape: z.boolean(), expect: z.string() })),
  planSpawn: z.array(z.object({ name: z.string(), executable: z.string(), args: z.array(z.string()), platform: z.string(), comspec: z.string(), expect: z.object({ file: z.string(), args: z.array(z.string()), windowsVerbatimArguments: z.boolean() }) })),
  planSpawnErrors: z.array(z.object({ name: z.string(), executable: z.string(), args: z.array(z.string()), platform: z.string(), expectCode: z.string() })),
  executableCandidates: z.array(z.object({ name: z.string(), command: z.string(), env: z.object({ platform: z.string(), path: z.string(), pathExt: z.string().optional() }), expect: z.array(z.string()) })),
  readJsonl: z.array(z.object({ name: z.string(), stdout: z.string(), fields: z.object({ resultField: z.string().optional(), sessionIdField: z.string().optional() }), expect: z.object({ text: z.string().nullable(), sessionId: z.string().nullable(), events: z.number().int() }) })),
  screen: z.array(z.object({ name: z.string(), cols: z.number().int(), rows: z.number().int(), chunks: z.array(z.string()), expect: z.string() })),
  delegateEnvironment: z.array(z.object({ name: z.string(), parent: z.record(z.string(), z.string()), extra: z.record(z.string(), z.string()), expect: z.record(z.string(), z.string()) })),
  policies: z.record(z.string(), z.unknown()),
  classifyPermission: z.array(z.object({ name: z.string(), toolCall: z.unknown(), policy: z.string(), folder: z.string(), platform: z.string(), expectView: z.unknown(), expect: z.object({ decision: z.string(), reason: z.string() }) })),
  pickPermissionOption: z.array(z.object({ name: z.string(), options: z.array(z.object({ optionId: z.string(), kind: z.string(), name: z.string().optional() })), decision: z.enum(["allow", "allow_always", "reject"]), expect: z.string().nullable() })),
  normalizeCommand: z.array(z.object({ input: z.union([z.string(), z.array(z.string())]), expect: z.array(z.string()).optional(), expectCode: z.string().optional() })),
  jsonLines: z.object({ chunks: z.array(z.string()), expect: z.array(z.array(z.unknown())) }),
  acpUpdateEffect: z.array(z.object({ update: z.unknown(), expect: z.unknown() })),
  mergeToolCall: z.array(z.object({ name: z.string(), known: z.record(z.string(), z.unknown()).nullable(), next: z.unknown(), expect: z.record(z.string(), z.unknown()), expectDecision: z.string().optional() })),
}).parse(JSON.parse(await readFile(vectorsPath, "utf8")));

test("contract: recipe validation", () => {
  for (const vector of vectors.recipeProblems) {
    assert.deepEqual(core.recipeProblems(delegateRecipe.parse(vector.recipe)), vector.expect, vector.name);
  }
});

test("contract: argv rendering never builds a shell string", () => {
  for (const vector of vectors.renderCommand) assert.deepEqual(core.renderCommand(vector.template, vector.values), vector.expect, vector.name);
});

test("contract: Windows cmd.exe escaping and spawn plans", () => {
  for (const vector of vectors.escapeCmdArgument) assert.equal(core.escapeCmdArgument(vector.arg, vector.doubleEscape), vector.expect, vector.arg);
  for (const vector of vectors.planSpawn) assert.deepEqual(core.planSpawn(vector.executable, vector.args, vector.platform, vector.comspec), vector.expect, vector.name);
  for (const vector of vectors.planSpawnErrors) {
    assert.throws(() => core.planSpawn(vector.executable, vector.args, vector.platform), (error: unknown) => error instanceof DelegationError && error.code === vector.expectCode, vector.name);
  }
});

test("contract: executable lookup, JSON lines, terminal screen and environment", () => {
  for (const vector of vectors.executableCandidates) assert.deepEqual(core.executableCandidates(vector.command, vector.env), vector.expect, vector.name);
  for (const vector of vectors.readJsonl) assert.deepEqual(core.readJsonl(vector.stdout, vector.fields), vector.expect, vector.name);
  for (const vector of vectors.screen) {
    const screen = new core.TerminalScreen(vector.cols, vector.rows);
    for (const chunk of vector.chunks) screen.feed(chunk);
    assert.equal(screen.text(0), vector.expect, vector.name);
  }
  for (const vector of vectors.delegateEnvironment) assert.deepEqual(core.delegateEnvironment(vector.parent, vector.extra), vector.expect, vector.name);
});

test("contract: ACP permission routing, options, command strings, framing and updates", () => {
  for (const vector of vectors.classifyPermission) {
    const view = core.permissionRequestView(vector.toolCall);
    assert.deepEqual(view, vector.expectView, vector.name);
    assert.deepEqual(core.classifyPermission(view, permissionPolicy.parse(vectors.policies[vector.policy]), vector.folder, vector.platform), vector.expect, vector.name);
  }
  for (const vector of vectors.pickPermissionOption) assert.equal(core.pickPermissionOption(vector.options, vector.decision), vector.expect, vector.name);
  for (const vector of vectors.normalizeCommand) {
    if (vector.expectCode) assert.throws(() => core.normalizeCommand(vector.input), (error: unknown) => error instanceof DelegationError && error.code === vector.expectCode);
    else assert.deepEqual(core.normalizeCommand(vector.input), vector.expect);
  }
  const decoder = new core.JsonLineDecoder();
  assert.deepEqual(vectors.jsonLines.chunks.map((chunk) => decoder.push(chunk)), vectors.jsonLines.expect);
  for (const vector of vectors.acpUpdateEffect) assert.deepEqual(acpUpdateEffect(vector.update), vector.expect);
  for (const vector of vectors.mergeToolCall) {
    const merged = mergeToolCall(vector.known ?? undefined, vector.next);
    assert.deepEqual(merged, vector.expect, vector.name);
    if (vector.expectDecision) assert.equal(core.classifyPermission(core.permissionRequestView(merged), permissionPolicy.parse({}), "/work/task", "linux").decision, vector.expectDecision, vector.name);
  }
});

// ── Service against fake CLIs ─────────────────────────────────────────────

const FAKE_AGENT = `import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const prompt = args[args.indexOf("-p") + 1] ?? "";
if (args.includes("--help")) { console.log("usage: fake-agent -p <prompt> [--json]"); process.exit(0); }
writeFileSync("AGENT_NOTE.md", "done: " + prompt + "\\n");
if (args.includes("--json")) {
  console.log(JSON.stringify({ type: "system", session_id: "sess-1" }));
  console.log(JSON.stringify({ type: "result", result: "Created AGENT_NOTE.md for: " + prompt, session_id: "sess-1" }));
} else console.log("ok " + prompt);
`;

const FAKE_INTERACTIVE = `process.stdout.write("Name? ");
process.stdin.setEncoding("utf8");
process.stdin.once("data", (data) => {
  process.stdout.write("\\r\\nHello " + String(data).trim() + "!\\r\\nDONE\\r\\n");
  setTimeout(() => process.exit(0), 300);
});
`;

// A small ACP agent: edits a file (automatic), asks to run tests (the managing agent
// decides), asks for a network command when told to (the person decides), and takes follow-ups.
const FAKE_ACP = `import { writeFileSync } from "node:fs";
import { join } from "node:path";
let buffer = "";
let nextId = 100;
let cwd = process.cwd();
const waiting = new Map();
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
const say = (sessionId, text) => send({ method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } } });
const ask = (sessionId, toolCall) => new Promise((resolve) => {
  const id = nextId++;
  waiting.set(id, resolve);
  send({ id, method: "session/request_permission", params: { sessionId, toolCall, options: [
    { optionId: "yes", name: "Allow", kind: "allow_once" }, { optionId: "always", name: "Always", kind: "allow_always" }, { optionId: "no", name: "Reject", kind: "reject_once" } ] } });
});
const allowed = (response) => response?.outcome?.outcome === "selected" && response.outcome.optionId !== "no";
async function handle(message) {
  if (message.method === undefined && waiting.has(message.id)) { waiting.get(message.id)(message.result); waiting.delete(message.id); return; }
  const { id, method, params } = message;
  if (method === "initialize") return send({ id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } });
  if (method === "session/new") { cwd = params.cwd; return send({ id, result: { sessionId: "fake-session" } }); }
  if (method === "session/load") { cwd = params.cwd; return send({ id, result: null }); }
  if (method === "session/set_mode") return send({ id, result: null });
  if (method === "session/prompt") {
    const text = params.prompt.map((part) => part.text).join("");
    const sessionId = params.sessionId;
    if (text.startsWith("again")) { say(sessionId, "follow-up: " + text); return send({ id, result: { stopReason: "end_turn" } }); }
    if (text.startsWith("parallel")) {
      const [first, second] = await Promise.all([
        ask(sessionId, { toolCallId: "p1", title: "Run tests", kind: "execute", rawInput: { command: "python3 -m unittest" } }),
        ask(sessionId, { toolCallId: "p2", title: "Lint", kind: "execute", rawInput: { command: "make lint" } }),
      ]);
      say(sessionId, "both: " + (allowed(first) ? "allowed" : "rejected") + " " + (allowed(second) ? "allowed" : "rejected"));
      return send({ id, result: { stopReason: "end_turn" } });
    }
    say(sessionId, "Working on: " + text + "\\n");
    send({ method: "session/update", params: { sessionId, update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "Edit note.txt", kind: "edit", status: "pending" } } });
    if (allowed(await ask(sessionId, { toolCallId: "t1", title: "Edit note.txt", kind: "edit", locations: [{ path: join(cwd, "note.txt") }] }))) writeFileSync(join(cwd, "note.txt"), "note\\n");
    if (text.includes("network")) {
      // Like Devin: the details come in tool_call, the permission request carries only the id.
      send({ method: "session/update", params: { sessionId, update: { sessionUpdate: "tool_call", toolCallId: "t2", title: "Ran curl", kind: "execute", status: "pending", rawInput: { command: "curl https://example.com" } } } });
      const ok = allowed(await ask(sessionId, { toolCallId: "t2" }));
      say(sessionId, ok ? "network used" : "network blocked");
    } else {
      const ok = allowed(await ask(sessionId, { toolCallId: "t3", title: "Run tests", kind: "execute", rawInput: { command: "python3 -m pytest -q" } }));
      if (ok) writeFileSync(join(cwd, "ran.txt"), "ok\\n");
      say(sessionId, ok ? "tests ran" : "tests skipped");
    }
    return send({ id, result: { stopReason: "end_turn" } });
  }
  if (id !== undefined) send({ id, error: { code: -32601, message: "unknown" } });
}
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\\n")) >= 0) { const line = buffer.slice(0, index); buffer = buffer.slice(index + 1); if (line.trim()) void handle(JSON.parse(line)); }
});
`;

const FAKE_CONFIRM_TTY = `process.stdout.write("Working...\\r\\nApply changes? (y/n) ");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (data) => {
  if (String(data).trim().startsWith("y")) { process.stdout.write("\\r\\nApplied. DONE\\r\\n"); setTimeout(() => process.exit(0), 200); }
});
`;

const FAKE_STDIN_QUESTION = `process.stdout.write("Proceed with the plan?\\n");
process.stdin.setEncoding("utf8");
process.stdin.once("data", (data) => { process.stdout.write("answer: " + String(data).trim() + "\\n"); process.exit(0); });
`;

type Fixture = { root: string; runtimeDir: string; project: string; plainDir: string; agent: string; interactive: string; acp: string; confirmTty: string; stdinQuestion: string };

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "openwork-delegates-test-"));
  const runtimeDir = join(root, "runtime");
  const project = join(root, "project");
  const plainDir = join(root, "plain");
  await mkdir(project, { recursive: true });
  await mkdir(plainDir, { recursive: true });
  const agent = join(root, "fake-agent.mjs");
  const interactive = join(root, "fake-interactive.mjs");
  await writeFile(agent, FAKE_AGENT);
  await writeFile(interactive, FAKE_INTERACTIVE);
  const acp = join(root, "fake-acp.mjs");
  const confirmTty = join(root, "fake-confirm-tty.mjs");
  const stdinQuestion = join(root, "fake-stdin-question.mjs");
  await writeFile(acp, FAKE_ACP);
  await writeFile(confirmTty, FAKE_CONFIRM_TTY);
  await writeFile(stdinQuestion, FAKE_STDIN_QUESTION);
  await writeFile(join(project, "README.md"), "# demo\n");
  const git = (...args: string[]) => spawnSync("git", args, { cwd: project, encoding: "utf8" });
  git("init", "-q");
  git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "init");
  return { root, runtimeDir, project, plainDir, agent, interactive, acp, confirmTty, stdinQuestion };
}

function service(f: Fixture, allow: boolean | ((action: string) => boolean) = true, env: Record<string, string | undefined> = process.env, extra: Partial<ConstructorParameters<typeof DelegationService>[0]> = {}) {
  const asked: string[] = [];
  const approvals: DelegationApprovals = { async confirm(input) { asked.push(`${input.action}:${input.title}`); return { allowed: typeof allow === "function" ? allow(input.action) : allow }; } };
  const svc = new DelegationService({
    runtimeDir: f.runtimeDir,
    workspacePath: (id) => (id === "ws-git" ? f.project : id === "ws-plain" ? f.plainDir : null),
    approvals,
    env,
    ...extra,
  });
  return { svc, asked };
}

// The fake CLIs are Node scripts; under Bun's test runner run them with Node too.
const node = process.versions.bun ? "node" : process.execPath;

test("probe runs once in a scratch folder, asks once per program, and hides OpenWork credentials", async () => {
  const f = await fixture();
  const { svc, asked } = service(f, true, { ...process.env, OPENWORK_SERVER_TOKEN: "secret-token" });
  try {
    const help = await svc.probe("ws-git", { command: [node, f.agent, "--help"] });
    assert.equal(help.exitCode, 0);
    assert.match(help.stdout, /usage: fake-agent/);
    const env = await svc.probe("ws-git", { command: [node, "-e", "console.log(process.env.OPENWORK_SERVER_TOKEN ?? 'absent')"] });
    assert.equal(env.stdout.trim(), "absent");
    assert.equal(asked.length, 1, "one approval per program for the server's lifetime");
    assert.equal(existsSync(join(f.project, "AGENT_NOTE.md")), false, "probe never runs in the project by default");
  } finally {
    svc.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test("a denied approval stops discovery and registration", async () => {
  const f = await fixture();
  const { svc } = service(f, false);
  try {
    await assert.rejects(svc.probe("ws-git", { command: [node, "--version"] }), (error: unknown) => error instanceof DelegationError && error.code === "delegate_approval_denied");
    await assert.rejects(svc.register("ws-git", { name: "fake", kind: "cli", command: [node, f.agent, "-p", "{prompt}"] }), (error: unknown) => error instanceof DelegationError && error.code === "delegate_approval_denied");
    assert.deepEqual(await svc.list(), []);
  } finally {
    svc.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test("register rejects an invalid recipe and a missing program", async () => {
  const f = await fixture();
  const { svc } = service(f);
  try {
    await assert.rejects(svc.register("ws-git", { name: "fake", kind: "cli", command: [node, f.agent, "-p"] }), (error: unknown) => error instanceof DelegationError && error.code === "delegate_invalid_recipe");
    await assert.rejects(svc.register("ws-git", { name: "ghost", kind: "cli", command: ["openwork-no-such-agent-cli", "{prompt}"] }), (error: unknown) => error instanceof DelegationError && error.code === "delegate_executable_not_found");
  } finally {
    svc.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test("a registered cli agent works in an isolated worktree and reports its answer, session and changes", async () => {
  const f = await fixture();
  const { svc } = service(f);
  try {
    await svc.register("ws-git", {
      name: "fake",
      kind: "cli",
      command: [node, f.agent, "-p", "{prompt}", "--json"],
      output: "jsonl",
      versionCommand: [node, "--version"],
      notes: ["test agent"],
    });
    const listed = await svc.list();
    assert.equal(listed[0]?.name, "fake");
    assert.equal(listed[0]?.status, "ready");
    assert.ok(listed[0]?.version, "the version command output is recorded");

    const started = await svc.start("ws-git", { agent: "fake", prompt: "write a note" });
    assert.equal(started.isolation, "worktree");
    const result = await svc.result(started.taskId, 30);
    assert.equal(result.done, true);
    assert.equal(result.state, "succeeded");
    assert.equal("answer" in result ? result.answer : null, "Created AGENT_NOTE.md for: write a note");
    assert.equal(result.sessionId, "sess-1");
    assert.ok("changedFiles" in result && result.changedFiles?.some((line) => line.includes("AGENT_NOTE.md")));
    assert.equal(existsSync(join(f.project, "AGENT_NOTE.md")), false, "the project itself is untouched");
    assert.ok(result.worktreePath && existsSync(join(result.worktreePath, "AGENT_NOTE.md")));

    const discarded = await svc.discard(started.taskId);
    assert.equal(discarded.discarded, true);
    assert.equal(existsSync(result.worktreePath), false);
    const branches = spawnSync("git", ["branch", "--list", "openwork-delegate/*"], { cwd: f.project, encoding: "utf8" }).stdout.trim();
    assert.equal(branches, "");
  } finally {
    svc.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test("outside git a worktree is refused unless the task runs in the workspace", async () => {
  const f = await fixture();
  const { svc } = service(f);
  try {
    await svc.register("ws-plain", { name: "fake", kind: "cli", command: [node, f.agent, "-p", "{prompt}"] });
    await assert.rejects(svc.start("ws-plain", { agent: "fake", prompt: "x" }), (error: unknown) => error instanceof DelegationError && error.code === "delegate_worktree_unavailable");
    const started = await svc.start("ws-plain", { agent: "fake", prompt: "direct", isolation: "workspace" });
    const result = await svc.result(started.taskId, 30);
    assert.equal(result.state, "succeeded");
    assert.equal("answer" in result ? result.answer : null, "ok direct");
    assert.equal(await readFile(join(f.plainDir, "AGENT_NOTE.md"), "utf8"), "done: direct\n");
    await assert.rejects(svc.start("ws-plain", { agent: "nobody", prompt: "x" }), (error: unknown) => error instanceof DelegationError && error.code === "delegate_not_found");
  } finally {
    svc.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test("cancel stops a long run", async () => {
  const f = await fixture();
  const { svc } = service(f);
  try {
    const sleeper = join(f.root, "sleeper.mjs");
    await writeFile(sleeper, "setTimeout(() => {}, 60000);\n");
    await svc.register("ws-plain", { name: "slow", kind: "cli", command: [node, sleeper, "{prompt}"], isolation: "workspace" });
    const started = await svc.start("ws-plain", { agent: "slow", prompt: "wait" });
    const cancelled = svc.cancel(started.taskId);
    assert.equal(cancelled.state, "cancelled");
    const result = await svc.result(started.taskId, 0);
    assert.equal(result.state, "cancelled");
  } finally {
    svc.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

const hasScript = process.platform !== "win32" && spawnSync("script", ["--version"], { encoding: "utf8" }).error === undefined;

test("terminals drive an interactive program (script fallback without the desktop's node-pty)", { skip: !hasScript && "needs the script utility", timeout: 120_000 }, async () => {
  const f = await fixture();
  const { svc } = service(f);
  try {
    const opened = await svc.termOpen("ws-plain", { command: [node, f.interactive] });
    const ready = await svc.termWait(opened.terminalId, { text: "Name?", timeoutSeconds: 15 });
    assert.equal(ready.reason, "text");
    await svc.termSend(opened.terminalId, { text: "Ana", keys: ["enter"] });
    const done = await svc.termWait(opened.terminalId, { text: "DONE", timeoutSeconds: 15 });
    assert.equal(done.reason, "text");
    assert.match("screen" in done ? done.screen ?? "" : "", /Hello Ana!/);
    assert.equal(svc.closeTerminal(opened.terminalId).closed, true);
    assert.throws(() => svc.termRead(opened.terminalId), (error: unknown) => error instanceof DelegationError && error.code === "delegate_terminal_not_found");

    await svc.register("ws-plain", { name: "chat", kind: "pty", command: [node, f.interactive], prompt: "stdin", readyText: "Name?", doneText: "DONE", isolation: "workspace" });
    const task = await svc.start("ws-plain", { agent: "chat", prompt: "Luis" });
    assert.ok(task.terminalId);
    const result = await svc.result(task.taskId, 30);
    assert.equal(result.state, "succeeded");
    assert.match("answer" in result ? result.answer : "", /Hello Luis!/);
  } finally {
    svc.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test("the MCP endpoint requires its workspace token and lists the delegation tools", async () => {
  const f = await fixture();
  const { svc } = service(f);
  const owner = {};
  const port = 8123;
  const call = (body: unknown, token?: string) => handleDelegatesMcp({
    owner,
    service: svc,
    workspaceId: "ws-plain",
    port,
    request: new Request(`http://127.0.0.1:${port}/mcp/delegates/ws-plain`, {
      method: "POST",
      headers: {
        host: `127.0.0.1:${port}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  });
  try {
    assert.equal((await call({ jsonrpc: "2.0", id: 1, method: "tools/list" })).status, 401);
    assert.equal((await call({ jsonrpc: "2.0", id: 1, method: "tools/list" }, delegatesMcpToken(owner, "ws-git"))).status, 401, "a token is valid for one workspace only");
    const token = delegatesMcpToken(owner, "ws-plain");
    const listed = await call({ jsonrpc: "2.0", id: 1, method: "tools/list" }, token);
    assert.equal(listed.status, 200);
    const tools = z.object({ result: z.object({ tools: z.array(z.object({ name: z.string(), inputSchema: z.object({ type: z.literal("object") }).passthrough() })) }) }).parse(await listed.json());
    assert.deepEqual(tools.result.tools.map((tool) => tool.name).sort(), delegationToolNames().sort());
    const guide = await call({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "delegate_guide", arguments: {} } }, token);
    assert.match(await guide.text(), /Learn and use an external agent CLI/);
    const failed = await call({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "delegate_start", arguments: { agent: "nobody", prompt: "x" } } }, token);
    const payload = z.object({ result: z.object({ isError: z.literal(true), content: z.array(z.object({ text: z.string() })) }) }).parse(await failed.json());
    assert.equal(z.object({ error: z.string() }).parse(JSON.parse(payload.result.content[0]?.text ?? "{}")).error, "delegate_not_found");
    const disabled = await handleDelegatesMcp({ owner, service: null, workspaceId: "ws-plain", port, request: new Request(`http://127.0.0.1:${port}/mcp/delegates/ws-plain`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: "{}" }) });
    assert.equal(disabled.status, 503);
  } finally {
    svc.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test("ACP: edits are automatic, the managing agent decides the test run, and follow-ups reuse the session", async () => {
  const f = await fixture();
  const { svc } = service(f);
  try {
    await svc.register("ws-git", { name: "acp-agent", kind: "acp", command: [node, f.acp], acpMode: "code" });
    const started = await svc.start("ws-git", { agent: "acp-agent", prompt: "fix the bug" });
    const waiting = await svc.result(started.taskId, 20);
    assert.equal(waiting.state, "needs_input");
    assert.equal(waiting.pendingInput?.type, "permission");
    assert.equal(waiting.pendingInput?.type === "permission" ? waiting.pendingInput.command : null, "python3 -m pytest -q");
    assert.ok(waiting.activity.some((line) => line.startsWith("allowed automatically")), "editing inside the task folder needs nobody");
    await assert.rejects(svc.reply(started.taskId, { text: "hello" }), (error: unknown) => error instanceof DelegationError && error.code === "delegate_not_waiting");

    await svc.reply(started.taskId, { decision: "allow" });
    const done = await svc.result(started.taskId, 20);
    assert.equal(done.state, "succeeded");
    assert.match("answer" in done ? done.answer : "", /tests ran/);
    assert.equal(done.sessionId, "fake-session");
    assert.ok("changedFiles" in done && done.changedFiles?.some((line) => line.includes("ran.txt")) && done.changedFiles.some((line) => line.includes("note.txt")));
    assert.equal(done.canReply, true);

    await svc.reply(started.taskId, { text: "again please" });
    const followUp = await svc.result(started.taskId, 20);
    assert.equal(followUp.state, "succeeded");
    assert.equal("answer" in followUp ? followUp.answer : "", "follow-up: again please");
    await svc.discard(started.taskId);
  } finally {
    svc.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test("ACP: a risky command goes to the person, and a reject reaches the agent", async () => {
  const f = await fixture();
  const { svc, asked } = service(f, (action) => action !== "permission");
  try {
    await svc.register("ws-plain", { name: "acp-agent", kind: "acp", command: [node, f.acp], isolation: "workspace" });
    const started = await svc.start("ws-plain", { agent: "acp-agent", prompt: "use the network" });
    const done = await svc.result(started.taskId, 20);
    assert.equal(done.state, "succeeded");
    assert.match("answer" in done ? done.answer : "", /network blocked/);
    assert.ok(asked.some((entry) => entry.startsWith("permission:")), "the person was asked");
    assert.ok(done.activity.some((line) => line.startsWith("rejected by the person")));
  } finally {
    svc.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test("ACP: ask_person escalates an agent decision, and a handshake failure is reported", async () => {
  const f = await fixture();
  const { svc, asked } = service(f, (action) => action !== "permission");
  try {
    await svc.register("ws-plain", { name: "acp-agent", kind: "acp", command: [node, f.acp], isolation: "workspace" });
    const started = await svc.start("ws-plain", { agent: "acp-agent", prompt: "fix" });
    assert.equal((await svc.result(started.taskId, 20)).state, "needs_input");
    await svc.reply(started.taskId, { decision: "ask_person" });
    const done = await svc.result(started.taskId, 20);
    assert.match("answer" in done ? done.answer : "", /tests skipped/);
    assert.ok(asked.some((entry) => entry.startsWith("permission:")));

    await svc.register("ws-plain", { name: "not-acp", kind: "acp", command: [node, "-e", "process.exit(3)"], isolation: "workspace" });
    const broken = await svc.start("ws-plain", { agent: "not-acp", prompt: "x" });
    const failed = await svc.result(broken.taskId, 20);
    assert.equal(failed.state, "failed");
    assert.ok(failed.error);
  } finally {
    svc.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test("terminal tasks report a waiting prompt as needs_input and take the answer", { skip: !hasScript && "needs the script utility", timeout: 120_000 }, async () => {
  const f = await fixture();
  const { svc } = service(f);
  try {
    await svc.register("ws-plain", { name: "confirm", kind: "pty", command: [node, f.confirmTty], prompt: "stdin", doneText: "DONE", idleSeconds: 5, isolation: "workspace" });
    const started = await svc.start("ws-plain", { agent: "confirm", prompt: "go" });
    let state = await svc.result(started.taskId, 30);
    for (let attempt = 0; attempt < 3 && state.state === "running"; attempt += 1) state = await svc.result(started.taskId, 30);
    assert.equal(state.state, "needs_input");
    assert.equal(state.pendingInput?.type, "question");
    assert.match(state.pendingInput?.type === "question" ? state.pendingInput.text : "", /Apply changes\?/);
    await svc.reply(started.taskId, { text: "y" });
    const done = await svc.result(started.taskId, 30);
    assert.equal(done.state, "succeeded");
    assert.match("answer" in done ? done.answer : "", /Applied/);
  } finally {
    svc.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test("a cli that keeps stdin open can be answered; plain strings work as commands", { timeout: 120_000 }, async () => {
  const f = await fixture();
  const { svc } = service(f);
  try {
    await svc.register("ws-plain", { name: "asker", kind: "cli", command: [node, f.stdinQuestion, "{prompt}"], keepStdinOpen: true, idleSeconds: 5, isolation: "workspace" });
    const started = await svc.start("ws-plain", { agent: "asker", prompt: "x" });
    let state = await svc.result(started.taskId, 30);
    for (let attempt = 0; attempt < 3 && state.state === "running"; attempt += 1) state = await svc.result(started.taskId, 30);
    assert.equal(state.state, "needs_input");
    await svc.reply(started.taskId, { text: "yes" });
    const done = await svc.result(started.taskId, 20);
    assert.equal(done.state, "succeeded");
    assert.match("answer" in done ? done.answer : "", /answer: yes/);

    const probed = await svc.probe("ws-plain", { command: `${node} --version` });
    assert.equal(probed.exitCode, 0);
    await assert.rejects(svc.probe("ws-plain", { command: `${node} -e "x"` }), (error: unknown) => error instanceof DelegationError && error.code === "delegate_argument_unsafe");
  } finally {
    svc.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test("without a native dialog, automatic approvals never allow a risky permission", async () => {
  const { delegationApprovals } = await import("../src/delegation/runtime.js");
  const auto = { requestApproval: async () => ({ id: "auto", allowed: true }) };
  const approvals = delegationApprovals({ workspaces: [] } as unknown as Parameters<typeof delegationApprovals>[0], auto);
  assert.equal((await approvals.confirm({ workspaceId: "w", action: "permission", title: "t", detail: "d" })).allowed, false);
  assert.equal((await approvals.confirm({ workspaceId: "w", action: "register", title: "t", detail: "d" })).allowed, true);
  const native = delegationApprovals({ workspaces: [], delegationApproval: async () => true } as unknown as Parameters<typeof delegationApprovals>[0], auto);
  assert.equal((await native.confirm({ workspaceId: "w", action: "permission", title: "t", detail: "d" })).allowed, true);
});

test("a program is approved once and remembered across restarts; registering it asks nothing more", async () => {
  const f = await fixture();
  const first = service(f);
  try {
    await first.svc.probe("ws-plain", { command: [node, "--version"] });
    assert.equal(first.asked.length, 1);
  } finally {
    first.svc.close();
  }
  const second = service(f);
  try {
    await second.svc.probe("ws-plain", { command: [node, "--version"] });
    await second.svc.register("ws-plain", { name: "fake", kind: "cli", command: [node, f.agent, "-p", "{prompt}"], isolation: "workspace" });
    assert.deepEqual(second.asked, [], "the remembered approval covers discovery and registration");
  } finally {
    second.svc.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test("with the orchestrator deciding, nobody is asked and risky requests reach the agent with their reason", async () => {
  const f = await fixture();
  const { svc, asked } = service(f, false, process.env, { deciderOverride: "orchestrator" });
  try {
    await svc.probe("ws-plain", { command: [node, "--version"] });
    await svc.register("ws-plain", { name: "acp-agent", kind: "acp", command: [node, f.acp], isolation: "workspace" });
    const started = await svc.start("ws-plain", { agent: "acp-agent", prompt: "use the network" });
    const waiting = await svc.result(started.taskId, 20);
    assert.equal(waiting.state, "needs_input");
    assert.equal(waiting.pendingInput?.type === "permission" ? waiting.pendingInput.reason : null, "risky_command");
    assert.match(waiting.hint ?? "", /sensitive/);
    await svc.reply(started.taskId, { decision: "reject" });
    const done = await svc.result(started.taskId, 20);
    assert.match("answer" in done ? done.answer : "", /network blocked/);
    assert.deepEqual(asked, [], "no dialog at all");
    assert.deepEqual(await svc.settings(), { decider: "orchestrator", overriddenBy: "environment" });
  } finally {
    svc.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test("the stored decider is changed only through settings, and the environment lock is parsed strictly", async () => {
  const f = await fixture();
  const { svc, asked } = service(f, false);
  try {
    assert.deepEqual(await svc.settings(), { decider: "person", overriddenBy: null });
    await svc.updateSettings({ decider: "orchestrator" });
    await svc.probe("ws-plain", { command: [node, "--version"] });
    assert.deepEqual(asked, []);
    const { deciderFromEnvironment } = await import("../src/delegation/runtime.js");
    assert.equal(deciderFromEnvironment({ OPENWORK_DELEGATES_DECIDER: "orchestrator" }), "orchestrator");
    assert.equal(deciderFromEnvironment({ OPENWORK_DELEGATES_DECIDER: "everyone" }), undefined);
    assert.equal(deciderFromEnvironment({}), undefined);
  } finally {
    svc.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test("ACP: parallel permission requests are queued and each one is answered", async () => {
  const f = await fixture();
  const { svc } = service(f);
  try {
    await svc.register("ws-plain", { name: "acp-agent", kind: "acp", command: [node, f.acp], isolation: "workspace" });
    const started = await svc.start("ws-plain", { agent: "acp-agent", prompt: "parallel work" });
    let state = await svc.result(started.taskId, 20);
    for (let attempt = 0; attempt < 10 && state.queuedPermissions === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      state = svc.status("ws-plain", started.taskId).tasks[0] ?? state;
    }
    assert.equal(state.state, "needs_input");
    assert.equal(state.queuedPermissions, 1);
    assert.equal(state.pendingInput?.type === "permission" ? state.pendingInput.command : null, "python3 -m unittest");
    const second = await svc.reply(started.taskId, { decision: "allow" });
    assert.equal(second.state, "needs_input", "the queued request shows next");
    assert.equal(second.pendingInput?.type === "permission" ? second.pendingInput.command : null, "make lint");
    await svc.reply(started.taskId, { decision: "reject" });
    const done = await svc.result(started.taskId, 20);
    assert.equal(done.state, "succeeded");
    assert.equal("answer" in done ? done.answer : "", "both: allowed rejected");
  } finally {
    svc.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test("ACP: resuming a session keeps working in the same worktree", async () => {
  const f = await fixture();
  const { svc } = service(f);
  try {
    await svc.register("ws-git", { name: "acp-agent", kind: "acp", command: [node, f.acp] });
    const first = await svc.start("ws-git", { agent: "acp-agent", prompt: "fix" });
    await svc.result(first.taskId, 20);
    await svc.reply(first.taskId, { decision: "allow" });
    const done = await svc.result(first.taskId, 20);
    assert.ok(done.worktreePath && existsSync(join(done.worktreePath, "note.txt")));
    await assert.rejects(svc.start("ws-git", { agent: "acp-agent", prompt: "again", sessionId: "fake-session" }), (error: unknown) => error instanceof DelegationError && error.code === "delegate_not_waiting");
    svc.cancel(first.taskId);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const resumed = await svc.start("ws-git", { agent: "acp-agent", prompt: "again later", sessionId: "fake-session" });
    assert.equal(resumed.worktreePath, done.worktreePath, "same isolated copy");
    const answer = await svc.result(resumed.taskId, 20);
    assert.equal("answer" in answer ? answer.answer : "", "follow-up: again later");
    assert.ok(existsSync(join(done.worktreePath, "note.txt")), "earlier changes are still there");
    await svc.discard(first.taskId);
    assert.ok(existsSync(done.worktreePath), "discarding the earlier task leaves the copy the resumed task owns");
    await svc.discard(resumed.taskId);
    assert.equal(existsSync(done.worktreePath), false);
  } finally {
    svc.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

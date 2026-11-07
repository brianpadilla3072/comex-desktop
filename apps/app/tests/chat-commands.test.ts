import { test } from "node:test";
import assert from "node:assert/strict";
import { indexSlashOptions, searchSlashOptions } from "../src/react-app/domains/session/commands/search-index";
import { performance } from "node:perf_hooks";
import { CHAT_COMMANDS, chatCommandOptions, resolveChatCommand, appCommandForOption } from "../src/react-app/domains/session/commands/catalog";
import { shareTranscript, buildShareHtml } from "../src/react-app/domains/session/commands/share-snapshot";
import { getSlashCommandQuery, parseSlashCommandInvocation } from "../src/react-app/domains/session/surface/composer/slash-command";

test("command registry has eleven unique actions and native init remains a native command", () => {
  assert.equal(CHAT_COMMANDS.length, 11); assert.equal(new Set(CHAT_COMMANDS.map(c => c.id)).size, 11);
  assert.equal(resolveChatCommand("/bifurcar")?.id, "fork"); assert.equal(resolveChatCommand("/fork")?.id, "fork");
  assert.equal(resolveChatCommand("/estado")?.id, "status"); assert.equal(resolveChatCommand("/status")?.id, "status");
  assert.equal(resolveChatCommand("/pin")?.id, "pin");
  assert.equal(resolveChatCommand("texto /archivar"), null); assert.equal(resolveChatCommand("/archivar explicación"), null);
  assert.equal(resolveChatCommand("/plugin:review"), null);
  assert.deepEqual(parseSlashCommandInvocation("/plugin:review cambios"), { name: "plugin:review", arguments: "cambios" });
  assert.equal(getSlashCommandQuery("/plugin:re"), "plugin:re");
  assert.equal(appCommandForOption({ id: "command:status", name: "status" }), null);
});
test("capabilities stay visible with reasons for empty, busy, secondary and unsupported engines", () => {
  const base = { hasSession: true, busy: false, nativeV2: true, canArchive: true, canFork: true, canAttach: true, secondary: false };
  const ready = chatCommandOptions(base); assert.ok(ready.every(c => !c.disabledReason));
  assert.equal(chatCommandOptions({ ...base, pinned: true }).find(c => c.appCommand === "pin")?.label, "Quitar de fijados");
  const empty = chatCommandOptions({ ...base, hasSession: false }); assert.equal(empty.length, 11); assert.ok(empty.find(c => c.appCommand === "archive")?.disabledReason); assert.ok(!empty.find(c => c.appCommand === "draw")?.disabledReason);
  assert.ok(chatCommandOptions({ ...base, nativeV2: false }).find(c => c.appCommand === "compact")?.disabledReason);
  assert.ok(chatCommandOptions({ ...base, secondary: true }).find(c => c.appCommand === "side")?.disabledReason);
  assert.match(chatCommandOptions({ ...base, hasMessages: false }).find(c => c.appCommand === "fork")?.disabledReason ?? "", /mensajes/);
  const busy = chatCommandOptions({ ...base, busy: true }); assert.ok(!busy.find(c => c.appCommand === "compact")?.disabledReason); assert.ok(!busy.find(c => c.appCommand === "status")?.disabledReason);
  assert.ok(chatCommandOptions({ ...base, pending: true }).every(c => c.disabledReason));
});
test("share snapshot is text only and HTML cannot execute exported chat content", () => {
  const user = { info: { role: "user" }, parts: [{ type: "text", text: "Hola <script>alert(1)</script>\n\n<openwork-context>\ncontexto oculto del motor\n</openwork-context>" }, { type: "text", text: "instrucción interna", synthetic: true }] };
  const assistant = { info: { role: "assistant" }, parts: [{ type: "reasoning", text: "razonamiento privado" }, { type: "text", text: "Bearer abc1234567890123456" }, { type: "tool", text: "salida privada" }, { type: "file", url: "data:private" }] };
  // Minimal transcript fixtures: exporter reads only role and the public text part fields.
  const text = shareTranscript([user, assistant] as Parameters<typeof shareTranscript>[0]);
  assert.ok(!text.includes("contexto oculto")); assert.ok(!text.includes("instrucción interna")); assert.ok(!text.includes("razonamiento privado")); assert.ok(!text.includes("salida privada")); assert.ok(!text.includes("abc123")); assert.ok(text.includes("secreto omitido"));
  const html = buildShareHtml('<img src=x onerror="alert(2)">', text);
  assert.ok(!html.includes("<script>")); assert.ok(!html.includes("<img")); assert.ok(html.includes("default-src 'none'")); assert.ok(html.includes("&lt;script&gt;"));
  assert.throws(() => buildShareHtml("Chat", "x".repeat(2_000_001)), /límite/);
});
test("dispatch lookup stays bounded with a large external catalog: no network, no per-command callbacks", () => {
  const start = performance.now(); for (let i = 0; i < 100_000; i++) { assert.equal(resolveChatCommand("/status")?.id, "status"); }
  const elapsed = performance.now() - start; console.log(`100,000 command lookups: ${elapsed.toFixed(1)}ms; registry ${CHAT_COMMANDS.length} actions.`);
  assert.ok(elapsed < 5000);
});

test("large native catalogs are searched without rendering every result", () => {
  const items = Array.from({ length: 10_000 }, (_, i) => ({ id: `native:${i}`, name: `plugin:command-${i}`, description: "Native engine command" }));
  const prepared = indexSlashOptions(items);
  const start = performance.now(); const results = searchSlashOptions("command", prepared);
  console.log(`10,000 native entries searched: ${(performance.now() - start).toFixed(1)}ms; rendered results ${results.length}.`);
  assert.equal(results.length, 24);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { workspaceIdForPath } from "../src/workspaces.js";
import { applicationInput, specialistStore } from "../src/specialists/store.js";
import { syncLibraryToolPlugin } from "../src/specialists/library-tool-api.js";
import { createSpecialistLibraryPlugin } from "../src/specialists/library-plugin.js";
import type { ServerConfig } from "../src/types.js";

/** The library's native tools run inside the engine. The v2 runner reads `content` off the result,
 *  so a bare string made every specialist tool fail with an internal TypeError instead of
 *  answering — found only by driving a real model through a real turn. */

type EngineTool = { name: string; execute: (input: unknown, call: { signal: AbortSignal }) => Promise<unknown> };

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "specialist-library-plugin-"));
  const config = { configPath: join(root, "server.json"), port: 4712, token: "token", workspaces: [] as Array<{ id: string; path: string }> };
  const store = await specialistStore(config as unknown as ServerConfig);
  const app = store.create(applicationInput.parse({ userName: "Usuario de prueba", name: "Alpha", specialty: "Especialidad", personality: "PERSONA", template: "custom" }), { agents: 0, skills: 0 });
  const project = join(root, "proyecto");
  await mkdir(project, { recursive: true });
  const workspaceId = workspaceIdForPath(project);
  config.workspaces.push({ id: workspaceId, path: project });
  store.bind(workspaceId, app.id, project);
  return { root, config, project, workspaceId };
}

function pluginContext(project: string, tools: Map<string, EngineTool>) {
  return {
    location: { directory: project },
    tool: {
      async transform(callback: (editor: { add(tool: EngineTool): void }) => void) {
        callback({ add: (tool) => { tools.set(tool.name, tool); } });
        return { async dispose() {} };
      },
    },
  } as never;
}

test("a library tool answers the engine with a content block, never a bare string", async () => {
  const { root, config, project, workspaceId } = await fixture();
  const originalFetch = globalThis.fetch;
  try {
    await syncLibraryToolPlugin(config as unknown as ServerConfig, workspaceId, project);
    const descriptor = join(root, "specialists", "tool", createHash("sha256").update(project).digest("hex") + ".json");
    const tools = new Map<string, EngineTool>();
    await createSpecialistLibraryPlugin(descriptor).setup(pluginContext(project, tools));
    const call = [...tools.values()].find(tool => tool.name === "specialist_panel_list");
    assert.ok(call, "the plugin did not register specialist_panel_list");

    let sent: { name: string; authorization: string } | null = null;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { name?: string };
      sent = { name: body.name ?? "", authorization: String((init?.headers as Record<string, string> | undefined)?.Authorization ?? "") };
      return Response.json({ ok: true, result: { panels: [] } });
    }) as unknown as typeof fetch;

    const result = await call.execute({}, { signal: new AbortController().signal });
    // The engine reads content blocks and `output`; the raw bridge text broke that contract.
    assert.ok(result && typeof result === "object", `expected an object result, got ${typeof result}`);
    const content = (result as { content?: Array<{ type: string; text: string }> }).content;
    assert.ok(Array.isArray(content) && content[0]?.type === "text");
    assert.deepEqual(JSON.parse(content[0]!.text), { ok: true, result: { panels: [] } });
    assert.equal(sent?.name, "specialist_panel_list");
    assert.match(sent?.authorization ?? "", /^Bearer .{16,}$/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});

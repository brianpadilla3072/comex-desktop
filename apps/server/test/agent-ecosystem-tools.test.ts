import { test } from "node:test";
import assert from "node:assert/strict";
import ecosystemPlugin from "../src/opencode-plugins/openwork-ecosystem-v2.ts";

type Tool = { name: string; input: unknown; execute: (input: unknown, call: unknown) => Promise<unknown> };

function setup(flag: string | undefined) {
  if (flag === undefined) delete process.env.DEN_FEATURE_AGENT_ECOSYSTEM;
  else process.env.DEN_FEATURE_AGENT_ECOSYSTEM = flag;
  const tools: Tool[] = [];
  const added: string[] = [];
  const context = {
    options: { url: "http://127.0.0.1:9999", token: "t" },
    env: process.env,
    tool: {
      transform: async (cb: (editor: { add(tool: Tool): void }) => void) => {
        cb({ add: (tool: Tool) => { tools.push(tool); added.push(tool.name); } });
        return { dispose: async () => undefined };
      },
    },
  };
  return { context, tools, added };
}

test("agent ecosystem plugin exposes tools only when the feature flag is on", async () => {
  const off = setup("false");
  await ecosystemPlugin.setup(off.context as never);
  assert.deepEqual(off.added, []);

  const on = setup("true");
  await ecosystemPlugin.setup(on.context as never);
  assert.deepEqual(on.added.sort(), [
    "ecosystem_board", "ecosystem_claim", "ecosystem_halt", "ecosystem_index",
    "ecosystem_publish", "ecosystem_resolve", "ecosystem_state",
  ]);
  for (const tool of on.tools) {
    assert.ok((tool.input as { properties: Record<string, unknown> }).properties.workspaceId, `${tool.name} requires workspaceId`);
    assert.equal(typeof tool.execute, "function");
  }
});

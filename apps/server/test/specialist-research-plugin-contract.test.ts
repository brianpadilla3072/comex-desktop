import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createResearchPlugin } from "../src/specialists/integrations/native-plugin.js";

/** The Tavily tools run inside the engine, and the v2 runner reads content blocks off the
 *  result. Returning the raw payload made every search look empty to the model ("undefined"). */

type EngineTool = { name: string; execute: (input: unknown, call: { signal: AbortSignal }) => Promise<unknown> };

test("a research tool answers the engine with a content block and the saved search payload", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "specialist-research-plugin-"));
  const original = { datasets: process.env.DEN_FEATURE_SPECIALIST_DATASETS, sources: process.env.DEN_FEATURE_SPECIALIST_SOURCES };
  process.env.DEN_FEATURE_SPECIALIST_DATASETS = "false";
  process.env.DEN_FEATURE_SPECIALIST_SOURCES = "false";
  try {
    const project = await realpath(root);
    // A stand-in for the Tavily CLI: it only has to write the JSON response the adapter reads.
    const cli = join(root, "tvly");
    await writeFile(cli, `#!/bin/sh
out=""
while [ $# -gt 0 ]; do if [ "$1" = "-o" ]; then out="$2"; shift 2; else shift; fi; done
if [ -n "$out" ]; then printf '%s' '{"query":"precio soja","results":[{"title":"Soja","url":"https://example.com/soja","content":"Cierre 489."}]}' > "$out"; fi
echo '{"ok":true}'
`);
    await chmod(cli, 0o755);
    const descriptor = join(root, "research.json");
    await writeFile(descriptor, JSON.stringify({ directory: project, enabled: true, cli, home: root, provider: "tavily" }));

    const tools = new Map<string, EngineTool>();
    const context = {
      location: { directory: project },
      tool: {
        async transform(callback: (editor: { add(tool: EngineTool): void }) => void) {
          callback({ add: (tool) => { tools.set(tool.name, tool); } });
          return { async dispose() {} };
        },
      },
    } as never;
    await createResearchPlugin(descriptor).setup(context);
    const search = tools.get("tavily_search");
    assert.ok(search, "the research plugin did not register tavily_search");

    const result = await search.execute({ query: "precio soja" }, { signal: new AbortController().signal });
    assert.ok(result && typeof result === "object");
    const content = (result as { content?: Array<{ type: string; text: string }> }).content;
    assert.ok(Array.isArray(content) && content[0]?.type === "text", "expected a text content block");
    const payload = JSON.parse(content[0]!.text) as { provider: string; data: { results: Array<{ url: string }> } };
    assert.equal(payload.provider, "tavily");
    assert.equal(payload.data.results[0]?.url, "https://example.com/soja");
  } finally {
    if (original.datasets === undefined) delete process.env.DEN_FEATURE_SPECIALIST_DATASETS; else process.env.DEN_FEATURE_SPECIALIST_DATASETS = original.datasets;
    if (original.sources === undefined) delete process.env.DEN_FEATURE_SPECIALIST_SOURCES; else process.env.DEN_FEATURE_SPECIALIST_SOURCES = original.sources;
    await mkdir(root, { recursive: true });
    await rm(root, { recursive: true, force: true });
  }
});

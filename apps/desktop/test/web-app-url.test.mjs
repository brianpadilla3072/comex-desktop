import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveWebAppUrl, webAppUrlFromHtml } from "../electron/web-app-url.mjs";

const currentUrl = "http://localhost:40707/#/workspace/ws_example/session/ses_example";
const webHtml = '<html><head><script>window.__OPENWORK_BOOTSTRAP__ = {"token":"test-fixture"}</script></head></html>';

test("web links preserve the conversation using web routing instead of the desktop hash", () => {
  assert.equal(webAppUrlFromHtml(webHtml, "http://127.0.0.1:8787/", currentUrl), "http://127.0.0.1:8787/workspace/ws_example/session/ses_example");
  assert.equal(webAppUrlFromHtml(webHtml, "https://example.invalid/comex/", currentUrl), "https://example.invalid/comex/workspace/ws_example/session/ses_example");
  for (const html of ['<html>Vite renderer</html>', webHtml.replace('test-fixture', ''), webHtml.replace('{"token":"test-fixture"}', '{invalid}')]) {
    assert.equal(webAppUrlFromHtml(html, "http://localhost:40707/", currentUrl), null);
  }
});

test("an unavailable web app never falls back to the desktop renderer or API endpoint", async () => {
  const requested = [];
  const url = await resolveWebAppUrl({ serverUrl: "http://127.0.0.1:48000", currentUrl,
    fetchImpl: async url => { requested.push(url); return new Response('{}', { headers: { 'content-type': 'application/json' } }); },
  });
  assert.equal(url, null);
  assert.deepEqual(requested, ["http://127.0.0.1:48000/", "http://127.0.0.1:8787/"]);
});

test("the current server's web surface wins; ordinary HTTP 200 and redirects are not readiness", async () => {
  const url = await resolveWebAppUrl({ serverUrl: "http://127.0.0.1:48000", currentUrl,
    fetchImpl: async (url, options) => {
      assert.equal(options.redirect, "error");
      assert.equal(url, "http://127.0.0.1:48000/");
      return new Response(webHtml, { headers: { 'content-type': 'text/html' } });
    },
  });
  assert.equal(url, "http://127.0.0.1:48000/workspace/ws_example/session/ses_example");
  assert.equal(await resolveWebAppUrl({ serverUrl: null, currentUrl,
    fetchImpl: async () => new Response('<html>Another service</html>', { headers: { 'content-type': 'text/html' } }),
  }), null);
});

test("web routes match portable contract vectors", async () => {
  const { readFile } = await import("node:fs/promises");
  const { z } = await import("zod");
  const schema = z.object({ version: z.literal(1), vectors: z.array(z.object({
    baseUrl: z.string(), currentUrl: z.string(), expected: z.string().nullable(),
  })) });
  const contract = schema.parse(JSON.parse(await readFile(new URL("../../../contracts/web-app-url/v1/routes.json", import.meta.url), "utf8")));
  for (const vector of contract.vectors) assert.equal(webAppUrlFromHtml(webHtml, vector.baseUrl, vector.currentUrl), vector.expected);
});

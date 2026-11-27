import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { serveStaticUi } from "../src/static-ui.js";

const manifestSchema = z.object({
  id: z.literal("/"), scope: z.literal("/"), start_url: z.literal("/"),
  name: z.string().min(1), short_name: z.string().min(1), display: z.literal("standalone"),
  icons: z.array(z.object({ src: z.string(), sizes: z.string(), type: z.string() })),
});

test("served PWA manifest opens the root and includes real install-sized PNG icons", async () => {
  const root = fileURLToPath(new URL("../../app/public/", import.meta.url));
  const previous = process.env.DEN_FEATURE_DESKTOP_LOCAL_WEB;
  process.env.DEN_FEATURE_DESKTOP_LOCAL_WEB = "true";
  try {
    const config = { token: "synthetic-client", host: "127.0.0.1", desktopWebRoot: root };
    const response = await serveStaticUi(new Request("http://127.0.0.1/manifest.webmanifest"), config);
    assert.equal(response?.status, 200);
    assert.equal(response?.headers.get("content-type"), "application/manifest+json; charset=utf-8");
    assert.ok(response);
    const manifest = manifestSchema.parse(await response.json());
    for (const size of [192, 512]) {
      const icon = manifest.icons.find(item => item.type === "image/png" && item.sizes === `${size}x${size}`);
      assert.ok(icon);
      const png = await readFile(new URL(`../../app/public${icon.src}`, import.meta.url));
      assert.equal(png.readUInt32BE(16), size);
      assert.equal(png.readUInt32BE(20), size);
    }
  } finally {
    if (previous === undefined) delete process.env.DEN_FEATURE_DESKTOP_LOCAL_WEB;
    else process.env.DEN_FEATURE_DESKTOP_LOCAL_WEB = previous;
  }
});

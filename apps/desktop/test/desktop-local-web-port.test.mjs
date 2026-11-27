import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { desktopLocalWebPort } from "../electron/desktop-local-web.mjs";

test("desktop web has a stable, configurable port behind its feature", async () => {
  const fixture = JSON.parse(await readFile(new URL("../../../contracts/desktop-local-web/v1/ports.json", import.meta.url), "utf8"));
  assert.equal(fixture.version, 1);
  for (const vector of fixture.vectors) {
    if (vector.invalid) assert.throws(() => desktopLocalWebPort(vector.env));
    else assert.equal(desktopLocalWebPort(vector.env), vector.port);
  }
});

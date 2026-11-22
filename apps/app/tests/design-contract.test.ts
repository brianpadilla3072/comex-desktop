import { expect, test } from "bun:test";
import { boardSchema, designManifestSchema, designRelativePathSchema, designTokensSchema } from "@openwork/types/designs";

// The design studio's shared format: the server and the app import the same schemas.
test("a slides manifest parses with defaults and rejects unsafe page paths", () => {
  const manifest = designManifestSchema.parse({ format: "openwork.design", version: 1, id: "kick-off", kind: "slides", title: "Kick-off", createdAt: 1, updatedAt: 2, pages: [{ id: "p-1", title: "Portada", file: "pages/p-1.html", width: 1920, height: 1080 }] });
  expect(manifest.systemId).toBeNull();
  expect(manifest.thumbnail).toBeNull();
  for (const bad of ["../x.html", "/etc/passwd", "pages\\p.html", "pages/.hidden", "a//b"]) expect(designRelativePathSchema.safeParse(bad).success).toBe(false);
  expect(designRelativePathSchema.safeParse("assets/logo.svg").success).toBe(true);
});

test("tokens and boards fill their defaults", () => {
  const tokens = designTokensSchema.parse({ format: "openwork.design-tokens", version: 1, colors: [{ name: "Primario", value: "#1E3A8A" }] });
  expect(tokens.version).toBe(2); // v1 input is migrated on parse
  expect(tokens.spacing.tokens).toEqual([]);
  const board = boardSchema.parse({ format: "openwork.board", version: 1, elements: [{ id: "f1", type: "frame", title: "1 · Relevamiento", x: 0, y: 0, width: 400, height: 300 }] });
  expect(board.viewport.zoom).toBe(1);
  expect(boardSchema.safeParse({ format: "openwork.board", version: 1, elements: [{ id: "x", type: "video", x: 0, y: 0, width: 1, height: 1 }] }).success).toBe(false);
});

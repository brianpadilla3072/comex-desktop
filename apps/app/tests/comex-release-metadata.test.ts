import { expect, test } from "bun:test";
import { COMEX_RELEASE_METADATA_URL, parseComexReleaseMetadata, readComexReleaseMetadata } from "../src/app/lib/comex-release-metadata";

const inventory = { latestAppVersion: "1.0.12", publishedDesktopVersions: ["1.0.1", "1.0.12"] };

test("reads Comex versions independently of upstream version numbers", () => {
  expect(parseComexReleaseMetadata(inventory)).toEqual({ ...inventory, minAppVersion: "0.0.0", webUrl: null });
});

test("rejects missing, malformed, and unpublished latest versions", () => {
  for (const value of [null, {}, { ...inventory, latestAppVersion: "0.18.65" }, { ...inventory, latestAppVersion: "1.0.13" }, { ...inventory, publishedDesktopVersions: ["1.0.12", "https://example.test"] }]) {
    expect(() => parseComexReleaseMetadata(value)).toThrow();
  }
});

test("fetches fresh public metadata without forwarding credentials", async () => {
  const metadata = await readComexReleaseMetadata(async (url, options) => {
    expect(url).toBe(COMEX_RELEASE_METADATA_URL);
    expect(options?.credentials).toBe("omit");
    expect(options?.cache).toBe("no-store");
    return Response.json(inventory);
  });
  expect(metadata.latestAppVersion).toBe("1.0.12");
});

test("fails closed if metadata cannot be downloaded", async () => {
  await expect(readComexReleaseMetadata(async () => new Response("unavailable", { status: 503 }))).rejects.toThrow("HTTP 503");
});

test("uses Electron's main process for release redirects", async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const calls: unknown[][] = [];
  Reflect.set(globalThis, "window", {
    __OPENWORK_ELECTRON__: {
      invokeDesktop: async (...args: unknown[]) => {
        calls.push(args);
        return { status: 200, statusText: "OK", headers: [], body: JSON.stringify(inventory) };
      },
    },
  });
  try {
    expect((await readComexReleaseMetadata()).latestAppVersion).toBe("1.0.12");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("__fetch");
    expect(calls[0]?.[1]).toBe(COMEX_RELEASE_METADATA_URL);
    expect(calls[0]?.[2]).toMatchObject({ timeoutMs: 10_000, headers: { "cache-control": "no-cache" } });
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

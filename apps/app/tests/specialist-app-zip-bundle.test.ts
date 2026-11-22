import { afterEach, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://localhost/" });
const { archiveFileName, isZipFile, readBundleFile } = await import("../src/react-app/domains/specialists/portability");
const { createOpenworkServerClient } = await import("../src/app/lib/openwork-server");

// specialistAppZipBundle: `.owapp` export and import from the app.
let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; });

const zipBytes = () => new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);

test("the archive is named after the application and safe on every OS", () => {
  expect(archiveFileName("Comercio Exterior: Ñandú / Prueba")).toBe("Comercio Exterior Ñandú Prueba.owapp");
  expect(archiveFileName("  ???  ")).toBe("aplicacion.owapp");
  expect(archiveFileName("Final.")).toBe("Final.owapp");
});

test("a picked file is recognized by its content, not its extension", async () => {
  expect(await isZipFile(new Blob([zipBytes()]))).toBe(true);
  expect(await isZipFile(new Blob(["{\"format\":1}"]))).toBe(false);
  const archive = new Blob([zipBytes()]);
  const picked = await readBundleFile(archive, { archives: true });
  expect(picked.kind).toBe("archive");
  if (picked.kind === "archive") expect(picked.file).toBe(archive);
  expect(await readBundleFile(new Blob(["{\"format\":\"x\"}"]), { archives: true })).toEqual({ kind: "json", bundle: { format: "x" } });
  // With the flag off an archive is refused before any upload, and v1 JSON still works.
  await expect(readBundleFile(archive, { archives: false })).rejects.toThrow(/\.owapp/);
  await expect(readBundleFile(new Blob(["no es json"]), { archives: true })).rejects.toThrow(/\.owapp o \.json|\.owapp or \.json/);
});

test("the client streams the archive as a raw upload and downloads the export as a Blob", async () => {
  const requests: Array<{ url: string; method: string; type: string | null; size: number }> = [];
  const spy = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push({ url: request.url, method: request.method, type: request.headers.get("content-type"), size: request.method === "POST" ? (await request.arrayBuffer()).byteLength : 0 });
    if (request.method === "POST") return Response.json({ workspaceId: "ws_1", skippedSections: [], warnings: ["aviso"], catalog: {} }, { status: 201 });
    return new Response(zipBytes(), { status: 200, headers: { "content-type": "application/zip" } });
  });
  restore = () => spy.mockRestore();
  const client = createOpenworkServerClient({ baseUrl: "http://localhost:8787", token: "owner", hostToken: "host" });
  const blob = await client.exportSpecialistApplicationArchive("app_1");
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(zipBytes());
  const result = await client.importSpecialistApplicationArchive(new Blob([zipBytes()]), "Ana María");
  expect(result).toEqual({ workspaceId: "ws_1", skippedSections: [], warnings: ["aviso"] });
  expect(requests[0]).toMatchObject({ url: "http://localhost:8787/specialist-applications/app_1/export", method: "GET" });
  expect(requests[1]).toMatchObject({ url: "http://localhost:8787/specialist-applications/import?userName=Ana%20Mar%C3%ADa", method: "POST", type: "application/zip", size: 8 });
});

import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { createOpenworkServerClient, OpenworkServerError } from "../src/app/lib/openwork-server";
import { designDetailSchema, designPageRoute, designRouteFromPath, isDesignPath, resolveDesignReference } from "../src/app/lib/designs";

const manifest = {
  format: "openwork.design", version: 1, id: "plan", kind: "slides", title: "Plan", createdAt: 1, updatedAt: 2,
  pages: [{ id: "p-1", title: "Portada", file: "pages/p-1.html", width: 1920, height: 1080 }], systemId: null, thumbnail: null,
};
const summary = { workspaceId: "ws_1", projectName: "Lanzamiento", id: "plan", kind: "slides", title: "Plan", pages: 1, updatedAt: 2, createdAt: 1, hasThumbnail: false };

const client = () => createOpenworkServerClient({ baseUrl: "http://127.0.0.1:1", token: "token" });
const calls = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map(call => {
  const init = call[1];
  const method = init && typeof init === "object" && "method" in init && typeof init.method === "string" ? init.method : "GET";
  return `${method} ${String(call[0])}`;
});

describe("design studio client", () => {
  const spies: Array<{ mockRestore: () => void }> = [];
  afterEach(() => { for (const spy of spies.splice(0)) spy.mockRestore(); });

  test("lists designs, all or for one project, and parses them", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ designs: [summary], writable: true }));
    spies.push(fetchSpy);
    expect((await client().listDesigns()).designs[0]?.projectName).toBe("Lanzamiento");
    await client().listDesigns("ws 1");
    expect(calls(fetchSpy)).toEqual(["GET http://127.0.0.1:1/designs", "GET http://127.0.0.1:1/designs?workspaceId=ws%201"]);
  });

  test("refuses a list that does not match the contract", async () => {
    spies.push(spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ designs: [{ ...summary, kind: "video" }], writable: true })));
    await expect(client().listDesigns()).rejects.toThrow();
  });

  test("create, read, patch, pages and chats hit their routes", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/chats")) return Response.json({ sessions: ["ses_1"] });
      if (url === "http://127.0.0.1:1/designs/ws_1/plan" && (!init?.method || init.method === "GET")) return Response.json({ design: manifest, writable: false, revision: 7 });
      if (init?.method === "DELETE" && url === "http://127.0.0.1:1/designs/ws_1/plan") return Response.json({ ok: true });
      return Response.json({ design: manifest }, { status: init?.method === "POST" ? 201 : 200 });
    });
    spies.push(fetchSpy);
    const api = client();
    expect((await api.createDesign({ workspaceId: "ws_1", kind: "slides", title: "Plan" })).id).toBe("plan");
    const detail = await api.getDesign("ws_1", "plan");
    expect(detail.revision).toBe(7);
    expect(detail.writable).toBe(false);
    await api.updateDesign("ws_1", "plan", { title: "Otro", systemId: null });
    await api.addDesignPage("ws_1", "plan", { afterPageId: "p-1" });
    await api.updateDesignPage("ws_1", "plan", "p-1", { title: "Portada", notes: null });
    await api.reorderDesignPages("ws_1", "plan", ["p-1"]);
    await api.deleteDesignPage("ws_1", "plan", "p-1");
    expect(await api.listDesignChats("ws_1", "plan")).toEqual(["ses_1"]);
    expect(await api.bindDesignChat("ws_1", "plan", "ses_1")).toEqual(["ses_1"]);
    await api.deleteDesign("ws_1", "plan");
    expect(calls(fetchSpy)).toEqual([
      "POST http://127.0.0.1:1/designs",
      "GET http://127.0.0.1:1/designs/ws_1/plan",
      "PATCH http://127.0.0.1:1/designs/ws_1/plan",
      "POST http://127.0.0.1:1/designs/ws_1/plan/pages",
      "PATCH http://127.0.0.1:1/designs/ws_1/plan/pages/p-1",
      "PUT http://127.0.0.1:1/designs/ws_1/plan/pages/order",
      "DELETE http://127.0.0.1:1/designs/ws_1/plan/pages/p-1",
      "GET http://127.0.0.1:1/designs/ws_1/plan/chats",
      "POST http://127.0.0.1:1/designs/ws_1/plan/chats",
      "DELETE http://127.0.0.1:1/designs/ws_1/plan",
    ]);
  });

  test("files travel raw: read as a typed Blob, write a string or Blob, thumbnail and HTML export", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/export?format=html")) return new Response(new Uint8Array([0x50, 0x4b]), { headers: { "content-type": "application/zip" } });
      if (init?.method === "PUT") return Response.json({ ok: true, design: manifest });
      return new Response("<!doctype html>", { headers: { "content-type": "text/html; charset=utf-8" } });
    });
    spies.push(fetchSpy);
    const api = client();
    const page = await api.readDesignFile("ws_1", "plan", "pages/p-1.html");
    expect(page.type).toBe("text/html; charset=utf-8");
    expect(await page.text()).toBe("<!doctype html>");
    await api.writeDesignFile("ws_1", "plan", "assets/logo un.svg", "<svg/>");
    await api.putDesignThumbnail("ws_1", "plan", new Blob([new Uint8Array([1])], { type: "image/png" }));
    const zip = await api.exportDesignHtml("ws_1", "plan");
    expect(zip.type).toBe("application/zip");
    expect(calls(fetchSpy)).toEqual([
      "GET http://127.0.0.1:1/designs/ws_1/plan/files?path=pages%2Fp-1.html",
      "PUT http://127.0.0.1:1/designs/ws_1/plan/files?path=assets%2Flogo%20un.svg",
      "PUT http://127.0.0.1:1/designs/ws_1/plan/thumbnail",
      "GET http://127.0.0.1:1/designs/ws_1/plan/export?format=html",
    ]);
  });

  test("a missing file is a 404 OpenworkServerError with the server's code", async () => {
    spies.push(spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ code: "design_file_not_found", message: "No" }, { status: 404 })));
    const error = await client().readDesignFile("ws_1", "plan", "assets/x.png").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(OpenworkServerError);
    expect(error instanceof OpenworkServerError ? [error.status, error.code] : null).toEqual([404, "design_file_not_found"]);
    spies.push(spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ code: "design_path_invalid", message: "No" }, { status: 400 })));
    const write = await client().writeDesignFile("ws_1", "plan", "../x", "x").catch((cause: unknown) => cause);
    expect(write instanceof OpenworkServerError ? write.code : null).toBe("design_path_invalid");
  });
});

describe("design helpers", () => {
  test("routes and paths", () => {
    expect(designPageRoute("ws 1", "plan")).toBe("/design/ws%201/plan");
    expect(designRouteFromPath("/design/ws%201/plan")).toEqual({ workspaceId: "ws 1", designId: "plan" });
    expect(designRouteFromPath("/design")).toBeNull();
    expect(isDesignPath("/design")).toBe(true);
    expect(isDesignPath("/designs")).toBe(false);
    expect(designDetailSchema.parse({ design: manifest, writable: true }).revision).toBe(0);
  });

  test("references resolve inside the design folder only", () => {
    expect(resolveDesignReference("pages/p-1.html", "../assets/logo.svg")).toBe("assets/logo.svg");
    expect(resolveDesignReference("pages/p-1.html", "../styles.css?v=2#x")).toBe("styles.css");
    expect(resolveDesignReference("styles.css", "assets/fondo%20azul.png")).toBe("assets/fondo azul.png");
    for (const bad of ["../../x.png", "/etc/passwd", "https://cdn.example/x.png", "//cdn.example/x.png", "data:image/png;base64,AA", "#frag", "../assets/.secreto", "file:///x", ""]) {
      expect(resolveDesignReference("pages/p-1.html", bad)).toBeNull();
    }
  });
});

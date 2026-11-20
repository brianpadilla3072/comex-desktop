import { afterEach, describe, expect, spyOn, test } from "bun:test"

import { createOpenworkServerClient, OpenworkServerError } from "../src/app/lib/openwork-server"
import {
  PROJECT_LIMITS,
  compareProjects,
  isProjectErrorCode,
  projectDetailSchema,
  projectTaskInputSchema,
  projectUsagePercent,
} from "../src/app/lib/projects"

const summary = {
  workspaceId: "ws_1", applicationId: "app_1", applicationName: "Aduanas", name: "Importación",
  description: "", pinned: false, pinnedAt: null, lastActivityAt: 1_763_500_000_000, createdAt: 1_763_000_000_000,
}
const usage = { files: 2, bytes: 1_024, capacityBytes: PROJECT_LIMITS.contextBytes, capacityFiles: PROJECT_LIMITS.contextFiles, usedPercent: 0 }

function client() {
  return createOpenworkServerClient({ baseUrl: "http://127.0.0.1:1", token: "token" })
}

describe("projects client", () => {
  const spies: Array<{ mockRestore: () => void }> = []
  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore()
  })

  test("lists projects and parses the registry", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ projects: [summary], writable: false }))
    spies.push(fetchSpy)
    const result = await client().listProjects()
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe("http://127.0.0.1:1/specialist-projects")
    expect(result.projects[0]?.name).toBe("Importación")
    expect(result.writable).toBe(false)
  })

  test("refuses a response that does not match the contract", async () => {
    spies.push(spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ projects: [{ ...summary, pinned: "yes" }], writable: true })))
    await expect(client().listProjects()).rejects.toThrow()
  })

  test("parses the project detail with its four summaries", async () => {
    spies.push(spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
      ...summary,
      instructions: { set: true, updatedAt: 1 }, context: usage, memory: { entries: 3, enabled: true }, scheduled: { tasks: 1 },
      recentSessions: [{ id: "ses_1", title: "Cotización", updatedAt: 2 }], recentSessionsComplete: true, writable: true,
    })))
    const detail = await client().getProject("ws_1")
    expect(projectDetailSchema.parse(detail).memory.entries).toBe(3)
    expect(detail.recentSessions[0]?.title).toBe("Cotización")
  })

  test("uploads context as the raw body with folder and name in the query", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
      entry: { kind: "file", name: "a b.pdf", path: "Normas/a b.pdf", size: 1, items: null, updatedAt: 1 }, usage,
    }, { status: 201 }))
    spies.push(fetchSpy)
    const file = new File(["x"], "a b.pdf")
    const result = await client().uploadProjectContextFile("ws_1", file, { name: "a b.pdf", folder: "Normas" })
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("http://127.0.0.1:1/specialist-projects/ws_1/context/files?path=Normas&name=a+b.pdf")
    expect(init.body).toBe(file)
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/octet-stream")
    expect(result.entry?.path).toBe("Normas/a b.pdf")
  })

  test("an upload refused by the server keeps its stable code", async () => {
    spies.push(spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ code: "context_capacity_bytes", message: "No entra." }, { status: 413 })))
    const failure = await client().uploadProjectContextFile("ws_1", new File(["x"], "a.pdf"), { name: "a.pdf" }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(OpenworkServerError)
    expect(failure instanceof OpenworkServerError ? failure.code : "").toBe("context_capacity_bytes")
    expect(isProjectErrorCode("context_capacity_bytes")).toBe(true)
  })

  test("creates a project task through the application route with the project id", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
      task: { id: "task_1", name: "Resumen", prompt: "Resume.", schedule: { kind: "daily", hour: 9, minute: 0 }, enabled: true, nextRunAt: 5, workspaceId: "ws_1", permissionMode: "auto", isolation: true },
      tasks: [], budget: {},
    }))
    spies.push(fetchSpy)
    const saved = await client().createProjectTask("app_1", "ws_1", { name: "Resumen", prompt: "Resume.", schedule: { kind: "daily", hour: 9, minute: 0 }, permissionMode: "auto", advanced: { catchUp: false } })
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("http://127.0.0.1:1/specialist-applications/app_1/tasks")
    expect(JSON.parse(String(init.body))).toEqual({ name: "Resumen", prompt: "Resume.", schedule: { kind: "daily", hour: 9, minute: 0 }, permissionMode: "auto", advanced: { catchUp: false }, workspaceId: "ws_1" })
    expect(saved.task.permissionMode).toBe("auto")
  })

  test("deletes a memory note with the expected revision in the query", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ revision: 3, notes: [], writable: true, maxNotes: 24, maxChars: 800 }))
    spies.push(fetchSpy)
    await client().deleteProjectMemoryNote("ws_1", "00000000-0000-4000-8000-000000000001", 2)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("http://127.0.0.1:1/specialist-projects/ws_1/memory/00000000-0000-4000-8000-000000000001?expectedRevision=2")
    expect(init.method).toBe("DELETE")
  })
})

describe("project schemas", () => {
  test("task input validates permission mode and schedule", () => {
    expect(projectTaskInputSchema.safeParse({ name: "A", prompt: "B", schedule: { kind: "once", at: 1 }, permissionMode: "manual" }).success).toBe(true)
    expect(projectTaskInputSchema.safeParse({ name: "A", prompt: "B", schedule: { kind: "once", at: 1 }, permissionMode: "always" }).success).toBe(false)
    expect(projectTaskInputSchema.safeParse({ name: "A", prompt: "B", schedule: { kind: "hourly" } }).success).toBe(false)
  })

  test("usage percent and default order follow the shared rules", () => {
    expect(projectUsagePercent({ files: 250, bytes: 0 })).toBe(50)
    expect(projectUsagePercent({ files: 0, bytes: PROJECT_LIMITS.contextBytes * 2 })).toBe(100)
    const ordered = [
      { workspaceId: "b", name: "B", pinnedAt: null, lastActivityAt: 10 },
      { workspaceId: "a", name: "A", pinnedAt: 5, lastActivityAt: 1 },
      { workspaceId: "c", name: "C", pinnedAt: null, lastActivityAt: 20 },
    ].sort(compareProjects).map(project => project.workspaceId)
    expect(ordered).toEqual(["a", "c", "b"])
  })
})

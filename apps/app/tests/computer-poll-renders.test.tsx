// The chat polls the desktop for its computer view and crew every 1.5 s. An
// unchanged answer must not re-render the chat (renderer CPU while runs wait).
import { afterAll, afterEach, beforeEach, expect, jest, test } from "bun:test"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { act, createElement, Profiler } from "react"
import { createRoot, type Root } from "react-dom/client"

GlobalRegistrator.register({ url: "https://web.example/" })
const previousAct = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT")
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true)
afterAll(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousAct)
  GlobalRegistrator.unregister()
})

const { useComputerCrew } = await import("../src/components/chat/computer-crew")
const { ComputerControl } = await import("../src/react-app/domains/session/computer/computer-control")

let calls: string[] = []
let mounted: { root: Root; container: HTMLElement } | null = null

beforeEach(() => {
  jest.useFakeTimers()
  calls = []
  // Every answer is a fresh object with the same content, as IPC delivers it.
  Reflect.set(window, "__OPENWORK_ELECTRON__", {
    invokeDesktop: async (command: string) => {
      calls.push(command)
      if (command === "computerCrew") return []
      if (command === "computerSnapshot") return { enabled: true, session: null }
      return null
    },
  })
})

afterEach(async () => {
  if (mounted) {
    const { root, container } = mounted
    await act(async () => root.unmount())
    container.remove()
    mounted = null
  }
  Reflect.deleteProperty(window, "__OPENWORK_ELECTRON__")
  jest.useRealTimers()
})

async function mountCounting(child: ReturnType<typeof createElement>) {
  let commits = 0
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  mounted = { root, container }
  await act(async () => root.render(createElement(Profiler, { id: "probe", onRender: () => { commits += 1 } }, child)))
  return () => commits
}

async function poll(times: number) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => { jest.advanceTimersByTime(1_500) })
  }
}

function Crew() {
  useComputerCrew("session_crew", true)
  return null
}

test("an unchanged crew does not re-render the chat on each poll", async () => {
  const commits = await mountCounting(createElement(Crew))
  await poll(1)
  const before = commits()
  const reads = calls.filter((command) => command === "computerCrew").length
  await poll(4)
  expect(calls.filter((command) => command === "computerCrew").length).toBeGreaterThan(reads)
  expect(commits()).toBe(before)
})

test("an unchanged computer snapshot does not re-render the chat on each poll", async () => {
  const commits = await mountCounting(createElement(ComputerControl, { sessionId: "session_computer" }))
  await poll(1)
  const before = commits()
  const reads = calls.filter((command) => command === "computerSnapshot").length
  await poll(4)
  expect(calls.filter((command) => command === "computerSnapshot").length).toBeGreaterThan(reads)
  expect(commits()).toBe(before)
})

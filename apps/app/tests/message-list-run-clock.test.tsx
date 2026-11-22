// The Working time ticks in its own line: a waiting run must not re-render the
// whole transcript every second (renderer CPU with many chats waiting).
import { afterAll, afterEach, expect, jest, mock, setSystemTime, test } from "bun:test"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { UIMessage } from "ai"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

GlobalRegistrator.register({ url: "https://web.example/" })
const previousAct = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT")
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true)
afterAll(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousAct)
  GlobalRegistrator.unregister()
})

// Count transcript renders: the virtualized list re-renders whenever MessageList does.
const progressive = await import("../src/components/chat/progressive-message-list")
const RealProgressiveMessageList = progressive.ProgressiveMessageList
let transcriptRenders = 0
function CountingProgressiveMessageList(props: Parameters<typeof RealProgressiveMessageList>[0]) {
  transcriptRenders += 1
  return createElement(RealProgressiveMessageList, props)
}
mock.module("../src/components/chat/progressive-message-list", () => ({
  ...progressive,
  ProgressiveMessageList: CountingProgressiveMessageList,
}))

const { PlatformProvider, createDefaultPlatform } = await import("../src/react-app/kernel/platform")
const { MessageListProvider } = await import("../src/components/chat/message-list-provider")
const { MessageList } = await import("../src/components/chat/message-list")
const { DenAuthProvider } = await import("../src/react-app/domains/cloud/den-auth-provider")
const { useSessionActivityStore } = await import("../src/react-app/domains/session/status/session-activity-store")
const { NO_NEW_ACTIVITY_AFTER_MS } = await import("../src/react-app/domains/session/status/session-progress")

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
const workspaceId = "workspace_clock"
const sessionId = "session_clock"
let mounted: { root: Root; container: HTMLElement } | null = null

afterEach(async () => {
  if (mounted) {
    const { root, container } = mounted
    await act(async () => root.unmount())
    container.remove()
    mounted = null
  }
  jest.useRealTimers()
  setSystemTime()
  useSessionActivityStore.getState().removeSession(workspaceId, sessionId)
})

async function renderWaitingRun(startedAt: number) {
  setSystemTime(new Date(startedAt))
  useSessionActivityStore.getState().setRunStatus(workspaceId, sessionId, { type: "busy" })
  const messages: UIMessage[] = [{
    id: "msg_user",
    role: "user",
    parts: [{ type: "text", text: "Wait for the model" }],
    metadata: { opencode: { created: startedAt } },
  }]
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  mounted = { root, container }
  await act(async () => root.render(createElement(QueryClientProvider, { client: queryClient,
    children: createElement(DenAuthProvider, { children: createElement(PlatformProvider, {
      value: createDefaultPlatform(),
      children: createElement(MessageListProvider, {
        workspaceId, sessionId,
        showThinking: false, developerMode: false, displaySuggestions: false, providerConnectedCount: 0,
        dispatchAction: () => {}, setPrompt: () => {}, onRevertToUserMessage: () => {},
        onForkAtMessage: () => {}, onEditUserMessage: () => {},
        onMcpReconnect: async () => { throw new Error("Unexpected reconnect") },
        onMcpReopenAuthorization: async () => {},
        children: createElement(MessageList, {
          messages,
          status: "streaming",
          activityStatus: "thinking",
          syncHealth: { degraded: false, lastConfirmedAt: startedAt },
        }),
      }),
    }) }) })))
  return container
}

async function advance(ms: number) {
  // One act per second, so every tick commits on its own. Fake timers move Date.now() too.
  for (let elapsed = 0; elapsed < ms; elapsed += 1_000) {
    await act(async () => { jest.advanceTimersByTime(Math.min(1_000, ms - elapsed)) })
  }
}

const working = (container: HTMLElement) => container.querySelector('[data-loading-message="working"]')?.textContent ?? null

test("the Working time ticks without re-rendering the transcript", async () => {
  jest.useFakeTimers()
  const container = await renderWaitingRun(Date.now())
  await advance(1_000)
  const before = transcriptRenders
  await advance(5_000)
  expect(working(container)).toMatch(/^Working 6s$/)
  expect(transcriptRenders).toBe(before)
})

test("the transcript wakes once when the run turns silent, not every second", async () => {
  jest.useFakeTimers()
  await renderWaitingRun(Date.now())
  await advance(1_000)
  const before = transcriptRenders
  await advance(NO_NEW_ACTIVITY_AFTER_MS + 5_000)
  expect(transcriptRenders).toBe(before + 1)
})

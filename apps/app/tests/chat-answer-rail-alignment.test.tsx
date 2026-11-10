import { afterAll, afterEach, expect, test } from "bun:test"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { DynamicToolUIPart, UIMessage } from "ai"
import type { ModelOption } from "../src/app/types"

GlobalRegistrator.register({ url: "https://web.example/" })
const previousAct = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT")
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true)
const { PlatformProvider, createDefaultPlatform } = await import("../src/react-app/kernel/platform")
const { MessageListProvider } = await import("../src/components/chat/message-list-provider")
const { MessageList } = await import("../src/components/chat/message-list")
const { useModelPickerCatalogStore } = await import("../src/react-app/domains/session/models/model-collections-store")
const { useAutoRouteStore } = await import("../src/react-app/domains/session/sync/auto-route-store")
let mounted: { root: Root; container: HTMLElement } | null = null

afterEach(async () => {
  if (mounted) {
    const { root, container } = mounted
    await act(async () => root.unmount())
    container.remove()
    mounted = null
  }
  useModelPickerCatalogStore.setState({ bySession: {} })
  useAutoRouteStore.setState({ bySession: {} })
})
afterAll(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousAct)
  GlobalRegistrator.unregister()
})

/** A finished reply: steps fold to "Worked for 7s" and the answer stays visible. */
function answer(id: string): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [{ type: "text", text: "The document is ready. It lists the changes and the next step." }],
    metadata: { opencode: { created: 1000, completed: 8000, replyModel: { providerID: "anthropic", modelID: "claude-sonnet", name: "Claude Sonnet", resolved: true } } },
  }
}

async function render(messages: UIMessage[], streaming = false, modelOptions?: readonly ModelOption[], activityStatus?: string) {
  if (modelOptions) useModelPickerCatalogStore.getState().publish("session_fixture", Symbol(), modelOptions)
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  mounted = { root, container }
  await act(async () => root.render(createElement(PlatformProvider, {
    value: createDefaultPlatform(),
    children: createElement(MessageListProvider, {
      workspaceId: "workspace_fixture", sessionId: "session_fixture",
      showThinking: true, developerMode: false, displaySuggestions: false, providerConnectedCount: 0,
      dispatchAction: () => {}, setPrompt: () => {}, onRevertToUserMessage: () => {},
      onForkAtMessage: () => {}, onEditUserMessage: () => {},
      onMcpReconnect: async () => {}, onMcpReopenAuthorization: async () => {},
      children: createElement(MessageList, {
        messages,
        status: streaming ? "streaming" : "ready",
        activityStatus: (activityStatus ?? (streaming ? "responding" : "idle")) as never,
      }),
    }),
  })))
  return container
}

/** The frame every chat row shares: a centered column with the same gutters. */
const FRAME = "max-w-3xl"

function frameOf(element: Element | null): Element | null {
  let current: Element | null = element
  while (current && !current.className.toString().includes(FRAME)) current = current.parentElement
  return current
}

test("the answer and the activity rail share one frame and one left edge", async () => {
  const container = await render([answer("reply")])

  const rail = container.querySelector('[data-testid="completed-work-rail"]')
  expect(rail?.textContent).toContain("Worked for 7s")
  const prose = container.querySelector('[data-message-role="assistant"] .prose')
  expect(prose).not.toBeNull()

  // Text-first rail (activity-rail.tsx): sentences share the reply's left edge. There is no
  // reserved lane span in front of either one, so no reply is indented 20px past the steps.
  const railFrame = frameOf(rail)
  const answerFrame = frameOf(prose)
  expect(railFrame).not.toBeNull()
  // Same centered column with the same gutters: the two rows are separate elements, but
  // they resolve to one left edge (mx-auto + max-w-3xl + px-2 md:px-10).
  const gutters = (frame: Element | null) => ["mx-auto", "w-full", "max-w-3xl"].every(name => frame?.className.toString().includes(name))
  expect(gutters(railFrame)).toBe(true)
  expect(gutters(answerFrame)).toBe(true)
  expect(rail?.querySelector('span[aria-hidden="true"]')).toBeNull()
  const proseRow = prose?.parentElement
  expect(proseRow?.querySelector('span[aria-hidden="true"]')).toBeNull()
  // Their text columns start at the same place: the first child of each row is the text.
  expect(rail?.firstElementChild?.textContent).toContain("Worked for 7s")
  expect(proseRow?.firstElementChild).toBe(prose)
})

test("the answer keeps its frame while it streams, so it does not jump when it finishes", async () => {
  const container = await render([answer("streaming")], true)
  const prose = container.querySelector('[data-message-role="assistant"] .prose')
  expect(prose).not.toBeNull()
  expect(frameOf(prose)).not.toBeNull()
  // No completed rail while streaming; the answer already sits in the final frame.
  expect(container.querySelector('[data-testid="completed-work-rail"]')).toBeNull()
})

/** A script that started but has no visible calls yet — its lane must be a spinner, not a generic dot. */
function runningScript(toolCallId: string): UIMessage {
  const scriptPart: DynamicToolUIPart = {
    type: "dynamic-tool",
    toolName: "tools",
    toolCallId,
    state: "input-streaming",
    input: { prompt: "Summarize the changes and post them" },
    callProviderMetadata: { openwork: { codeMode: { calls: [] } } },
  }
  return {
    id: "reply_script",
    role: "assistant",
    parts: [scriptPart],
    metadata: { opencode: { created: 1000 } },
  }
}

test("a running script with no visible calls is one quiet text row (no spinner, no dot)", async () => {
  const container = await render(
    [{ id: "user_script", role: "user", parts: [{ type: "text", text: "Run a script." }], metadata: { opencode: { created: 900 } } }, runningScript("call_script")],
    true,
    undefined,
    "responding",
  )
  // The empty-group row's label is the script summary ("Running a script").
  expect(container.textContent).toContain("Running a script")
  // Text-first (activity-rail.tsx): the running row is one quiet sentence in full ink.
  // No spinner and no generic solid dot sit beside it: the turn's Working line is the one
  // thing that shimmers, so two rows never sweep at once.
  expect(container.querySelector('[data-code-mode-call] [data-text-step-tone="running"]')).not.toBeNull()
  expect(container.querySelector('[data-code-mode-call] .animate-spin')).toBeNull()
  expect(container.querySelector('[data-code-mode-call] .size-1.rounded-full.bg-muted-foreground')).toBeNull()
})

/** A capability call in flight with no connector mark — its lane must be a spinner, not a generic dot. */
function runningGenericCall(toolCallId: string): UIMessage {
  const callPart: DynamicToolUIPart = {
    type: "dynamic-tool",
    toolName: "acme-api_get_data",
    toolCallId,
    state: "input-streaming",
    input: { path: "/data" },
  }
  return {
    id: "reply_call",
    role: "assistant",
    parts: [callPart],
    metadata: { opencode: { created: 1000 } },
  }
}

test("an in-flight capability call with no connector is one quiet text row (no spinner, no dot)", async () => {
  const container = await render(
    [{ id: "user_call", role: "user", parts: [{ type: "text", text: "Fetch the data." }], metadata: { opencode: { created: 900 } } }, runningGenericCall("call_data")],
    true,
    undefined,
    "responding",
  )
  // Same text-first contract for a capability call: one sentence in full ink while it runs,
  // no spinner and no solid dot beside it.
  expect(container.querySelector('[data-capability-call] [data-text-step-tone="running"]')).not.toBeNull()
  expect(container.querySelector('[data-capability-call] .animate-spin')).toBeNull()
  expect(container.querySelector('[data-capability-call] .size-1.rounded-full.bg-muted-foreground')).toBeNull()
})
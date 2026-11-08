import assert from "node:assert/strict"
import { test } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ConversationTabs } from "../src/react-app/domains/session/chat/workspace-navigation-bar"

const sessionTabs = [{ workspaceId: "ws1", sessionId: "ses1", title: "Conversación" }] as never
const resources = [
  { id: "t1", kind: "page", title: "Nota.md", ownerSessionId: null },
  { id: "t2", kind: "terminal", title: "Terminal", ownerSessionId: null },
] as never

const base = { tabs: sessionTabs, workspaceId: "ws1", sessionId: "ses1", onSelect: () => {}, onClose: () => {}, onNew: () => {}, resources }

test("no split text button lives in the strip anymore; the extra slot renders the passed action", () => {
  const plain = renderToStaticMarkup(createElement(ConversationTabs, base))
  assert.ok(!plain.includes("Dividir"))
  const withExtra = renderToStaticMarkup(createElement(ConversationTabs, { ...base, extraAction: createElement("button", { "aria-label": "Abrir panel lateral" }) }))
  assert.ok(withExtra.includes("Abrir panel lateral"))
})

test("split keeps the conversation and the chosen side tab both marked current", () => {
  const split = renderToStaticMarkup(createElement(ConversationTabs, { ...base, split: true, activeResourceId: "t1", onSelectResource: () => {} }))
  const current = split.match(/aria-current="page"/g) ?? []
  assert.equal(current.length, 2, "conversation + side page highlighted together")
})

test("without split the conversation loses its highlight when a page is active", () => {
  const swapped = renderToStaticMarkup(createElement(ConversationTabs, { ...base, split: false, activeResourceId: "t2", onSelectResource: () => {} }))
  const current = swapped.match(/aria-current="page"/g) ?? []
  assert.equal(current.length, 1)
})

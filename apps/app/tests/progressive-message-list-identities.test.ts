import { expect, test } from "bun:test"

import { uniqueGroupIdentities } from "../src/components/chat/progressive-message-list"

test("an acknowledged send keeps the optimistic ID as its row identity", () => {
  const identities = new Map([["msg_server_a", "msg_pending_a"]])
  expect(uniqueGroupIdentities(["msg_server_a", "msg_reply"], identities)).toEqual(["msg_pending_a", "msg_reply"])
})

test("two server messages acknowledged by the same send never share a row key", () => {
  // Two identical prompts sent back to back: the sticky identity map ends up pointing both
  // server messages at the first send's ID, which used to crash the virtualized thread.
  const identities = new Map([["msg_server_a", "msg_pending_a"], ["msg_server_b", "msg_pending_a"]])
  const keys = uniqueGroupIdentities(["msg_server_a", "msg_reply_a", "msg_server_b", "msg_reply_b"], identities)
  expect(keys).toEqual(["msg_pending_a", "msg_reply_a", "msg_server_b", "msg_reply_b"])
  expect(new Set(keys).size).toBe(keys.length)
})

test("a pending row and its acknowledged server row never share a row key", () => {
  const identities = new Map([["msg_server_a", "msg_pending_a"]])
  expect(uniqueGroupIdentities(["msg_pending_a", "msg_server_a"], identities)).toEqual(["msg_pending_a", "msg_server_a"])
})

test("even a repeated raw key gets a distinct row key", () => {
  const keys = uniqueGroupIdentities(["msg_a", "msg_a", "msg_a"], new Map())
  expect(keys).toEqual(["msg_a", "msg_a#1", "msg_a#2"])
})

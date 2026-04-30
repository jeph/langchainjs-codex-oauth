import {
  AIMessage,
  ChatMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages"
import { describe, expect, test } from "vitest"

import {
  buildInstructions,
  findEarliestStopIndex,
  toInputItems,
  truncateAtStop,
} from "../../src/converters/messages.js"

describe("message conversion", () => {
  test("builds top-level instructions from system-style messages", () => {
    const instructions = buildInstructions([
      new SystemMessage("Be terse."),
      new ChatMessage("Route billing issues to finance.", "developer"),
      new HumanMessage("hi"),
    ])

    expect(instructions).toBe("Be terse.\n\nRoute billing issues to finance.")
  })

  test("keeps system-style messages out of regular input items", () => {
    const items = toInputItems([
      new SystemMessage("Be terse."),
      new ChatMessage("Route billing issues to finance.", "developer"),
      new HumanMessage("hi"),
    ])

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ type: "message", role: "user" })
  })

  test("expands assistant tool calls and tool outputs", () => {
    const items = toInputItems([
      new AIMessage({
        content: "Working on it.",
        tool_calls: [{ name: "lookup", args: { id: 1 } }],
      }),
      new ToolMessage({
        content: "42",
        tool_call_id: "call_1",
      }),
    ])

    expect(items[0]).toMatchObject({ type: "message", role: "assistant" })
    expect(items[1]).toMatchObject({ type: "function_call", name: "lookup" })
    expect(items[1]).toHaveProperty("call_id")
    expect(items[2]).toMatchObject({
      type: "function_call_output",
      call_id: "call_1",
      output: "42",
    })
  })

  test("finds and truncates the earliest stop token", () => {
    expect(findEarliestStopIndex("hello STOP world", ["world", "STOP"])).toBe(6)
    expect(truncateAtStop("hello STOP world", ["world", "STOP"])).toBe("hello ")
    expect(findEarliestStopIndex("hello", [""])).toBeUndefined()
  })
})

import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages"
import { describe, expect, test } from "vitest"

import {
  buildExtraInstructions,
  findEarliestStopIndex,
  toInputItems,
  truncateAtStop,
} from "../../src/converters/messages.js"

describe("message conversion", () => {
  test("prepends strict system prompts as developer messages", () => {
    const items = toInputItems(
      [new SystemMessage("Be terse."), new HumanMessage("hi")],
      "strict",
    )

    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ type: "message", role: "developer" })
    expect(JSON.stringify(items[0])).toContain("Be terse.")
    expect(items[1]).toMatchObject({ type: "message", role: "user" })
  })

  test("expands assistant tool calls and tool outputs", () => {
    const items = toInputItems(
      [
        new AIMessage({
          content: "Working on it.",
          tool_calls: [{ name: "lookup", args: { id: 1 } }],
        }),
        new ToolMessage({
          content: "42",
          tool_call_id: "call_1",
        }),
      ],
      "default",
    )

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

  test("truncates long extra instructions", () => {
    const instructions = buildExtraInstructions(["a".repeat(4_005)])

    expect(instructions).toContain("Conversation system prompt")
    expect(instructions).toContain("...")
    expect(instructions).not.toContain("a".repeat(4_005))
  })
})

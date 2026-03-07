import { describe, expect, test } from "vitest"

import {
  extractResponseMetadata,
  extractUsageMetadata,
  parseAssistantMessage,
} from "../../src/converters/responses.js"

describe("response conversion", () => {
  test("falls back to output_text when structured output is empty", () => {
    expect(
      parseAssistantMessage({
        output: [],
        output_text: "hello",
      }),
    ).toEqual({
      content: "hello",
      toolCalls: [],
      invalidToolCalls: [],
    })
  })

  test("collects invalid tool calls when arguments are malformed", () => {
    const parsed = parseAssistantMessage({
      output: [
        {
          type: "function_call",
          call_id: "call_1",
          name: "lookup",
          arguments: '{"bad":',
        },
      ],
    })

    expect(parsed.toolCalls).toEqual([])
    expect(parsed.invalidToolCalls).toHaveLength(1)
    expect(parsed.invalidToolCalls[0]).toMatchObject({
      id: "call_1",
      name: "lookup",
      args: '{"bad":',
    })
  })

  test("derives finish reasons from tool calls and incomplete responses", () => {
    expect(
      extractResponseMetadata({
        status: "completed",
        output: [{ type: "function_call", name: "lookup", arguments: "{}" }],
      }),
    ).toMatchObject({
      status: "completed",
      finish_reason: "tool_calls",
    })

    expect(
      extractResponseMetadata({
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
      }),
    ).toMatchObject({
      status: "incomplete",
      finish_reason: "length",
    })
  })

  test("extracts usage metadata when token counts are present", () => {
    expect(
      extractUsageMetadata({
        usage: {
          input_tokens: 3,
          output_tokens: 4,
          total_tokens: 7,
        },
      }),
    ).toEqual({
      input_tokens: 3,
      output_tokens: 4,
      total_tokens: 7,
    })
  })
})

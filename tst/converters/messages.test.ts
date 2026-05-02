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

  test("converts legacy image_url content blocks", () => {
    const items = toInputItems([
      new HumanMessage({
        content: [
          { type: "text", text: "What is this?" },
          { type: "image_url", image_url: "https://example.com/cat.png" },
        ],
      }),
    ])

    expect(items).toEqual([
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "What is this?" },
          {
            type: "input_image",
            image_url: "https://example.com/cat.png",
          },
        ],
      },
    ])
  })

  test("preserves image_url object detail", () => {
    const items = toInputItems([
      new HumanMessage({
        content: [
          {
            type: "image_url",
            image_url: {
              url: "data:image/png;base64,abc123",
              detail: "high",
            },
          },
        ],
      }),
    ])

    expect(items[0]).toMatchObject({
      type: "message",
      role: "user",
      content: [
        {
          type: "input_image",
          image_url: "data:image/png;base64,abc123",
          detail: "high",
        },
      ],
    })
  })

  test("converts standard image URL blocks", () => {
    const items = toInputItems([
      new HumanMessage({
        content: [
          { type: "text", text: "Look at this: " },
          {
            type: "image",
            url: "https://example.com/screenshot.png",
            metadata: { detail: "original" },
          },
          { type: "text", text: " done." },
        ],
      }),
    ])

    expect(items[0]).toMatchObject({
      content: [
        { type: "input_text", text: "Look at this: " },
        {
          type: "input_image",
          image_url: "https://example.com/screenshot.png",
          detail: "original",
        },
        { type: "input_text", text: " done." },
      ],
    })
  })

  test("converts standard base64 image blocks to data URLs", () => {
    const items = toInputItems([
      new HumanMessage({
        content: [
          {
            type: "image",
            data: Buffer.from("png bytes").toString("base64"),
            mimeType: "image/png",
          },
        ],
      }),
    ])

    expect(items[0]).toMatchObject({
      content: [
        {
          type: "input_image",
          image_url: `data:image/png;base64,${Buffer.from("png bytes").toString("base64")}`,
        },
      ],
    })
  })

  test("rejects invalid image block shapes", () => {
    expect(() =>
      toInputItems([
        new HumanMessage({
          content: [{ type: "image", data: "abc123" }],
        }),
      ]),
    ).toThrow("mimeType")

    expect(() =>
      toInputItems([
        new HumanMessage({
          content: [
            { type: "image", data: "abc123", mimeType: "application/pdf" },
          ],
        }),
      ]),
    ).toThrow("Unsupported image MIME type")

    expect(() =>
      toInputItems([
        new HumanMessage({
          content: [{ type: "image", fileId: "file_123" }],
        }),
      ]),
    ).toThrow("Image file IDs are not supported")
  })

  test("rejects unsupported multimodal block types", () => {
    expect(() =>
      toInputItems([
        new HumanMessage({
          content: [{ type: "audio", url: "https://example.com/audio.wav" }],
        }),
      ]),
    ).toThrow("Unsupported multimodal content block type: audio")
  })

  test("rejects image content in system-style messages", () => {
    expect(() =>
      buildInstructions([
        new SystemMessage({
          content: [
            { type: "text", text: "Inspect this." },
            { type: "image_url", image_url: "https://example.com/cat.png" },
          ],
        }),
      ]),
    ).toThrow("System messages do not support image content")

    expect(() =>
      buildInstructions([
        new ChatMessage(
          [
            { type: "text", text: "Inspect this." },
            { type: "image", url: "https://example.com/cat.png" },
          ],
          "developer",
        ),
      ]),
    ).toThrow("Developer messages do not support image content")
  })

  test("finds and truncates the earliest stop token", () => {
    expect(findEarliestStopIndex("hello STOP world", ["world", "STOP"])).toBe(6)
    expect(truncateAtStop("hello STOP world", ["world", "STOP"])).toBe("hello ")
    expect(findEarliestStopIndex("hello", [""])).toBeUndefined()
  })
})

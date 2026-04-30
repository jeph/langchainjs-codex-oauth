import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages"
import { describe, expect, test, vi } from "vitest"
import { z } from "zod"

import { ChatCodexOAuth } from "../../src/index.js"

describe("ChatCodexOAuth", () => {
  test("truncates stop sequences on invoke", async () => {
    const model = new ChatCodexOAuth({ model: "gpt-5.5" })
    vi.spyOn(model.client, "completeWithResponse").mockResolvedValue({
      parsed: {
        content: "hello STOP world",
        toolCalls: [],
        invalidToolCalls: [],
      },
      response: { output: [] },
    })

    const result = await model.invoke([new HumanMessage("hi")], {
      stop: ["STOP"],
    })

    expect(result.content).toBe("hello ")
  })

  test("passes system prompts as top-level instructions", async () => {
    const model = new ChatCodexOAuth({ model: "gpt-5.5" })
    let captured: Record<string, unknown> | undefined

    vi.spyOn(model.client, "completeWithResponse").mockImplementation(
      async (input) => {
        captured = input as unknown as Record<string, unknown>
        return {
          parsed: {
            content: "ok",
            toolCalls: [],
            invalidToolCalls: [],
          },
          response: { output: [], status: "completed" },
        }
      },
    )

    await model.invoke([
      new SystemMessage("You are a router."),
      new HumanMessage("hi"),
    ])

    expect(captured?.instructions).toBe("You are a router.")
    const inputItems = captured?.inputItems as
      | Array<Record<string, unknown>>
      | undefined
    expect(inputItems?.[0]?.role).toBe("user")
  })

  test("sends empty instructions when no system prompt is present", async () => {
    const model = new ChatCodexOAuth({ model: "gpt-5.5" })
    let captured: Record<string, unknown> | undefined

    vi.spyOn(model.client, "completeWithResponse").mockImplementation(
      async (input) => {
        captured = input as unknown as Record<string, unknown>
        return {
          parsed: {
            content: "ok",
            toolCalls: [],
            invalidToolCalls: [],
          },
          response: { output: [], status: "completed" },
        }
      },
    )

    await model.invoke([new HumanMessage("hi")])

    expect(captured?.instructions).toBe("")
  })

  test("passes per-call request overrides on invoke", async () => {
    const model = new ChatCodexOAuth({
      model: "gpt-5.5",
      reasoningEffort: "medium",
      textVerbosity: "medium",
      include: ["reasoning.encrypted_content"],
    })
    let captured: Record<string, unknown> | undefined

    vi.spyOn(model.client, "completeWithResponse").mockImplementation(
      async (input) => {
        captured = input as unknown as Record<string, unknown>
        return {
          parsed: {
            content: "ok",
            toolCalls: [],
            invalidToolCalls: [],
          },
          response: { output: [], status: "completed" },
        }
      },
    )

    await model.invoke([new HumanMessage("hi")], {
      reasoningEffort: "low",
      reasoningSummary: "concise",
      textVerbosity: "high",
      serviceTier: "priority",
      include: ["custom.include"],
    })

    expect(captured).toMatchObject({
      reasoningEffort: "low",
      reasoningSummary: "concise",
      textVerbosity: "high",
      serviceTier: "priority",
      include: ["custom.include"],
    })
  })

  test("configures prompt caching on the underlying client", () => {
    const defaultModel = new ChatCodexOAuth({ model: "gpt-5.5" })
    const disabledModel = new ChatCodexOAuth({
      model: "gpt-5.5",
      promptCaching: false,
    })
    const keyedModel = new ChatCodexOAuth({
      model: "gpt-5.5",
      promptCacheKey: "chat-cache-key",
    })

    expect(defaultModel.client.promptCaching).toBe(true)
    expect(defaultModel.client.promptCacheKey).toEqual(
      expect.stringMatching(/^lcjs-codex-/u),
    )
    expect(disabledModel.client.promptCaching).toBe(false)
    expect(keyedModel.client.promptCacheKey).toBe("chat-cache-key")
  })

  test("passes per-call prompt cache overrides", async () => {
    const model = new ChatCodexOAuth({ model: "gpt-5.5" })
    const captured: Record<string, unknown>[] = []

    vi.spyOn(model.client, "completeWithResponse").mockImplementation(
      async (input) => {
        captured.push(input as unknown as Record<string, unknown>)
        return {
          parsed: {
            content: "ok",
            toolCalls: [],
            invalidToolCalls: [],
          },
          response: { output: [], status: "completed" },
        }
      },
    )

    await model.invoke([new HumanMessage("hi")], {
      promptCaching: false,
    })
    await model.invoke([new HumanMessage("hi")], {
      promptCacheKey: "call-cache-key",
    })

    expect(captured[0]).toMatchObject({ promptCaching: false })
    expect(captured[1]).toMatchObject({ promptCacheKey: "call-cache-key" })
  })

  test("prompt caching does not mutate converted conversation context", async () => {
    const messages = [
      new SystemMessage("You are a careful agent."),
      new HumanMessage("Find the inventory count."),
      new AIMessage({
        content: "I will look it up.",
        tool_calls: [
          {
            id: "call_lookup",
            name: "lookup_inventory",
            args: { sku: "abc" },
          },
        ],
      }),
      new ToolMessage({
        content: "42 units",
        tool_call_id: "call_lookup",
      }),
      new HumanMessage("Now answer from the tool result."),
    ]
    const model = new ChatCodexOAuth({ model: "gpt-5.5" })
    const captured: Record<string, unknown>[] = []

    vi.spyOn(model.client, "completeWithResponse").mockImplementation(
      async (input) => {
        captured.push(input as unknown as Record<string, unknown>)
        return {
          parsed: {
            content: "ok",
            toolCalls: [],
            invalidToolCalls: [],
          },
          response: { output: [], status: "completed" },
        }
      },
    )

    await model.invoke(messages, { promptCacheKey: "call-cache-key" })
    await model.invoke(messages, { promptCaching: false })

    expect(captured[0]?.promptCacheKey).toBe("call-cache-key")
    expect(captured[1]?.promptCaching).toBe(false)
    expect(captured[0]?.instructions).toBe(captured[1]?.instructions)
    expect(captured[0]?.inputItems).toEqual(captured[1]?.inputItems)
  })

  test("recovers streamed text on invoke when terminal output is empty", async () => {
    const model = new ChatCodexOAuth({ model: "gpt-5.5" })

    vi.spyOn(model.client, "streamEvents").mockImplementation(
      async function* () {
        yield { type: "response.output_text.delta", delta: "I" }
        yield { type: "response.output_text.delta", delta: " love" }
        yield { type: "response.output_text.delta", delta: " you" }
        yield {
          type: "response.done",
          response: { output: [], status: "completed" },
        }
      },
    )

    const result = await model.invoke([new HumanMessage("hi")])

    expect(result.content).toBe("I love you")
  })

  test("recovers streamed tool calls on invoke when terminal output is empty", async () => {
    const model = new ChatCodexOAuth({ model: "gpt-5.5" })

    vi.spyOn(model.client, "streamEvents").mockImplementation(
      async function* () {
        yield {
          type: "response.output_item.added",
          output_index: 0,
          item: {
            type: "function_call",
            call_id: "call_123",
            name: "Answer",
          },
        }
        yield {
          type: "response.function_call_arguments.delta",
          output_index: 0,
          call_id: "call_123",
          delta: '{"answer": ',
        }
        yield {
          type: "response.function_call_arguments.delta",
          output_index: 0,
          call_id: "call_123",
          delta: '"hi"}',
        }
        yield {
          type: "response.done",
          response: { output: [], status: "completed" },
        }
      },
    )

    const result = await model.invoke([new HumanMessage("hi")])

    expect(result.tool_calls?.[0]).toMatchObject({
      id: "call_123",
      name: "Answer",
      args: { answer: "hi" },
    })
  })

  test("parses direct withStructuredOutput without includeRaw", async () => {
    const model = new ChatCodexOAuth({ model: "gpt-5.5" })
    const ContactInfo = z.object({
      name: z.string(),
      email: z.string(),
    })

    vi.spyOn(model.client, "completeWithResponse").mockResolvedValue({
      parsed: {
        content: "",
        toolCalls: [
          {
            type: "tool_call",
            name: "extract",
            args: {
              name: "Jane Roe",
              email: "jane@example.com",
            },
          },
        ],
        invalidToolCalls: [],
      },
      response: { output: [], status: "completed" },
    })

    const result = await model
      .withStructuredOutput(ContactInfo)
      .invoke([new HumanMessage("Extract the contact info.")])

    expect(result).toEqual({
      name: "Jane Roe",
      email: "jane@example.com",
    })
  })

  test("parses direct withStructuredOutput with includeRaw", async () => {
    const model = new ChatCodexOAuth({ model: "gpt-5.5" })
    const ContactInfo = z.object({
      name: z.string(),
      email: z.string(),
    })

    vi.spyOn(model.client, "completeWithResponse").mockResolvedValue({
      parsed: {
        content: "",
        toolCalls: [
          {
            type: "tool_call",
            name: "extract",
            args: {
              name: "Jane Roe",
              email: "jane@example.com",
            },
          },
        ],
        invalidToolCalls: [],
      },
      response: { output: [], status: "completed" },
    })

    const result = await model
      .withStructuredOutput(ContactInfo, { includeRaw: true })
      .invoke([new HumanMessage("Extract the contact info.")])

    expect(AIMessage.isInstance(result.raw)).toBe(true)
    expect(
      AIMessage.isInstance(result.raw)
        ? result.raw.tool_calls?.[0]?.name
        : null,
    ).toBe("extract")
    expect(result.parsed).toEqual({
      name: "Jane Roe",
      email: "jane@example.com",
    })
  })

  test("emits tool call chunks while streaming", async () => {
    const model = new ChatCodexOAuth({ model: "gpt-5.5" })

    vi.spyOn(model.client, "streamEvents").mockImplementation(
      async function* () {
        yield {
          type: "response.output_item.added",
          output_index: 0,
          item: {
            type: "function_call",
            call_id: "call_123",
            name: "Answer",
          },
        }
        yield {
          type: "response.function_call_arguments.delta",
          output_index: 0,
          call_id: "call_123",
          delta: '{"answer": ',
        }
        yield {
          type: "response.function_call_arguments.delta",
          output_index: 0,
          call_id: "call_123",
          delta: '"hi"}',
        }
        yield {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                call_id: "call_123",
                name: "Answer",
                arguments: '{"answer":"hi"}',
              },
            ],
            status: "completed",
          },
        }
      },
    )

    const chunks = []

    for await (const chunk of await model.stream([new HumanMessage("hi")])) {
      chunks.push(chunk)
    }

    const deltaChunks = chunks.filter(
      (chunk) =>
        Array.isArray(chunk.tool_call_chunks) &&
        chunk.tool_call_chunks.length > 0,
    )
    expect(deltaChunks).toHaveLength(2)
    expect(deltaChunks[0]?.tool_call_chunks?.[0]?.id).toBe("call_123")
    expect(chunks.at(-1)?.tool_calls?.[0]?.id).toBe("call_123")
  })

  test("maps item_id tool deltas to the final call_id while streaming", async () => {
    const model = new ChatCodexOAuth({ model: "gpt-5.5" })

    vi.spyOn(model.client, "streamEvents").mockImplementation(
      async function* () {
        yield {
          type: "response.output_item.added",
          output_index: 1,
          item: {
            id: "fc_123",
            type: "function_call",
            call_id: "call_123",
            name: "Answer",
          },
        }
        yield {
          type: "response.function_call_arguments.delta",
          output_index: 1,
          item_id: "fc_123",
          delta: '{"',
        }
        yield {
          type: "response.function_call_arguments.delta",
          output_index: 1,
          item_id: "fc_123",
          delta: 'answer":"hi"}',
        }
        yield {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                call_id: "call_123",
                name: "Answer",
                arguments: '{"answer":"hi"}',
              },
            ],
            status: "completed",
          },
        }
      },
    )

    const chunks = []

    for await (const chunk of await model.stream([new HumanMessage("hi")])) {
      chunks.push(chunk)
    }

    const deltaChunks = chunks.filter(
      (chunk) =>
        Array.isArray(chunk.tool_call_chunks) &&
        chunk.tool_call_chunks.length > 0,
    )
    const streamedArgs = deltaChunks.flatMap(
      (chunk) =>
        chunk.tool_call_chunks?.map(
          (toolCallChunk) => toolCallChunk.args ?? "",
        ) ?? [],
    )

    expect(deltaChunks).toHaveLength(2)
    expect(deltaChunks[0]?.tool_call_chunks?.[0]?.id).toBe("call_123")
    expect(JSON.parse(streamedArgs.join(""))).toEqual({ answer: "hi" })
    expect(chunks.at(-1)?.tool_calls?.[0]?.id).toBe("call_123")
  })

  test("truncates stop sequences while streaming", async () => {
    const model = new ChatCodexOAuth({ model: "gpt-5.5" })

    vi.spyOn(model.client, "streamEvents").mockImplementation(
      async function* () {
        yield { type: "response.output_text.delta", delta: "hello " }
        yield { type: "response.output_text.delta", delta: "ST" }
        yield { type: "response.output_text.delta", delta: "OP world" }
        yield {
          type: "response.done",
          response: { output: [], status: "completed" },
        }
      },
    )

    const parts: string[] = []

    for await (const chunk of await model.stream([new HumanMessage("hi")], {
      stop: ["STOP"],
    })) {
      if (typeof chunk.content === "string" && chunk.content.length > 0) {
        parts.push(chunk.content)
      }
    }

    expect(parts.join("")).toBe("hello ")
  })

  test("streams many response events without growing the call stack", async () => {
    const model = new ChatCodexOAuth({ model: "gpt-5.5" })

    vi.spyOn(model.client, "streamEvents").mockImplementation(
      async function* () {
        for (let index = 0; index < 12_000; index += 1) {
          yield { type: "response.output_text.delta", delta: "x" }
        }

        yield {
          type: "response.done",
          response: { output: [], status: "completed" },
        }
      },
    )

    let count = 0

    for await (const chunk of await model.stream([new HumanMessage("hi")])) {
      if (typeof chunk.content === "string" && chunk.content.length > 0) {
        count += chunk.content.length
      }
    }

    expect(count).toBe(12_000)
  })

  test("passes per-call request overrides while streaming", async () => {
    const model = new ChatCodexOAuth({
      model: "gpt-5.5",
      reasoningEffort: "medium",
      textVerbosity: "medium",
      include: ["reasoning.encrypted_content"],
    })
    let captured: Record<string, unknown> | undefined

    vi.spyOn(model.client, "streamEvents").mockImplementation(
      async function* (input) {
        captured = input as unknown as Record<string, unknown>
        yield {
          type: "response.done",
          response: { output: [], status: "completed" },
        }
      },
    )

    for await (const _chunk of await model.stream([new HumanMessage("hi")], {
      reasoningEffort: "low",
      reasoningSummary: "concise",
      textVerbosity: "high",
      include: ["custom.include"],
    })) {
      // Exhaust the stream.
    }

    expect(captured).toMatchObject({
      reasoningEffort: "low",
      reasoningSummary: "concise",
      textVerbosity: "high",
      include: ["custom.include"],
    })
  })
})

import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages"
import { describe, expect, test, vi } from "vitest"
import { z } from "zod"

import { ChatCodexOAuth } from "../../src/index.js"

describe("ChatCodexOAuth", () => {
  test("truncates stop sequences on invoke", async () => {
    const model = new ChatCodexOAuth({ model: "gpt-5.2-codex" })
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
    const model = new ChatCodexOAuth({ model: "gpt-5.2-codex" })
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
    const model = new ChatCodexOAuth({ model: "gpt-5.2-codex" })
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
      model: "gpt-5.2-codex",
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
      include: ["custom.include"],
    })

    expect(captured).toMatchObject({
      reasoningEffort: "low",
      reasoningSummary: "concise",
      textVerbosity: "high",
      include: ["custom.include"],
    })
  })

  test("parses direct withStructuredOutput without includeRaw", async () => {
    const model = new ChatCodexOAuth({ model: "gpt-5.2-codex" })
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
    const model = new ChatCodexOAuth({ model: "gpt-5.2-codex" })
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
    const model = new ChatCodexOAuth({ model: "gpt-5.2-codex" })

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
    const model = new ChatCodexOAuth({ model: "gpt-5.2-codex" })

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
    const model = new ChatCodexOAuth({ model: "gpt-5.2-codex" })

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

  test("passes per-call request overrides while streaming", async () => {
    const model = new ChatCodexOAuth({
      model: "gpt-5.2-codex",
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

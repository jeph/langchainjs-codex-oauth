import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { describe, expect, test, vi } from "vitest";

import { ChatCodexOAuth } from "../index.js";

describe("ChatCodexOAuth", () => {
  test("truncates stop sequences on invoke", async () => {
    const model = new ChatCodexOAuth({ model: "gpt-5.2-codex" });
    vi.spyOn(model.client, "completeWithResponse").mockResolvedValue({
      parsed: {
        content: "hello STOP world",
        toolCalls: [],
        invalidToolCalls: [],
      },
      response: { output: [] },
    });

    const result = await model.invoke([new HumanMessage("hi")], {
      stop: ["STOP"],
    });

    expect(result.content).toBe("hello ");
  });

  test("passes strict system prompts as extra instructions", async () => {
    const model = new ChatCodexOAuth({
      model: "gpt-5.2-codex",
      systemPromptMode: "strict",
    });
    let captured: Record<string, unknown> | undefined;

    vi.spyOn(model.client, "completeWithResponse").mockImplementation(
      async (input) => {
        captured = input as unknown as Record<string, unknown>;
        return {
          parsed: {
            content: "ok",
            toolCalls: [],
            invalidToolCalls: [],
          },
          response: { output: [], status: "completed" },
        };
      },
    );

    await model.invoke([
      new SystemMessage("You are a router."),
      new HumanMessage("hi"),
    ]);

    expect(captured?.extraInstructions).toEqual(
      expect.stringContaining("router"),
    );
    const inputItems = captured?.inputItems as
      | Array<Record<string, unknown>>
      | undefined;
    expect(inputItems?.[0]?.role).toBe("developer");
  });

  test("emits tool call chunks while streaming", async () => {
    const model = new ChatCodexOAuth({ model: "gpt-5.2-codex" });

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
        };
        yield {
          type: "response.function_call_arguments.delta",
          output_index: 0,
          call_id: "call_123",
          delta: '{"answer": ',
        };
        yield {
          type: "response.function_call_arguments.delta",
          output_index: 0,
          call_id: "call_123",
          delta: '"hi"}',
        };
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
        };
      },
    );

    const chunks = [];

    for await (const chunk of await model.stream([new HumanMessage("hi")])) {
      chunks.push(chunk);
    }

    const deltaChunks = chunks.filter(
      (chunk) =>
        Array.isArray(chunk.tool_call_chunks) &&
        chunk.tool_call_chunks.length > 0,
    );
    expect(deltaChunks).toHaveLength(2);
    expect(deltaChunks[0]?.tool_call_chunks?.[0]?.id).toBe("call_123");
    expect(chunks.at(-1)?.tool_calls?.[0]?.id).toBe("call_123");
  });

  test("truncates stop sequences while streaming", async () => {
    const model = new ChatCodexOAuth({ model: "gpt-5.2-codex" });

    vi.spyOn(model.client, "streamEvents").mockImplementation(
      async function* () {
        yield { type: "response.output_text.delta", delta: "hello " };
        yield { type: "response.output_text.delta", delta: "ST" };
        yield { type: "response.output_text.delta", delta: "OP world" };
        yield {
          type: "response.done",
          response: { output: [], status: "completed" },
        };
      },
    );

    const parts: string[] = [];

    for await (const chunk of await model.stream([new HumanMessage("hi")], {
      stop: ["STOP"],
    })) {
      if (typeof chunk.content === "string" && chunk.content.length > 0) {
        parts.push(chunk.content);
      }
    }

    expect(parts.join("")).toBe("hello ");
  });
});

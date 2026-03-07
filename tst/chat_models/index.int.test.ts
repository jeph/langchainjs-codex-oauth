import { existsSync } from "node:fs";

import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import {
  END,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { createAgent } from "langchain";
import { describe, expect, test } from "vitest";
import { tool } from "langchain";
import { z } from "zod";

import { defaultAuthPath } from "../../src/auth/store.js";
import { ChatCodexOAuth } from "../../src/chat_models/index.js";

const hasAuth = existsSync(defaultAuthPath());
const modelName = process.env.LANGCHAINJS_CODEX_OAUTH_MODEL ?? "gpt-5.2-codex";

function textOf(content: unknown): string {
  return typeof content === "string" ? content : JSON.stringify(content);
}

function createModel(
  overrides: ConstructorParameters<typeof ChatCodexOAuth>[0] = {},
): ChatCodexOAuth {
  return new ChatCodexOAuth({
    model: modelName,
    maxTokens: 120,
    ...overrides,
  });
}

function createAddTool() {
  return tool(async ({ a, b }) => `${a + b}`, {
    name: "add_numbers",
    description: "Add two integers.",
    schema: z.object({
      a: z.number().int(),
      b: z.number().int(),
    }),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function expectSingleToolCall(message: AIMessage | AIMessageChunk) {
  expect(message.tool_calls?.length).toBeGreaterThan(0);
  const call = message.tool_calls?.[0];

  expect(call?.id).toBeTruthy();
  expect(call?.name).toBe("add_numbers");
  return call!;
}

describe.skipIf(!hasAuth)("ChatCodexOAuth live integration", () => {
  test("invokes the live backend", async () => {
    const model = createModel({ maxTokens: 80 });

    const result = await model.invoke([
      new SystemMessage("You are a concise assistant."),
      new HumanMessage("Say hello in one short sentence."),
    ]);

    expect(result.text.length).toBeGreaterThan(0);
    expect(isRecord(result.response_metadata)).toBe(true);
    expect(result.usage_metadata?.total_tokens).toBeGreaterThan(0);
  });

  test("streams text from the live backend", async () => {
    const model = createModel({ maxTokens: 80 });
    const parts: string[] = [];

    for await (const chunk of await model.stream("Say hello in three words.")) {
      if (typeof chunk.content === "string" && chunk.content.length > 0) {
        parts.push(chunk.content);
      }
    }

    expect(parts.join("").length).toBeGreaterThan(0);
  });

  test("batches invocations through LangChain", async () => {
    const model = createModel({ maxTokens: 40 });

    const results = await model.batch([
      [new HumanMessage("Reply with the single word alpha.")],
      [new HumanMessage("Reply with the single word beta.")],
    ]);

    expect(results).toHaveLength(2);
    expect(textOf(results[0]?.content).toLowerCase()).toContain("alpha");
    expect(textOf(results[1]?.content).toLowerCase()).toContain("beta");
  });

  test("supports direct tool calling roundtrip through bindTools", async () => {
    const add = createAddTool();
    const model = createModel({ maxTokens: 160 });
    const prompt =
      "What is 17 + 25? Use the add_numbers tool before answering.";
    const first = await model
      .bindTools([add], { tool_choice: "add_numbers" })
      .invoke([new HumanMessage(prompt)]);
    const call = expectSingleToolCall(first);
    const output = await add.invoke(call);
    const toolMessage =
      typeof output === "string"
        ? new ToolMessage({
            content: output,
            tool_call_id: call.id!,
          })
        : output;

    const final = await model.invoke([
      new HumanMessage(prompt),
      first,
      toolMessage,
    ]);

    expect(textOf(final.content)).toContain("42");
  });

  test("streams a tool-calling response from the live backend", async () => {
    const add = createAddTool();
    const model = createModel({ maxTokens: 160 }).bindTools([add], {
      tool_choice: "add_numbers",
    });
    const chunks: AIMessageChunk[] = [];

    for await (const chunk of await model.stream(
      "What is 19 + 23? Use the add_numbers tool before answering.",
    )) {
      chunks.push(chunk);
    }

    const full = chunks.reduce<AIMessageChunk | null>(
      (acc, chunk) => (acc ? acc.concat(chunk) : chunk),
      null,
    );

    expect(full?.tool_calls?.[0]?.name).toBe("add_numbers");
  });

  test("works in a LangGraph-backed agent loop", async () => {
    const add = createAddTool();

    const agent = createAgent({
      model: createModel({ maxTokens: 140 }),
      tools: [add],
      systemPrompt:
        "You must use the add_numbers tool for arithmetic and return only the final answer.",
    });

    const result = await agent.invoke({
      messages: "What is 21 + 21?",
    });
    const last = result.messages.at(-1);
    const toolMessages = result.messages.filter((message) =>
      ToolMessage.isInstance(message),
    );

    expect(toolMessages.length).toBeGreaterThan(0);
    expect(textOf(last?.content)).toContain("42");
  });

  test("returns structuredResponse from createAgent responseFormat", async () => {
    const ContactInfo = z.object({
      name: z.string(),
      email: z.string(),
    });
    const agent = createAgent({
      model: createModel({ maxTokens: 140 }),
      responseFormat: ContactInfo,
    });

    const result = await agent.invoke({
      messages: [
        new HumanMessage(
          "Extract the contact info from: Jane Roe, jane@example.com.",
        ),
      ],
    });

    const structured = result.structuredResponse;

    expect(isRecord(structured)).toBe(true);
    expect(String(structured?.name).toLowerCase()).toContain("jane");
    expect(String(structured?.email).toLowerCase()).toContain(
      "jane@example.com",
    );
  });

  test("works in a raw LangGraph StateGraph tool loop", async () => {
    const add = createAddTool();
    const llm = createModel({ maxTokens: 180 }).bindTools([add]);
    const graph = new StateGraph(MessagesAnnotation)
      .addNode("llm", async (state) => ({
        messages: [
          await llm.invoke([
            new SystemMessage(
              "You must use the add_numbers tool for arithmetic.",
            ),
            ...state.messages,
          ]),
        ],
      }))
      .addNode("tools", new ToolNode([add]))
      .addEdge(START, "llm")
      .addConditionalEdges("llm", (state) => {
        const last = state.messages.at(-1);

        if (AIMessage.isInstance(last) && (last.tool_calls?.length ?? 0) > 0) {
          return "tools";
        }

        return END;
      })
      .addEdge("tools", "llm")
      .compile();

    const result = await graph.invoke({
      messages: [
        new HumanMessage(
          "What is 30 + 12? Use the add_numbers tool and answer briefly.",
        ),
      ],
    });
    const last = result.messages.at(-1);

    expect(
      result.messages.some((message: BaseMessage) =>
        ToolMessage.isInstance(message),
      ),
    ).toBe(true);
    expect(textOf(last?.content)).toContain("42");
  });

  test("streams LangGraph message chunks from model nodes", async () => {
    const model = createModel({ maxTokens: 80 });
    const graph = new StateGraph(MessagesAnnotation)
      .addNode("model", async (state) => ({
        messages: [
          await model.invoke([
            new SystemMessage("You are a concise assistant."),
            ...state.messages,
          ]),
        ],
      }))
      .addEdge(START, "model")
      .compile();
    const parts: string[] = [];
    const nodes = new Set<string>();

    for await (const [chunk, metadata] of await graph.stream(
      {
        messages: [new HumanMessage("Say hello in three words.")],
      },
      { streamMode: "messages" },
    )) {
      if (typeof chunk.content === "string" && chunk.content.length > 0) {
        parts.push(chunk.content);
      }

      if (isRecord(metadata) && typeof metadata.langgraph_node === "string") {
        nodes.add(metadata.langgraph_node);
      }
    }

    expect(parts.join("").length).toBeGreaterThan(0);
    expect(nodes.has("model")).toBe(true);
  });
});

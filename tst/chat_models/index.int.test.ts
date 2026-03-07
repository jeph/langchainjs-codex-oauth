import { existsSync } from "node:fs";

import { HumanMessage } from "@langchain/core/messages";
import { tool } from "langchain";
import { createAgent } from "langchain";
import { describe, expect, test } from "vitest";
import { z } from "zod";

import { defaultAuthPath } from "../../src/auth/store.js";
import { ChatCodexOAuth } from "../../src/chat_models/index.js";

const hasAuth = existsSync(defaultAuthPath());

function textOf(content: unknown): string {
  return typeof content === "string" ? content : JSON.stringify(content);
}

describe.skipIf(!hasAuth)("ChatCodexOAuth live integration", () => {
  test("invokes the live backend", async () => {
    const model = new ChatCodexOAuth({
      model: process.env.LANGCHAINJS_CODEX_OAUTH_MODEL ?? "gpt-5.2-codex",
      maxTokens: 80,
    });

    const result = await model.invoke([
      new HumanMessage("Say hello in one short sentence."),
    ]);

    expect(result.text.length).toBeGreaterThan(0);
  });

  test("streams text from the live backend", async () => {
    const model = new ChatCodexOAuth({
      model: process.env.LANGCHAINJS_CODEX_OAUTH_MODEL ?? "gpt-5.2-codex",
      maxTokens: 80,
    });
    const parts: string[] = [];

    for await (const chunk of await model.stream("Say hello in three words.")) {
      if (typeof chunk.content === "string" && chunk.content.length > 0) {
        parts.push(chunk.content);
      }
    }

    expect(parts.join("").length).toBeGreaterThan(0);
  });

  test("works in a LangGraph-backed agent loop", async () => {
    const add = tool(async ({ a, b }) => `${a + b}`, {
      name: "add_numbers",
      description: "Add two integers.",
      schema: z.object({
        a: z.number().int(),
        b: z.number().int(),
      }),
    });

    const agent = createAgent({
      model: new ChatCodexOAuth({
        model: process.env.LANGCHAINJS_CODEX_OAUTH_MODEL ?? "gpt-5.2-codex",
        maxTokens: 140,
      }),
      tools: [add],
      systemPrompt:
        "You must use the add_numbers tool for arithmetic and return only the final answer.",
    });

    const result = await agent.invoke({
      messages: "What is 21 + 21?",
    });
    const last = result.messages.at(-1);

    expect(textOf(last?.content)).toContain("42");
  });
});

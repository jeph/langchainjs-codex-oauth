import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { ChatCodexOAuth } from "../../src/index.js";

const add = tool(async ({ a, b }) => JSON.stringify({ result: a + b }), {
  name: "add_numbers",
  description: "Add two integers and return the result.",
  schema: z.object({
    a: z.number().int(),
    b: z.number().int(),
  }),
});

const model = new ChatCodexOAuth({
  model: process.env.LANGCHAINJS_CODEX_OAUTH_MODEL ?? "gpt-5.2-codex",
  maxTokens: 180,
});
const prompt = "What is 17 + 25? Use the add_numbers tool before answering.";
const first = await model.bindTools([add]).invoke([new HumanMessage(prompt)]);

console.log("Initial assistant message:");
console.log(first.content);
console.log("Tool calls:", first.tool_calls);

const call = first.tool_calls?.[0];

if (!call?.id) {
  throw new Error("The model did not emit a tool call.");
}

const output = await add.invoke(call);
const toolMessage =
  typeof output === "string"
    ? new ToolMessage({
        content: output,
        tool_call_id: call.id,
      })
    : output;

const final = await model.invoke([
  new HumanMessage(prompt),
  first,
  toolMessage,
]);

console.log("Final answer:");
console.log(final.text);

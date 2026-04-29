import {
  AIMessage,
  HumanMessage,
  type BaseMessage,
} from "@langchain/core/messages"
import { tool } from "@langchain/core/tools"
import {
  END,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph"
import { ToolNode } from "@langchain/langgraph/prebuilt"
import { z } from "zod"

import { ChatCodexOAuth } from "../../src/index.js"

const add = tool(async ({ a, b }) => `${a + b}`, {
  name: "add_numbers",
  description: "Add two integers.",
  schema: z.object({
    a: z.number().int(),
    b: z.number().int(),
  }),
})

const llm = new ChatCodexOAuth({
  model: process.env.LANGCHAINJS_CODEX_OAUTH_MODEL ?? "gpt-5.5",
  maxTokens: 180,
}).bindTools([add])

const tools = new ToolNode([add])

const workflow = new StateGraph(MessagesAnnotation)
  .addNode("llm", async (state) => ({
    messages: [await llm.invoke(state.messages)],
  }))
  .addNode("tools", tools)
  .addEdge(START, "llm")
  .addEdge("tools", "llm")
  .addConditionalEdges("llm", (state) => {
    const last = state.messages.at(-1)

    if (AIMessage.isInstance(last) && (last.tool_calls?.length ?? 0) > 0) {
      return "tools"
    }

    return END
  })

const app = workflow.compile()
const result = await app.invoke({
  messages: [
    new HumanMessage(
      "What is 42 + 58? Use the add_numbers tool and answer briefly.",
    ),
  ],
})

console.log("Conversation transcript:")
for (const [index, message] of result.messages.entries()) {
  console.log(`${index}. ${formatMessage(message)}`)
}

function formatMessage(message: BaseMessage): string {
  const text =
    typeof message.content === "string"
      ? message.content
      : JSON.stringify(message.content)

  return `${message.getType()}: ${text}`
}

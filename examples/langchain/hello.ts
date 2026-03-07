import { HumanMessage, SystemMessage } from "@langchain/core/messages"

import { ChatCodexOAuth } from "../../src/index.js"

const model = new ChatCodexOAuth({
  model: process.env.LANGCHAINJS_CODEX_OAUTH_MODEL ?? "gpt-5.4",
  maxTokens: 120,
})

const result = await model.invoke([
  new SystemMessage("You are a concise coding assistant."),
  new HumanMessage(
    "Say hello in one sentence and include exactly one short TypeScript tip.",
  ),
])

console.log(result.text)

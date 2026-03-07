# langchainjs-codex-oauth

Use ChatGPT Codex models through OAuth inside LangChainJS and LangGraph.

> [!IMPORTANT]
> This project is still in active development. Expect bugs, rough edges, and occasional breaking changes while the package stabilizes. [Issues](https://github.com/jeph/langchainjs-codex-oauth/issues) and [pull requests](https://github.com/jeph/langchainjs-codex-oauth/pulls) are very welcome.

## What it does

- Exposes a `ChatCodexOAuth` chat model implemented in TypeScript.
- Authenticates locally with ChatGPT OAuth instead of an API key.
- Stores credentials under `~/.langchainjs-codex-oauth/` by default.
- Refreshes expired access tokens automatically.
- Streams text responses and tool-call chunks from the ChatGPT Codex backend.
- Supports direct `bindTools(...)`, `withStructuredOutput(...)`, LangChain agents, and LangGraph workflows.

## Requirements

- Node.js `>=20`
- A ChatGPT account with access to Codex-capable models

## Install

For the core library:

```bash
pnpm add langchainjs-codex-oauth @langchain/core
```

Optional packages used by the examples in this README:

```bash
pnpm add langchain @langchain/langgraph zod
```

## Authenticate

```bash
npx langchainjs-codex-oauth auth login
```

If your browser cannot open automatically, localhost port `1455` is busy, or you want to finish the OAuth flow by hand:

```bash
npx langchainjs-codex-oauth auth login --manual
```

Other useful commands:

```bash
npx langchainjs-codex-oauth auth status
npx langchainjs-codex-oauth auth logout
```

For local development in this repository:

```bash
pnpm auth:login
pnpm auth:status
pnpm auth:logout
```

Notes:

- The automatic flow starts a local callback server at `http://localhost:1455/auth/callback`.
- `auth login --manual` accepts either the full redirect URL or the raw authorization code.
- Credentials are stored in `~/.langchainjs-codex-oauth/auth/openai.json` by default.
- Expired access tokens are refreshed automatically and written back to the auth file.

## Quickstart

```ts
import { HumanMessage, SystemMessage } from "@langchain/core/messages"
import { ChatCodexOAuth } from "langchainjs-codex-oauth"

const model = new ChatCodexOAuth({
  model: "gpt-5.2-codex",
})

const result = await model.invoke([
  new SystemMessage("You are a concise coding assistant."),
  new HumanMessage("Say hello and give one TypeScript tip."),
])

console.log(result.text)
```

`ChatCodexOAuth` also supports `.stream(...)`, `.batch(...)`, `.bindTools(...)`, and `.withStructuredOutput(...)`.

## Tool Calling

```ts
import { HumanMessage, ToolMessage } from "@langchain/core/messages"
import { tool } from "@langchain/core/tools"
import { z } from "zod"
import { ChatCodexOAuth } from "langchainjs-codex-oauth"

const add = tool(async ({ a, b }) => `${a + b}`, {
  name: "add_numbers",
  description: "Add two integers and return the result.",
  schema: z.object({
    a: z.number().int(),
    b: z.number().int(),
  }),
})

const model = new ChatCodexOAuth({ model: "gpt-5.2-codex" }).bindTools([add])
const prompt = "What is 17 + 25? Use the add_numbers tool before answering."
const first = await model.invoke([new HumanMessage(prompt)])
const call = first.tool_calls?.[0]

if (!call?.id) {
  throw new Error("The model did not emit a tool call.")
}

const output = await add.invoke(call)
const toolMessage =
  typeof output === "string"
    ? new ToolMessage({
        content: output,
        tool_call_id: call.id,
      })
    : output

const final = await model.invoke([new HumanMessage(prompt), first, toolMessage])

console.log(final.text)
```

Streaming tool calls is also supported. While streaming, the model emits tool-call argument deltas before the final `tool_calls` array is assembled.

## Structured Output

```ts
import { z } from "zod"
import { ChatCodexOAuth } from "langchainjs-codex-oauth"

const ContactInfo = z.object({
  name: z.string(),
  email: z.string(),
})

const model = new ChatCodexOAuth({
  model: "gpt-5.2-codex",
}).withStructuredOutput(ContactInfo)

const result = await model.invoke(
  "Extract the contact info from: Jane Roe, jane@example.com.",
)

console.log(result)
```

Structured output works through function calling. `includeRaw: true` is also supported when you want both the parsed payload and the raw `AIMessage`.

## LangGraph

`ChatCodexOAuth` works in LangGraph agent loops and raw `StateGraph` workflows. See `examples/langgraph/agent.ts` and `examples/README.md` for a runnable example.

## Configuration

Constructor options:

- `model`: model name to request, default `gpt-5.2-codex`
- `temperature`
- `maxTokens`
- `reasoningEffort`
- `reasoningSummary`
- `textVerbosity`
- `include`
- `timeout`: request timeout in milliseconds
- `maxRetries`
- `baseURL`
- `authPath`
- `systemPromptMode`: `strict` (default), `default`, or `disabled`

Environment variables:

- `LANGCHAINJS_CODEX_OAUTH_BASE_URL`
- `LANGCHAINJS_CODEX_OAUTH_TEMPERATURE`
- `LANGCHAINJS_CODEX_OAUTH_MAX_TOKENS`
- `LANGCHAINJS_CODEX_OAUTH_TIMEOUT_S`
- `LANGCHAINJS_CODEX_OAUTH_MAX_RETRIES`
- `LANGCHAINJS_CODEX_OAUTH_HOME`
- `LANGCHAINJS_CODEX_OAUTH_AUTH_PATH`
- `LANGCHAINJS_CODEX_OAUTH_INSTRUCTIONS_MODE`

`systemPromptMode` controls how system and developer messages are passed through:

- `strict`: treats system prompts as highest priority and mirrors them into extra instructions
- `default`: forwards system and developer messages as normal developer content
- `disabled`: drops system and developer messages entirely

`LANGCHAINJS_CODEX_OAUTH_INSTRUCTIONS_MODE` accepts `auto`, `cache`, `github`, or `bundled`.

- `auto`: use cached Codex instructions when present, otherwise fall back to GitHub or the bundled fallback
- `cache`: require a cached instruction file
- `github`: always fetch the latest instruction file from the `openai/codex` release
- `bundled`: use the built-in fallback prompt

## Examples

```bash
pnpm example:hello
pnpm example:tools
pnpm example:agent
```

See `examples/README.md` for details.

## Live integration tests

```bash
pnpm test:int
```

These tests are skipped automatically when the local auth file is missing.

## Release validation

```bash
pnpm build:release
```

This runs the full release gate: clean, lint, typecheck, unit tests, live integration tests, extended live integration tests, and the final distribution build.

## Notes

- This package is Node-only.
- The package keeps its own auth store and does not read Codex/OpenCode credential files.
- The backend uses undocumented ChatGPT consumer endpoints, so compatibility may require updates over time.

## Contributing

Bug reports, questions, and fixes are welcome.

- Open an issue: <https://github.com/jeph/langchainjs-codex-oauth/issues>
- Open a pull request: <https://github.com/jeph/langchainjs-codex-oauth/pulls>

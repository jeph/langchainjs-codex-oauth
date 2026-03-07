# langchainjs-codex-oauth

Use ChatGPT Codex models through OAuth inside LangChainJS and LangGraph.

## What it does

- Exposes a `ChatCodexOAuth` model implemented in TypeScript.
- Authenticates locally with ChatGPT OAuth instead of an API key.
- Stores credentials under `~/.langchainjs-codex-oauth/` by default.
- Streams responses from the ChatGPT Codex backend.
- Supports tool calling for LangChain agents.

## Install

```bash
pnpm add langchainjs-codex-oauth @langchain/core
```

## Authenticate

```bash
npx langchainjs-codex-oauth auth login
# or:
npx langchainjs-codex-oauth auth login --manual
```

For local development before publishing:

```bash
pnpm auth:login
pnpm auth:status
pnpm auth:logout
```

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

## Notes

- v1 is Node-only.
- The package keeps its own auth store and does not read Codex/OpenCode credential files.
- The backend is an undocumented ChatGPT consumer endpoint, so compatibility may require updates over time.

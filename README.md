# langchainjs-codex-oauth

Use ChatGPT Codex models through OAuth inside LangChainJS and LangGraph.

In practice, this means you can connect the Codex access attached to your ChatGPT account - including ChatGPT Plus, Pro, Business, and Enterprise accounts when Codex is enabled - to LangChainJS and LangGraph without using an OpenAI API key.

> [!IMPORTANT]
> This project is still in active development. Expect bugs, rough edges, and occasional breaking changes while the package stabilizes. [Issues](https://github.com/jeph/langchainjs-codex-oauth/issues) and [pull requests](https://github.com/jeph/langchainjs-codex-oauth/pulls) are very welcome.

## What it does

- Lets you use the Codex-capable models available in your ChatGPT account from LangChainJS and LangGraph.
- Reuses ChatGPT plan access instead of requiring OpenAI API billing or an API key.
- Exposes a `ChatCodexOAuth` chat model implemented in TypeScript.
- Authenticates locally with ChatGPT OAuth instead of an API key.
- Stores credentials under `~/.langchainjs-codex-oauth/` by default.
- Refreshes expired access tokens automatically.
- Enables Codex prompt caching by default with safe, full-context requests.
- Streams text responses and tool-call chunks from the ChatGPT Codex backend.
- Supports direct `bindTools(...)`, `withStructuredOutput(...)`, LangChain agents, and LangGraph workflows.

## What this is, in plain English

- If you can use Codex from your ChatGPT account, this package lets your LangChainJS or LangGraph code use that same account access.
- It is useful for people who already pay for ChatGPT plans such as Plus, Pro, Business, or Enterprise and want to experiment with LangChainJS or LangGraph without switching to the API platform first.
- It does not turn a ChatGPT subscription into the official OpenAI API. It is an adapter around ChatGPT OAuth and the Codex access available to that account.
- Availability still depends on whether OpenAI has enabled Codex and the requested models for your plan or workspace.

## Requirements

- Node.js `>=20`
- A ChatGPT account with access to Codex-capable models, such as a Plus, Pro, Business, or Enterprise account with Codex enabled

## Compliance note

> [!CAUTION]
> This package is unofficial and is not legal advice.
>
> I could not find OpenAI documentation that explicitly says ChatGPT OAuth account access is approved for general-purpose third-party automation through LangChainJS or LangGraph. OpenAI's [Terms of Use](https://openai.com/policies/terms-of-use/) currently restrict activities such as "automatically or programmatically extract data or Output" and "circumvent any rate limits or restrictions or bypass any protective measures or safety mitigations," and this package relies on undocumented ChatGPT/Codex endpoints rather than the official API platform.
>
> Because of that, use of this project may be unsupported, a gray area, or inconsistent with OpenAI terms or workspace policies depending on how you use it and what kind of account you use. Review the current OpenAI [Terms of Use](https://openai.com/policies/terms-of-use/), [Service Terms](https://openai.com/policies/service-terms/), and any Business or Enterprise admin policies before using it in production or on an organization-managed workspace.

## Install

Before installing, make sure the account you plan to use can already access Codex in ChatGPT or the Codex app. This package does not grant Codex access on its own.

For the core library:

```bash
pnpm add langchainjs-codex-oauth @langchain/core
```

Add these only if you want the examples or higher-level helpers shown in this README:

```bash
pnpm add langchain @langchain/langgraph zod
```

Notes:

- You do not need an OpenAI API key for this package.
- You do not need the `openai` SDK unless your app also talks to the official OpenAI API separately.
- `langchainjs-codex-oauth` is for ChatGPT-account-backed Codex access. If you want the official API platform instead, use the OpenAI API directly.

## Authenticate

Authenticate once on the machine where you want to run LangChainJS or LangGraph with your ChatGPT account:

```bash
npx langchainjs-codex-oauth auth login
```

What this does:

- Opens the ChatGPT/OpenAI OAuth flow in your browser
- Signs in with the ChatGPT account whose Codex access you want to use
- Stores OAuth credentials locally so your code can reuse them without an API key
- Refreshes expired access tokens automatically later

If your browser cannot open automatically, localhost port `1455` is busy, your workspace requires a different browser/session, or you want to finish the OAuth flow by hand:

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
- That auth file gives local access to your ChatGPT/Codex session for this package, so treat it like a secret.
- Expired access tokens are refreshed automatically and written back to the auth file.
- `ChatCodexOAuth` also starts a background auth refresh poller by default. It checks credentials every 30 seconds and refreshes when the access token is expired or close to expiring.
- If you use ChatGPT Business or Enterprise, make sure your workspace permits Codex access and local OAuth sign-in before relying on this setup.

## Quickstart

```ts
import { HumanMessage, SystemMessage } from "@langchain/core/messages"
import { ChatCodexOAuth } from "langchainjs-codex-oauth"

const model = new ChatCodexOAuth({
  model: "gpt-5.5",
})

const result = await model.invoke([
  new SystemMessage("You are a concise coding assistant."),
  new HumanMessage("Say hello and give one TypeScript tip."),
])

console.log(result.text)
```

`ChatCodexOAuth` also supports `.stream(...)`, `.batch(...)`, `.bindTools(...)`, and `.withStructuredOutput(...)`.

## Image Input

User messages can include image URLs or base64 data URLs using LangChain's multimodal content format:

```ts
import { HumanMessage } from "@langchain/core/messages"
import { ChatCodexOAuth } from "langchainjs-codex-oauth"

const model = new ChatCodexOAuth({ model: "gpt-5.5" })

const result = await model.invoke([
  new HumanMessage({
    content: [
      { type: "text", text: "What is in this image?" },
      {
        type: "image_url",
        image_url: "https://example.com/screenshot.png",
      },
    ],
  }),
])

console.log(result.text)
```

OpenAI-style `image_url` blocks with detail are also supported:

```ts
new HumanMessage({
  content: [
    { type: "text", text: "Describe this image briefly." },
    {
      type: "image_url",
      image_url: {
        url: "data:image/png;base64,iVBORw0KGgo...",
        detail: "high",
      },
    },
  ],
})
```

The newer LangChain standard image block shape is supported too:

```ts
new HumanMessage({
  content: [
    { type: "text", text: "What changed in this screenshot?" },
    {
      type: "image",
      url: "https://example.com/screenshot.png",
    },
  ],
})
```

Base64 image blocks must include an image MIME type:

```ts
new HumanMessage({
  content: [
    { type: "text", text: "What is shown here?" },
    {
      type: "image",
      data: "iVBORw0KGgo...",
      mimeType: "image/png",
    },
  ],
})
```

Notes:

- Image inputs are converted to Codex `input_image` blocks and are not stringified into text.
- Text and image parts are sent in the order you provide them.
- Images are supported only in user/human messages in this release.
- Tool output images are not supported yet; that will be handled separately.
- Local file paths are not read automatically. Pass a public URL, data URL, or base64 data with `mimeType`.
- Images consume tokens/quota, and `detail` support may vary by model/backend.

## Advanced imports

If you need the lower-level auth store or raw Codex client, import them from subpaths:

```ts
import { AuthStore, defaultAuthPath } from "langchainjs-codex-oauth/auth"
import { CodexClient, DEFAULT_INCLUDE } from "langchainjs-codex-oauth/client"
```

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

const model = new ChatCodexOAuth({ model: "gpt-5.5" }).bindTools([add])
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
  model: "gpt-5.5",
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

- `model`: model name to request, default `gpt-5.5`
- `temperature`
- `maxTokens`
- `reasoningEffort`: `"none"`, `"low"`, `"medium"` (default), `"high"`, or `"xhigh"`. The backend currently rejects `"max"` and `"minimal"` for current ChatGPT Codex models; use `"xhigh"` for the highest supported setting.
- `reasoningSummary`: `"concise"`, `"detailed"`, or `"auto"`
- `textVerbosity`: `"low"`, `"medium"` (default), or `"high"`
- `serviceTier`: `"default"` or `"priority"`. Omit it, or set `"default"`, for regular Codex routing. Set `"priority"` explicitly to request Codex Fast mode for supported models; this consumes credits faster.
- `include`: for example `["reasoning.encrypted_content"]`
- `timeout`: request timeout in milliseconds
- `maxRetries`
- `baseURL`
- `authPath`
- `backgroundAuthRefresh`: enabled by default; set `false` to disable, or pass `{ intervalMs, refreshBeforeExpiryMs }`
- `promptCaching`: enabled by default; set `false` to omit `prompt_cache_key`
- `promptCacheKey`: optional explicit cache key for repeated calls in the same app/session

Background auth refresh uses an unref'd timer, so it should not keep Node.js running by itself. If you create many clients, call `model.stopBackgroundAuthRefresh()` when a long-lived instance is no longer needed. Use one auth file per process or serialized workflow; multiple processes refreshing the same file can race because refresh tokens may rotate.

Prompt caching is enabled by default. The package still sends the full `instructions` and full conversation `input` on every request; caching only adds Codex's `prompt_cache_key` field so the backend can reuse repeated prompt prefixes when safe. This avoids local truncation or omitted history. If the backend rejects `prompt_cache_key`, the client retries the same request once without only that field.

Disable prompt caching when you do not want repeated requests grouped by a cache key:

```ts
const uncached = new ChatCodexOAuth({
  model: "gpt-5.5",
  promptCaching: false,
})
```

Use an explicit key when several model instances should share the same backend prompt-cache bucket for one logical thread or agent run:

```ts
const model = new ChatCodexOAuth({
  model: "gpt-5.5",
  promptCacheKey: "agent-session-123",
})
```

Do not share a `promptCacheKey` across unrelated conversations. If no key is provided, each `ChatCodexOAuth` instance gets its own generated key.

You usually do not need a separate warm-up call. The first real request using a given `promptCacheKey` can populate the backend cache, and later requests can reuse any identical prompt prefix. A warm-up call can help only when you have a large, stable system/tool prefix that will be reused many times. If you do warm up the cache, use the same `promptCacheKey`, keep the static prefix identical, and use a tiny user prompt plus low output limits rather than relying on an empty conversation request.

Regular routing is the default. Fast mode must be requested explicitly:

```ts
const regular = new ChatCodexOAuth({ model: "gpt-5.5" })

const fast = new ChatCodexOAuth({
  model: "gpt-5.5",
  serviceTier: "priority",
})
```

Environment variables:

- `LANGCHAINJS_CODEX_OAUTH_BASE_URL`
- `LANGCHAINJS_CODEX_OAUTH_TEMPERATURE`
- `LANGCHAINJS_CODEX_OAUTH_MAX_TOKENS`
- `LANGCHAINJS_CODEX_OAUTH_TIMEOUT_S`
- `LANGCHAINJS_CODEX_OAUTH_MAX_RETRIES`
- `LANGCHAINJS_CODEX_OAUTH_HOME`
- `LANGCHAINJS_CODEX_OAUTH_AUTH_PATH`

`SystemMessage` and LangChain `developer` chat messages are sent as the top-level backend `instructions` string, in order, joined with blank lines. Regular human, assistant, and tool messages are sent as normal conversation input items.

When no system or developer prompt is present, the client sends an empty `instructions` string because the backend currently rejects requests that omit the field entirely.

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
- The backend uses undocumented ChatGPT/Codex endpoints, so compatibility may require updates over time.
- This project is best understood as an unofficial bridge from ChatGPT account access to LangChainJS/LangGraph, not as a replacement for the official OpenAI API.

## Contributing

Bug reports, questions, and fixes are welcome.

- Open an issue: <https://github.com/jeph/langchainjs-codex-oauth/issues>
- Open a pull request: <https://github.com/jeph/langchainjs-codex-oauth/pulls>

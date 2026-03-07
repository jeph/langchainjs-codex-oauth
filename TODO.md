# TODO

- Add native structured-output support for `ChatCodexOAuth` so LangChain `providerStrategy(...)` can use provider-enforced schemas instead of the current tool-calling fallback.
- Fix direct `model.withStructuredOutput(...)` interoperability. The live adapter currently returns the raw extraction tool call, but LangChain parsing resolves to `parsed: null`.
- Expose model capability/profile metadata for structured output, tool calling, and reasoning so LangChain can infer adapter capabilities more accurately.
- Add multimodal content-block support for non-text message input/output instead of flattening unsupported blocks into JSON strings.
- Surface reasoning content blocks and reasoning stream chunks in LangChain message content instead of only returning plain text and tool calls.
- Support live streamed `tool_call_chunks` for tool arguments. The current backend only surfaces the final `tool_calls` object at completion during real integrations.
- Support non-`function` built-in/server-side tool definitions (for example Responses-style tools such as web search) in `bindTools`/tool conversion.

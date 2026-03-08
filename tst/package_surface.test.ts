import { describe, expect, test } from "vitest"

import {
  ChatCodexOAuth,
  CodexAPIError,
  type ChatCodexOAuthCallOptions,
  type ChatCodexOAuthParams,
  type ChatCodexOAuthToolChoice,
  type CodexInclude,
  type ReasoningEffort,
  type ReasoningSummary,
  type TextVerbosity,
} from "../src/index.js"
import {
  AuthStore,
  REDIRECT_URI,
  type OAuthCredentials,
  type TokenResponse,
} from "../src/auth/index.js"
import {
  CodexClient,
  DEFAULT_INCLUDE,
  type CodexClientOptions,
  type CodexRequestParams,
  type CompletionResult,
} from "../src/client/index.js"

describe("package surface", () => {
  test("exposes typed root, auth, and client barrels", () => {
    const reasoningEffort: ReasoningEffort = "medium"
    const reasoningSummary: ReasoningSummary = "brief"
    const textVerbosity: TextVerbosity = "high"
    const include: CodexInclude = "reasoning.encrypted_content"
    const toolChoice: ChatCodexOAuthToolChoice = "any"

    const params = {
      model: "gpt-5.2-codex",
      reasoningEffort,
      reasoningSummary,
      textVerbosity,
      include: [include],
    } satisfies ChatCodexOAuthParams

    const callOptions = {
      tool_choice: toolChoice,
      reasoningEffort,
      reasoningSummary,
      textVerbosity,
      include: [include],
    } satisfies ChatCodexOAuthCallOptions

    const credentials: OAuthCredentials = {
      type: "oauth",
      access: "access",
      refresh: "refresh",
      expires: 123,
      accountId: "acct_123",
    }

    const token: TokenResponse = {
      access: "access",
      refresh: "refresh",
      expiresAtMs: 456,
    }

    const clientOptions = {
      authPath: "/tmp/langchainjs-codex-oauth-auth.json",
    } satisfies CodexClientOptions

    const request: CodexRequestParams = {
      inputItems: [],
      model: params.model,
      toolChoice: callOptions.tool_choice,
      reasoningEffort,
      reasoningSummary,
      textVerbosity,
      include: [DEFAULT_INCLUDE[0]!],
    }

    const completion: CompletionResult = {
      parsed: {
        content: "ok",
        toolCalls: [],
        invalidToolCalls: [],
      },
      response: null,
    }

    const model = new ChatCodexOAuth(params)
    const store = new AuthStore(clientOptions.authPath)
    const client = new CodexClient(clientOptions)
    const error = new CodexAPIError("boom")

    expect(model).toBeInstanceOf(ChatCodexOAuth)
    expect(store).toBeInstanceOf(AuthStore)
    expect(client).toBeInstanceOf(CodexClient)
    expect(error).toBeInstanceOf(Error)
    expect(credentials.accountId).toBe("acct_123")
    expect(token.expiresAtMs).toBe(456)
    expect(request.include).toEqual(["reasoning.encrypted_content"])
    expect(completion.parsed.content).toBe("ok")
    expect(REDIRECT_URI).toContain("localhost")
  })
})

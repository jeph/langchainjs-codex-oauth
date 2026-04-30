import { describe, expect, test } from "vitest"

import {
  ChatCodexOAuth,
  CodexAPIError,
  type ChatCodexOAuthCallOptions,
  type ChatCodexOAuthParams,
  type ChatCodexOAuthToolChoice,
  type CodexInclude,
  type CodexServiceTier,
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
  type CodexAllowedToolsChoice,
  type CodexBackendTool,
  type CodexClientOptions,
  type CodexFunctionTool,
  type CodexRequestParams,
  type CodexToolChoice,
  type CodexToolReference,
  type CompletionResult,
} from "../src/client/index.js"

const validReasoningEffort: ReasoningEffort = "xhigh"
const defaultServiceTier: CodexServiceTier = "default"
const priorityServiceTier: CodexServiceTier = "priority"

// @ts-expect-error invalid reasoning effort should be rejected
const invalidReasoningEffort: ReasoningEffort = "ultra"

// @ts-expect-error max is not a backend-supported reasoning effort
const invalidMaxReasoningEffort: ReasoningEffort = "max"

// @ts-expect-error minimal is rejected by current ChatGPT Codex models
const invalidMinimalReasoningEffort: ReasoningEffort = "minimal"

// @ts-expect-error unsupported Codex service tier should be rejected
const invalidServiceTier: CodexServiceTier = "fast"

// @ts-expect-error invalid text verbosity should be rejected
const invalidTextVerbosity: TextVerbosity = "xhigh"

// @ts-expect-error invalid reasoning summary should be rejected
const invalidReasoningSummary: ReasoningSummary = "brief"

describe("package surface", () => {
  test("exposes typed root, auth, and client barrels", () => {
    const reasoningEffort: ReasoningEffort = "medium"
    const reasoningSummary: ReasoningSummary = "concise"
    const textVerbosity: TextVerbosity = "high"
    const include: CodexInclude = "reasoning.encrypted_content"
    const toolRef: CodexToolReference = {
      type: "function",
      name: "lookup_inventory",
    }
    const allowedToolsChoice: CodexAllowedToolsChoice = {
      type: "allowed_tools",
      mode: "required",
      tools: [toolRef],
    }
    const backendTool: CodexFunctionTool = {
      type: "function",
      name: "lookup_inventory",
      description: "Look up a single inventory value.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string" },
        },
        required: ["key"],
      },
    }
    const toolChoice: ChatCodexOAuthToolChoice = allowedToolsChoice
    const clientToolChoice: CodexToolChoice = allowedToolsChoice
    const backendTools: CodexBackendTool[] = [backendTool]

    const params = {
      model: "gpt-5.5",
      reasoningEffort,
      reasoningSummary,
      textVerbosity,
      serviceTier: priorityServiceTier,
      include: [include],
    } satisfies ChatCodexOAuthParams

    const callOptions = {
      tool_choice: toolChoice,
      reasoningEffort,
      reasoningSummary,
      textVerbosity,
      serviceTier: priorityServiceTier,
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
      tools: backendTools,
      toolChoice: clientToolChoice,
      reasoningEffort,
      reasoningSummary,
      textVerbosity,
      serviceTier: priorityServiceTier,
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
    expect(request.tools).toEqual(backendTools)
    expect(request.include).toEqual(["reasoning.encrypted_content"])
    expect(completion.parsed.content).toBe("ok")
    expect(REDIRECT_URI).toContain("localhost")
    expect(validReasoningEffort).toBe("xhigh")
    expect(defaultServiceTier).toBe("default")
    expect(priorityServiceTier).toBe("priority")
    expect(invalidReasoningSummary).toBe("brief")
    expect(invalidMaxReasoningEffort).toBe("max")
    expect(invalidMinimalReasoningEffort).toBe("minimal")
    expect(invalidServiceTier).toBe("fast")
  })
})

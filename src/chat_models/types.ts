import type {
  BaseChatModelCallOptions,
  BaseChatModelParams,
  BindToolsInput,
} from "@langchain/core/language_models/chat_models"

export type {
  CodexInclude,
  ReasoningEffort,
  ReasoningSummary,
  SystemPromptMode,
  TextVerbosity,
} from "../client/types.js"
import type {
  CodexInclude,
  ReasoningEffort,
  ReasoningSummary,
  SystemPromptMode,
  TextVerbosity,
} from "../client/types.js"

type OpenToolName = string & Record<never, never>

export type ChatCodexOAuthToolChoice =
  | "auto"
  | "any"
  | "none"
  | OpenToolName
  | Record<string, unknown>

export interface ChatCodexOAuthFields {
  temperature?: number
  maxTokens?: number
  reasoningEffort?: ReasoningEffort
  reasoningSummary?: ReasoningSummary
  textVerbosity?: TextVerbosity
  include?: CodexInclude[]
}

export interface ChatCodexOAuthParams
  extends BaseChatModelParams, ChatCodexOAuthFields {
  model?: string
  baseURL?: string
  timeout?: number
  maxRetries?: number
  authPath?: string
  systemPromptMode?: SystemPromptMode
}

export interface ChatCodexOAuthCallOptions
  extends BaseChatModelCallOptions, ChatCodexOAuthFields {
  tools?: BindToolsInput[]
  tool_choice?: ChatCodexOAuthToolChoice
  signal?: AbortSignal
}

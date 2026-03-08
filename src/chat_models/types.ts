import type {
  BaseChatModelCallOptions,
  BaseChatModelParams,
  BindToolsInput,
} from "@langchain/core/language_models/chat_models"
import type {
  FunctionCallOption,
  ToolDefinition,
} from "@langchain/core/language_models/base"

export type {
  CodexAllowedToolsChoice,
  CodexInclude,
  CodexToolReference,
  ReasoningEffort,
  ReasoningSummary,
  TextVerbosity,
} from "../client/types.js"
import type {
  CodexToolChoice,
  CodexInclude,
  ReasoningEffort,
  ReasoningSummary,
  TextVerbosity,
} from "../client/types.js"

type OpenToolName = string & Record<never, never>

export type ChatCodexOAuthToolChoice =
  | "any"
  | CodexToolChoice
  | OpenToolName
  | FunctionCallOption
  | ToolDefinition

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
}

export interface ChatCodexOAuthCallOptions
  extends BaseChatModelCallOptions, ChatCodexOAuthFields {
  tools?: BindToolsInput[]
  tool_choice?: ChatCodexOAuthToolChoice
  signal?: AbortSignal
}

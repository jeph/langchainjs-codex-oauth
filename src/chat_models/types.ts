import type {
  BaseChatModelCallOptions,
  BaseChatModelParams,
  BindToolsInput,
} from "@langchain/core/language_models/chat_models";

export type { SystemPromptMode } from "../client/types.js";
import type { SystemPromptMode } from "../client/types.js";

export interface ChatCodexOAuthFields {
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: string;
  reasoningSummary?: string;
  textVerbosity?: string;
  include?: string[];
}

export interface ChatCodexOAuthParams
  extends BaseChatModelParams, ChatCodexOAuthFields {
  model?: string;
  baseURL?: string;
  timeout?: number;
  maxRetries?: number;
  authPath?: string;
  systemPromptMode?: SystemPromptMode;
}

export interface ChatCodexOAuthCallOptions
  extends BaseChatModelCallOptions, ChatCodexOAuthFields {
  tools?: BindToolsInput[];
  signal?: AbortSignal;
}

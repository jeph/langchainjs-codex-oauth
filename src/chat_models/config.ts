import type {
  CodexInclude,
  ReasoningEffort,
  ReasoningSummary,
  TextVerbosity,
} from "../client/types.js"
import {
  getEnvironmentVariable,
  getFloatEnvironmentVariable,
  getIntegerEnvironmentVariable,
} from "../utils/env.js"
import type { ChatCodexOAuthParams } from "./types.js"

const BASE_URL_ENV = "LANGCHAINJS_CODEX_OAUTH_BASE_URL"
const TEMPERATURE_ENV = "LANGCHAINJS_CODEX_OAUTH_TEMPERATURE"
const MAX_TOKENS_ENV = "LANGCHAINJS_CODEX_OAUTH_MAX_TOKENS"
const TIMEOUT_ENV = "LANGCHAINJS_CODEX_OAUTH_TIMEOUT_S"
const MAX_RETRIES_ENV = "LANGCHAINJS_CODEX_OAUTH_MAX_RETRIES"

export interface ResolvedChatCodexOAuthConfig {
  model: string
  temperature?: number
  maxTokens?: number
  reasoningEffort?: ReasoningEffort
  reasoningSummary?: ReasoningSummary
  textVerbosity?: TextVerbosity
  include?: CodexInclude[]
  timeout: number
  maxRetries: number
  baseURL: string
  authPath?: string
}

export function resolveChatCodexOAuthConfig(
  fields: ChatCodexOAuthParams = {},
): ResolvedChatCodexOAuthConfig {
  return {
    model: fields.model ?? "gpt-5.2-codex",
    temperature:
      fields.temperature ?? getFloatEnvironmentVariable(TEMPERATURE_ENV),
    maxTokens:
      fields.maxTokens ?? getIntegerEnvironmentVariable(MAX_TOKENS_ENV),
    reasoningEffort: fields.reasoningEffort ?? "medium",
    reasoningSummary: fields.reasoningSummary,
    textVerbosity: fields.textVerbosity ?? "medium",
    include: fields.include ?? ["reasoning.encrypted_content"],
    timeout:
      (fields.timeout ?? getFloatEnvironmentVariable(TIMEOUT_ENV) ?? 60) * 1000,
    maxRetries:
      fields.maxRetries ?? getIntegerEnvironmentVariable(MAX_RETRIES_ENV) ?? 2,
    baseURL:
      fields.baseURL ??
      getEnvironmentVariable(BASE_URL_ENV) ??
      "https://chatgpt.com/backend-api",
    authPath: fields.authPath,
  }
}

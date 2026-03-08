import type { BindToolsInput } from "@langchain/core/language_models/chat_models"
import type { BaseMessage } from "@langchain/core/messages"

import type { CodexBackendTool, CodexRequestParams } from "../client/types.js"
import { buildInstructions, toInputItems } from "../converters/messages.js"
import { convertTools, normalizeToolChoice } from "../converters/tools.js"
import type { ResolvedChatCodexOAuthConfig } from "./config.js"

export interface RequestState {
  tools?: CodexBackendTool[]
  toolChoice?: CodexRequestParams["toolChoice"]
  temperature?: number
  maxOutputTokens?: number
  reasoningEffort?: ResolvedChatCodexOAuthConfig["reasoningEffort"]
  reasoningSummary?: ResolvedChatCodexOAuthConfig["reasoningSummary"]
  textVerbosity?: ResolvedChatCodexOAuthConfig["textVerbosity"]
  include?: ResolvedChatCodexOAuthConfig["include"]
  instructions: string
}

interface RequestOverrides {
  tools?: BindToolsInput[]
  tool_choice?: unknown
  temperature?: number
  maxTokens?: number
  reasoningEffort?: ResolvedChatCodexOAuthConfig["reasoningEffort"]
  reasoningSummary?: ResolvedChatCodexOAuthConfig["reasoningSummary"]
  textVerbosity?: ResolvedChatCodexOAuthConfig["textVerbosity"]
  include?: ResolvedChatCodexOAuthConfig["include"]
}

export function buildInvocationParams(
  config: ResolvedChatCodexOAuthConfig,
  options?: RequestOverrides,
): Record<string, unknown> {
  return {
    model: config.model,
    temperature: options?.temperature ?? config.temperature,
    max_output_tokens: options?.maxTokens ?? config.maxTokens,
    tool_choice: normalizeToolChoice(options?.tool_choice),
    reasoning: {
      ...((options?.reasoningEffort ?? config.reasoningEffort)
        ? { effort: options?.reasoningEffort ?? config.reasoningEffort }
        : {}),
      ...((options?.reasoningSummary ?? config.reasoningSummary)
        ? { summary: options?.reasoningSummary ?? config.reasoningSummary }
        : {}),
    },
    text:
      (options?.textVerbosity ?? config.textVerbosity)
        ? { verbosity: options?.textVerbosity ?? config.textVerbosity }
        : undefined,
    include: options?.include ?? config.include,
  }
}

export function buildRequestState(
  messages: BaseMessage[],
  config: ResolvedChatCodexOAuthConfig,
  options: RequestOverrides,
): RequestState {
  return {
    tools: options.tools?.length ? convertTools(options.tools) : undefined,
    toolChoice: normalizeToolChoice(options.tool_choice),
    temperature: options.temperature ?? config.temperature,
    maxOutputTokens: options.maxTokens ?? config.maxTokens,
    reasoningEffort: options.reasoningEffort ?? config.reasoningEffort,
    reasoningSummary: options.reasoningSummary ?? config.reasoningSummary,
    textVerbosity: options.textVerbosity ?? config.textVerbosity,
    include: options.include ?? config.include,
    instructions: buildInstructions(messages),
  }
}

export function buildClientRequest(
  messages: BaseMessage[],
  model: string,
  state: RequestState,
  signal?: AbortSignal,
): CodexRequestParams {
  return {
    inputItems: toInputItems(messages),
    model,
    tools: state.tools,
    toolChoice: state.toolChoice,
    temperature: state.temperature,
    maxOutputTokens: state.maxOutputTokens,
    reasoningEffort: state.reasoningEffort,
    reasoningSummary: state.reasoningSummary,
    textVerbosity: state.textVerbosity,
    include: state.include,
    instructions: state.instructions,
    signal,
  }
}

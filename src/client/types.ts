import type { UsageMetadata } from "@langchain/core/messages"

export type MessageRole = "developer" | "user" | "assistant"

type OpenString = string & Record<never, never>

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh"

export type ReasoningSummary = "concise" | "detailed" | "auto"

export type TextVerbosity = "low" | "medium" | "high"

export type CodexServiceTier = "default" | "priority"

export type CodexInclude = "reasoning.encrypted_content" | OpenString

export interface CodexFunctionTool {
  type: "function"
  name: string
  description?: string
  parameters?: Record<string, unknown>
  strict?: boolean
  [key: string]: unknown
}

export interface CodexCustomTool {
  type: "custom"
  name: string
  description?: string
  format?: Record<string, unknown>
  [key: string]: unknown
}

export interface CodexExperimentalTool {
  type: OpenString
  name?: string
  [key: string]: unknown
}

export type CodexBackendTool =
  | CodexFunctionTool
  | CodexCustomTool
  | CodexExperimentalTool

export interface CodexToolReference {
  type: "function" | "custom" | OpenString
  name: string
  [key: string]: unknown
}

export interface CodexAllowedToolsChoice {
  type: "allowed_tools"
  mode: "auto" | "required"
  tools: CodexToolReference[]
}

export type CodexToolChoice =
  | "auto"
  | "none"
  | "required"
  | CodexToolReference
  | CodexAllowedToolsChoice

export interface InputTextBlock {
  type: "input_text"
  text: string
}

export interface OutputTextBlock {
  type: "output_text"
  text: string
}

export type MessageTextBlock = InputTextBlock | OutputTextBlock

export interface InputMessageItem {
  type: "message"
  role: MessageRole
  content: MessageTextBlock[]
}

export interface InputFunctionCallItem {
  type: "function_call"
  call_id: string
  name: string
  arguments: string
}

export interface InputFunctionCallOutputItem {
  type: "function_call_output"
  call_id: string
  output: string
}

export type CodexInputItem =
  | InputMessageItem
  | InputFunctionCallItem
  | InputFunctionCallOutputItem

export interface CodexToolCall {
  type: "tool_call"
  id?: string
  name: string
  args: Record<string, unknown>
}

export interface CodexInvalidToolCall {
  type: "invalid_tool_call"
  id?: string
  name?: string
  args?: string
  error?: string
}

export interface ParsedAssistantMessage {
  content: string
  toolCalls: CodexToolCall[]
  invalidToolCalls: CodexInvalidToolCall[]
}

export interface CompletionResult {
  parsed: ParsedAssistantMessage
  response: Record<string, unknown> | null
}

export interface CodexRequestParams {
  inputItems: CodexInputItem[]
  model: string
  tools?: CodexBackendTool[]
  toolChoice?: CodexToolChoice
  temperature?: number
  maxOutputTokens?: number
  reasoningEffort?: ReasoningEffort
  reasoningSummary?: ReasoningSummary
  textVerbosity?: TextVerbosity
  serviceTier?: CodexServiceTier
  include?: CodexInclude[]
  instructions?: string
  signal?: AbortSignal
}

export interface ParsedMetadata {
  responseMetadata: Record<string, unknown>
  usageMetadata?: UsageMetadata
}

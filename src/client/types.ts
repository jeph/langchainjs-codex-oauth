import type { UsageMetadata } from "@langchain/core/messages"

export type MessageRole = "developer" | "user" | "assistant"

export type SystemPromptMode = "strict" | "default" | "disabled"

export type InstructionsMode = "auto" | "cache" | "github" | "bundled"

type OpenString = string & Record<never, never>

export type ReasoningEffort = "low" | "medium" | "high"

export type ReasoningSummary = "brief" | OpenString

export type TextVerbosity = "low" | "medium" | "high"

export type CodexInclude = "reasoning.encrypted_content" | OpenString

export type CodexToolChoice =
  | "auto"
  | "none"
  | "required"
  | OpenString
  | Record<string, unknown>

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
  tools?: Array<Record<string, unknown>>
  toolChoice?: CodexToolChoice
  temperature?: number
  maxOutputTokens?: number
  reasoningEffort?: ReasoningEffort
  reasoningSummary?: ReasoningSummary
  textVerbosity?: TextVerbosity
  include?: CodexInclude[]
  extraInstructions?: string
  signal?: AbortSignal
}

export interface ParsedMetadata {
  responseMetadata: Record<string, unknown>
  usageMetadata?: UsageMetadata
}

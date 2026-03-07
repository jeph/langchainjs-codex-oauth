import type { UsageMetadata } from "@langchain/core/messages"

import type {
  CodexInvalidToolCall,
  CodexToolCall,
  ParsedAssistantMessage,
} from "../client/types.js"
import { asInteger, asString, isRecord } from "../utils/json.js"

interface ParsedToolCallResult {
  toolCall?: CodexToolCall
  invalidToolCall?: CodexInvalidToolCall
}

function outputItems(
  response: Record<string, unknown>,
): Record<string, unknown>[] {
  return Array.isArray(response.output) ? response.output.filter(isRecord) : []
}

function textPartsFromItem(item: Record<string, unknown>): string[] {
  if (item.type !== "message") {
    return []
  }

  if (typeof item.content === "string") {
    return [item.content]
  }

  if (!Array.isArray(item.content)) {
    return []
  }

  return item.content.flatMap((block) =>
    isRecord(block) &&
    (block.type === "output_text" || block.type === "text") &&
    typeof block.text === "string"
      ? [block.text]
      : [],
  )
}

function parseToolCall(item: Record<string, unknown>): ParsedToolCallResult {
  if (item.type !== "function_call") {
    return {}
  }

  const id = asString(item.call_id) ?? asString(item.id)
  const name = asString(item.name)

  if (!name) {
    return {}
  }

  if (isRecord(item.arguments)) {
    return {
      toolCall: {
        type: "tool_call",
        id,
        name,
        args: item.arguments,
      },
    }
  }

  if (typeof item.arguments !== "string") {
    return {
      invalidToolCall: {
        type: "invalid_tool_call",
        id,
        name,
        error: "missing tool call arguments",
      },
    }
  }

  try {
    const parsed: unknown = JSON.parse(item.arguments)

    if (!isRecord(parsed)) {
      throw new Error("arguments must be a JSON object")
    }

    return {
      toolCall: {
        type: "tool_call",
        id,
        name,
        args: parsed,
      },
    }
  } catch (error) {
    return {
      invalidToolCall: {
        type: "invalid_tool_call",
        id,
        name,
        args: item.arguments,
        error: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

function finishReason(response: Record<string, unknown>): string | undefined {
  const explicit = asString(response.finish_reason)

  if (explicit) {
    return explicit
  }

  if (isRecord(response.incomplete_details)) {
    const reason = asString(response.incomplete_details.reason)

    if (reason) {
      return reason.includes("token") ? "length" : reason
    }
  }

  if (outputItems(response).some((item) => item.type === "function_call")) {
    return "tool_calls"
  }

  const status = asString(response.status)
  return status === "completed" || status === "done" ? "stop" : undefined
}

export function parseAssistantMessage(
  response: unknown,
): ParsedAssistantMessage {
  if (!isRecord(response)) {
    return {
      content: response == null ? "" : String(response),
      toolCalls: [],
      invalidToolCalls: [],
    }
  }

  const items = outputItems(response)
  const textParts = items.flatMap(textPartsFromItem)
  const parsedToolCalls = items.map(parseToolCall)
  const fallbackText =
    textParts.length === 0 ? asString(response.output_text) : undefined

  return {
    content: [...textParts, ...(fallbackText ? [fallbackText] : [])].join(""),
    toolCalls: parsedToolCalls.flatMap(({ toolCall }) =>
      toolCall ? [toolCall] : [],
    ),
    invalidToolCalls: parsedToolCalls.flatMap(({ invalidToolCall }) =>
      invalidToolCall ? [invalidToolCall] : [],
    ),
  }
}

export function extractResponseMetadata(
  response: unknown,
): Record<string, unknown> {
  if (!isRecord(response)) {
    return {}
  }

  const id = asString(response.id)
  const model = asString(response.model)
  const status = asString(response.status)
  const createdAt = asInteger(response.created_at)
  const resolvedFinishReason = finishReason(response)

  return {
    ...(id ? { id } : {}),
    ...(model ? { model } : {}),
    ...(status ? { status } : {}),
    ...(createdAt !== undefined ? { created_at: createdAt } : {}),
    ...(resolvedFinishReason ? { finish_reason: resolvedFinishReason } : {}),
  }
}

export function extractUsageMetadata(
  response: unknown,
): UsageMetadata | undefined {
  if (!isRecord(response) || !isRecord(response.usage)) {
    return undefined
  }

  const usage = response.usage
  const inputTokens =
    asInteger(usage.input_tokens) ?? asInteger(usage.prompt_tokens)
  const outputTokens =
    asInteger(usage.output_tokens) ?? asInteger(usage.completion_tokens)
  const totalTokens =
    asInteger(usage.total_tokens) ??
    (inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined)

  if (
    inputTokens === undefined ||
    outputTokens === undefined ||
    totalTokens === undefined
  ) {
    return undefined
  }

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
  }
}

export function extractToolCallItemAdded(event: Record<string, unknown>):
  | {
      outputIndex: number
      callId: string
      name?: string
    }
  | undefined {
  if (event.type !== "response.output_item.added") {
    return undefined
  }

  const outputIndex = asInteger(event.output_index)

  if (outputIndex === undefined || !isRecord(event.item)) {
    return undefined
  }

  if (event.item.type !== "function_call") {
    return undefined
  }

  const callId =
    asString(event.item.call_id) ??
    asString(event.item.id) ??
    asString(event.call_id)

  if (!callId) {
    return undefined
  }

  return {
    outputIndex,
    callId,
    name: asString(event.item.name),
  }
}

export function extractToolCallArgsDelta(event: Record<string, unknown>):
  | {
      outputIndex: number
      callId: string
      delta: string
    }
  | undefined {
  if (event.type !== "response.function_call_arguments.delta") {
    return undefined
  }

  const outputIndex = asInteger(event.output_index)
  const callId = asString(event.call_id)
  const delta = asString(event.delta)

  if (outputIndex === undefined || !callId || !delta) {
    return undefined
  }

  return {
    outputIndex,
    callId,
    delta,
  }
}

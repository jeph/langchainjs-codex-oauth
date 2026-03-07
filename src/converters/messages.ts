import { randomUUID } from "node:crypto"
import {
  AIMessage,
  ChatMessage,
  type BaseMessage,
  ToolMessage,
  type ToolCall,
} from "@langchain/core/messages"

import type {
  CodexInputItem,
  CodexToolCall,
  InputFunctionCallItem,
  InputFunctionCallOutputItem,
  InputMessageItem,
  MessageRole,
  MessageTextBlock,
  SystemPromptMode,
} from "../client/types.js"
import { isRecord } from "../utils/json.js"

function isDeveloperMessage(message: BaseMessage): boolean {
  return ChatMessage.isInstance(message) && message.role === "developer"
}

function isSystemStyleMessage(message: BaseMessage): boolean {
  return message.getType() === "system" || isDeveloperMessage(message)
}

function queuedMessages(
  messages: BaseMessage[],
  mode: SystemPromptMode,
): BaseMessage[] {
  return mode === "default"
    ? messages
    : messages.filter((message) => !isSystemStyleMessage(message))
}

function toolCallId(toolCall: { id?: string }): string {
  return typeof toolCall.id === "string" && toolCall.id.length > 0
    ? toolCall.id
    : `call_${randomUUID().replace(/-/gu, "")}`
}

function chatMessageToInputItems(message: ChatMessage): CodexInputItem[] {
  if (message.role === "developer") {
    return [messageItem("developer", contentToText(message.content))]
  }

  if (message.role === "assistant") {
    const text = contentToText(message.content)
    return text ? [messageItem("assistant", text)] : []
  }

  return [messageItem("user", contentToText(message.content))]
}

function aiMessageToInputItems(message: AIMessage): CodexInputItem[] {
  const text = contentToText(message.content)
  const assistantItems = text ? [messageItem("assistant", text)] : []
  const toolItems = (message.tool_calls ?? []).map((toolCall) =>
    functionCallItem(
      toolCallId(toolCall),
      toolCall.name,
      isRecord(toolCall.args) ? toolCall.args : {},
    ),
  )

  return [...assistantItems, ...toolItems]
}

function messageToInputItems(message: BaseMessage): CodexInputItem[] {
  if (message.getType() === "human") {
    return [messageItem("user", contentToText(message.content))]
  }

  if (message.getType() === "system") {
    return [messageItem("developer", contentToText(message.content))]
  }

  if (ChatMessage.isInstance(message)) {
    return chatMessageToInputItems(message)
  }

  if (ToolMessage.isInstance(message)) {
    return [functionCallOutputItem(message.tool_call_id, message.content)]
  }

  if (AIMessage.isInstance(message)) {
    return aiMessageToInputItems(message)
  }

  return [messageItem("user", contentToText(message.content))]
}

function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part
        }

        if (
          isRecord(part) &&
          part.type === "text" &&
          typeof part.text === "string"
        ) {
          return part.text
        }

        return JSON.stringify(part)
      })
      .join("")
  }

  if (content == null) {
    return ""
  }

  return JSON.stringify(content)
}

export function normalizeModel(model: string): string {
  const parts = model.split("/", 2)
  return (parts.length === 2 ? (parts[1] ?? "") : (parts[0] ?? "")).trim()
}

export function messageItem(role: MessageRole, text: string): InputMessageItem {
  const block: MessageTextBlock =
    role === "assistant"
      ? { type: "output_text", text }
      : { type: "input_text", text }

  return {
    type: "message",
    role,
    content: [block],
  }
}

export function functionCallItem(
  callId: string,
  name: string,
  args: Record<string, unknown> | string,
): InputFunctionCallItem {
  return {
    type: "function_call",
    call_id: callId,
    name,
    arguments:
      typeof args === "string" ? args : JSON.stringify(args, undefined, 0),
  }
}

export function functionCallOutputItem(
  callId: string,
  output: unknown,
): InputFunctionCallOutputItem {
  return {
    type: "function_call_output",
    call_id: callId,
    output: typeof output === "string" ? output : JSON.stringify(output),
  }
}

export function ensureToolCallIds(
  toolCalls: readonly CodexToolCall[],
): ToolCall[] {
  return toolCalls.map((toolCall) => ({
    type: "tool_call",
    id: toolCall.id ?? `call_${randomUUID().replace(/-/gu, "")}`,
    name: toolCall.name,
    args: toolCall.args,
  }))
}

export function extractSystemTexts(messages: BaseMessage[]): string[] {
  return messages.flatMap((message) => {
    if (message.getType() === "system") {
      return [contentToText(message.content)]
    }

    if (isDeveloperMessage(message)) {
      return [contentToText(message.content)]
    }

    return []
  })
}

export function formatSystemPromptStrict(texts: string[]): string {
  return `System instructions (highest priority):\n${texts.join("\n\n")}`.trim()
}

export function buildExtraInstructions(texts: string[]): string | undefined {
  const joined = texts.join("\n\n").trim()

  if (!joined) {
    return undefined
  }

  const truncated =
    joined.length > 4_000 ? `${joined.slice(0, 4_000).trimEnd()}...` : joined

  return [
    "### Conversation system prompt",
    "Treat the following system instructions as highest priority.",
    "",
    truncated,
    "",
    "### End conversation system prompt",
  ].join("\n")
}

export function toInputItems(
  messages: BaseMessage[],
  mode: SystemPromptMode,
): CodexInputItem[] {
  const strictTexts = mode === "strict" ? extractSystemTexts(messages) : []
  const strictPrelude =
    strictTexts.length > 0
      ? [messageItem("developer", formatSystemPromptStrict(strictTexts))]
      : []

  return [
    ...strictPrelude,
    ...queuedMessages(messages, mode).flatMap(messageToInputItems),
  ]
}

export function findEarliestStopIndex(
  text: string,
  stop?: string[],
): number | undefined {
  return stop?.reduce<number | undefined>((earliest, token) => {
    if (!token) {
      return earliest
    }

    const index = text.indexOf(token)

    if (index === -1) {
      return earliest
    }

    return earliest === undefined || index < earliest ? index : earliest
  }, undefined)
}

export function truncateAtStop(text: string, stop?: string[]): string {
  const earliest = findEarliestStopIndex(text, stop)
  return earliest === undefined ? text : text.slice(0, earliest)
}

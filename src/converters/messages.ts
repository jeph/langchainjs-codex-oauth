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
  ImageDetail,
  InputImageBlock,
  InputFunctionCallItem,
  InputFunctionCallOutputItem,
  InputMessageItem,
  MessageRole,
  MessageContentBlock,
  MessageTextBlock,
} from "../client/types.js"
import { isRecord } from "../utils/json.js"

function isDeveloperMessage(message: BaseMessage): boolean {
  return ChatMessage.isInstance(message) && message.role === "developer"
}

function isSystemStyleMessage(message: BaseMessage): boolean {
  return message.getType() === "system" || isDeveloperMessage(message)
}

function queuedMessages(messages: BaseMessage[]): BaseMessage[] {
  return messages.filter((message) => !isSystemStyleMessage(message))
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

  return [messageItemFromBlocks("user", contentToInputBlocks(message.content))]
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
    return [
      messageItemFromBlocks("user", contentToInputBlocks(message.content)),
    ]
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

  return [messageItemFromBlocks("user", contentToInputBlocks(message.content))]
}

function isImageLikeType(type: unknown): boolean {
  return (
    type === "image" ||
    type === "image_url" ||
    type === "input_image" ||
    type === "audio" ||
    type === "video" ||
    type === "file"
  )
}

function assertNoImageContent(content: unknown, context: string): void {
  if (!Array.isArray(content)) {
    return
  }

  for (const part of content) {
    if (isRecord(part) && isImageLikeType(part.type) && part.type !== "text") {
      throw new Error(`${context} messages do not support image content.`)
    }
  }
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

        if (isRecord(part) && isImageLikeType(part.type)) {
          throw new Error("Only user messages support image content.")
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

function contentToInputBlocks(content: unknown): MessageContentBlock[] {
  if (typeof content === "string") {
    return [{ type: "input_text", text: content }]
  }

  if (Array.isArray(content)) {
    return content.map(contentPartToInputBlock)
  }

  if (content == null) {
    return [{ type: "input_text", text: "" }]
  }

  return [{ type: "input_text", text: JSON.stringify(content) }]
}

function contentPartToInputBlock(part: unknown): MessageContentBlock {
  if (typeof part === "string") {
    return { type: "input_text", text: part }
  }

  if (!isRecord(part)) {
    return { type: "input_text", text: JSON.stringify(part) }
  }

  if (part.type === "text") {
    if (typeof part.text !== "string") {
      throw new Error("Text content blocks must include a string `text` field.")
    }

    return { type: "input_text", text: part.text }
  }

  if (part.type === "image_url") {
    return legacyImageUrlBlockToInputImage(part)
  }

  if (part.type === "input_image") {
    return inputImageBlockToInputImage(part)
  }

  if (part.type === "image") {
    return standardImageBlockToInputImage(part)
  }

  if (part.type === "audio" || part.type === "video" || part.type === "file") {
    throw new Error(`Unsupported multimodal content block type: ${part.type}.`)
  }

  return { type: "input_text", text: JSON.stringify(part) }
}

function imageDetail(value: unknown): ImageDetail | undefined {
  if (value === undefined) {
    return undefined
  }

  if (
    value === "auto" ||
    value === "low" ||
    value === "high" ||
    value === "original"
  ) {
    return value
  }

  throw new Error(
    "Image detail must be one of `auto`, `low`, `high`, or `original`.",
  )
}

function imageBlock(imageUrl: string, detail?: unknown): InputImageBlock {
  if (!imageUrl) {
    throw new Error("Image content blocks must include a non-empty image URL.")
  }

  return {
    type: "input_image",
    image_url: imageUrl,
    ...(detail !== undefined ? { detail: imageDetail(detail) } : {}),
  }
}

function legacyImageUrlBlockToInputImage(
  part: Record<string, unknown>,
): InputImageBlock {
  const imageUrl = part.image_url

  if (typeof imageUrl === "string") {
    return imageBlock(imageUrl)
  }

  if (isRecord(imageUrl) && typeof imageUrl.url === "string") {
    return imageBlock(imageUrl.url, imageUrl.detail)
  }

  throw new Error(
    "Image URL content blocks must include `image_url` as a string or `{ url }` object.",
  )
}

function inputImageBlockToInputImage(
  part: Record<string, unknown>,
): InputImageBlock {
  if (typeof part.image_url !== "string") {
    throw new Error(
      "Input image blocks must include a string `image_url` field.",
    )
  }

  return imageBlock(part.image_url, part.detail)
}

function standardImageBlockToInputImage(
  part: Record<string, unknown>,
): InputImageBlock {
  if (typeof part.fileId === "string") {
    throw new Error(
      "Image file IDs are not supported; pass an image URL or data URL.",
    )
  }

  if (typeof part.url === "string") {
    return imageBlock(part.url, imageDetailFromPart(part))
  }

  if (part.data !== undefined) {
    return imageBlock(dataUrlFromImageData(part), imageDetailFromPart(part))
  }

  throw new Error("Image content blocks must include `url` or base64 `data`.")
}

function imageDetailFromPart(
  part: Record<string, unknown>,
): ImageDetail | undefined {
  if (part.detail !== undefined) {
    return imageDetail(part.detail)
  }

  if (isRecord(part.metadata) && part.metadata.detail !== undefined) {
    return imageDetail(part.metadata.detail)
  }

  return undefined
}

function imageMimeType(part: Record<string, unknown>): string {
  const mimeType = part.mimeType ?? part.mime_type

  if (typeof mimeType !== "string" || mimeType.length === 0) {
    throw new Error("Base64 image content blocks must include `mimeType`.")
  }

  if (!mimeType.startsWith("image/")) {
    throw new Error(`Unsupported image MIME type: ${mimeType}.`)
  }

  return mimeType
}

function dataUrlFromImageData(part: Record<string, unknown>): string {
  const mimeType = imageMimeType(part)
  const { data } = part

  if (typeof data === "string") {
    if (data.startsWith("data:")) {
      return data
    }

    return `data:${mimeType};base64,${data}`
  }

  if (data instanceof Uint8Array) {
    return `data:${mimeType};base64,${Buffer.from(data).toString("base64")}`
  }

  throw new Error(
    "Base64 image content blocks must include string or Uint8Array `data`.",
  )
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

export function messageItemFromBlocks(
  role: MessageRole,
  content: MessageContentBlock[],
): InputMessageItem {
  return {
    type: "message",
    role,
    content,
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
      assertNoImageContent(message.content, "System")
      return [contentToText(message.content)]
    }

    if (isDeveloperMessage(message)) {
      assertNoImageContent(message.content, "Developer")
      return [contentToText(message.content)]
    }

    return []
  })
}

export function buildInstructions(messages: BaseMessage[]): string {
  return extractSystemTexts(messages).join("\n\n")
}

export function toInputItems(messages: BaseMessage[]): CodexInputItem[] {
  return queuedMessages(messages).flatMap(messageToInputItems)
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

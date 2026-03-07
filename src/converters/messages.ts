import { randomUUID } from "node:crypto";
import {
  AIMessage,
  ChatMessage,
  type BaseMessage,
  ToolMessage,
  type ToolCall,
} from "@langchain/core/messages";

import type {
  CodexInputItem,
  CodexToolCall,
  InputFunctionCallItem,
  InputFunctionCallOutputItem,
  InputMessageItem,
  MessageRole,
  MessageTextBlock,
  SystemPromptMode,
} from "../client/types.js";
import { isRecord } from "../utils/json.js";

function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (
          isRecord(part) &&
          part.type === "text" &&
          typeof part.text === "string"
        ) {
          return part.text;
        }

        return JSON.stringify(part);
      })
      .join("");
  }

  if (content == null) {
    return "";
  }

  return JSON.stringify(content);
}

export function normalizeModel(model: string): string {
  const parts = model.split("/", 2);
  return (parts.length === 2 ? (parts[1] ?? "") : (parts[0] ?? "")).trim();
}

export function messageItem(role: MessageRole, text: string): InputMessageItem {
  const block: MessageTextBlock =
    role === "assistant"
      ? { type: "output_text", text }
      : { type: "input_text", text };

  return {
    type: "message",
    role,
    content: [block],
  };
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
  };
}

export function functionCallOutputItem(
  callId: string,
  output: unknown,
): InputFunctionCallOutputItem {
  return {
    type: "function_call_output",
    call_id: callId,
    output: typeof output === "string" ? output : JSON.stringify(output),
  };
}

export function ensureToolCallIds(
  toolCalls: readonly CodexToolCall[],
): ToolCall[] {
  return toolCalls.map((toolCall) => ({
    type: "tool_call",
    id: toolCall.id ?? `call_${randomUUID().replace(/-/gu, "")}`,
    name: toolCall.name,
    args: toolCall.args,
  }));
}

export function extractSystemTexts(messages: BaseMessage[]): string[] {
  return messages.flatMap((message) => {
    if (message.getType() === "system") {
      return [contentToText(message.content)];
    }

    if (ChatMessage.isInstance(message) && message.role === "developer") {
      return [contentToText(message.content)];
    }

    return [];
  });
}

export function formatSystemPromptStrict(texts: string[]): string {
  return `System instructions (highest priority):\n${texts.join("\n\n")}`.trim();
}

export function buildExtraInstructions(texts: string[]): string | undefined {
  if (texts.length === 0) {
    return undefined;
  }

  let joined = texts.join("\n\n").trim();

  if (!joined) {
    return undefined;
  }

  if (joined.length > 4_000) {
    joined = `${joined.slice(0, 4_000).trimEnd()}...`;
  }

  return [
    "### Conversation system prompt",
    "Treat the following system instructions as highest priority.",
    "",
    joined,
    "",
    "### End conversation system prompt",
  ].join("\n");
}

export function toInputItems(
  messages: BaseMessage[],
  mode: SystemPromptMode,
): CodexInputItem[] {
  const items: CodexInputItem[] = [];

  const queued =
    mode === "strict"
      ? messages.filter((message) => {
          if (message.getType() === "system") {
            return false;
          }

          return !(
            ChatMessage.isInstance(message) && message.role === "developer"
          );
        })
      : mode === "disabled"
        ? messages.filter((message) => {
            if (message.getType() === "system") {
              return false;
            }

            return !(
              ChatMessage.isInstance(message) && message.role === "developer"
            );
          })
        : messages;

  if (mode === "strict") {
    const texts = extractSystemTexts(messages);

    if (texts.length > 0) {
      items.push(messageItem("developer", formatSystemPromptStrict(texts)));
    }
  }

  for (const message of queued) {
    if (message.getType() === "human") {
      items.push(messageItem("user", contentToText(message.content)));
      continue;
    }

    if (message.getType() === "system") {
      items.push(messageItem("developer", contentToText(message.content)));
      continue;
    }

    if (ChatMessage.isInstance(message)) {
      if (message.role === "developer") {
        items.push(messageItem("developer", contentToText(message.content)));
        continue;
      }

      if (message.role === "assistant") {
        const text = contentToText(message.content);

        if (text) {
          items.push(messageItem("assistant", text));
        }

        continue;
      }

      items.push(messageItem("user", contentToText(message.content)));
      continue;
    }

    if (ToolMessage.isInstance(message)) {
      items.push(functionCallOutputItem(message.tool_call_id, message.content));
      continue;
    }

    if (AIMessage.isInstance(message)) {
      const text = contentToText(message.content);

      if (text) {
        items.push(messageItem("assistant", text));
      }

      for (const toolCall of message.tool_calls ?? []) {
        const id =
          typeof toolCall.id === "string" && toolCall.id.length > 0
            ? toolCall.id
            : `call_${randomUUID().replace(/-/gu, "")}`;

        items.push(
          functionCallItem(
            id,
            toolCall.name,
            isRecord(toolCall.args) ? toolCall.args : {},
          ),
        );
      }

      continue;
    }

    items.push(messageItem("user", contentToText(message.content)));
  }

  return items;
}

export function truncateAtStop(text: string, stop?: string[]): string {
  if (!stop || stop.length === 0) {
    return text;
  }

  let earliest: number | undefined;

  for (const token of stop) {
    if (!token) {
      continue;
    }

    const index = text.indexOf(token);

    if (index !== -1 && (earliest === undefined || index < earliest)) {
      earliest = index;
    }
  }

  return earliest === undefined ? text : text.slice(0, earliest);
}

import type { UsageMetadata } from "@langchain/core/messages";

import type {
  CodexInvalidToolCall,
  CodexToolCall,
  ParsedAssistantMessage,
} from "../client/types.js";
import { asInteger, asString, isRecord } from "../utils/json.js";

export function parseAssistantMessage(
  response: unknown,
): ParsedAssistantMessage {
  if (!isRecord(response)) {
    return {
      content: response == null ? "" : String(response),
      toolCalls: [],
      invalidToolCalls: [],
    };
  }

  const textParts: string[] = [];
  const toolCalls: CodexToolCall[] = [];
  const invalidToolCalls: CodexInvalidToolCall[] = [];

  if (Array.isArray(response.output)) {
    for (const item of response.output) {
      if (!isRecord(item)) {
        continue;
      }

      if (item.type === "message") {
        if (typeof item.content === "string") {
          textParts.push(item.content);
          continue;
        }

        if (Array.isArray(item.content)) {
          for (const block of item.content) {
            if (!isRecord(block)) {
              continue;
            }

            if (
              (block.type === "output_text" || block.type === "text") &&
              typeof block.text === "string"
            ) {
              textParts.push(block.text);
            }
          }
        }
      }

      if (item.type === "function_call") {
        const id = asString(item.call_id) ?? asString(item.id);
        const name = asString(item.name);

        if (!name) {
          continue;
        }

        if (isRecord(item.arguments)) {
          toolCalls.push({
            type: "tool_call",
            id,
            name,
            args: item.arguments,
          });
          continue;
        }

        if (typeof item.arguments === "string") {
          try {
            const parsed: unknown = JSON.parse(item.arguments);

            if (!isRecord(parsed)) {
              throw new Error("arguments must be a JSON object");
            }

            toolCalls.push({
              type: "tool_call",
              id,
              name,
              args: parsed,
            });
          } catch (error) {
            invalidToolCalls.push({
              type: "invalid_tool_call",
              id,
              name,
              args: item.arguments,
              error: error instanceof Error ? error.message : String(error),
            });
          }

          continue;
        }

        invalidToolCalls.push({
          type: "invalid_tool_call",
          id,
          name,
          error: "missing tool call arguments",
        });
      }
    }
  }

  if (textParts.length === 0 && typeof response.output_text === "string") {
    textParts.push(response.output_text);
  }

  return {
    content: textParts.join(""),
    toolCalls,
    invalidToolCalls,
  };
}

export function extractResponseMetadata(
  response: unknown,
): Record<string, unknown> {
  if (!isRecord(response)) {
    return {};
  }

  const metadata: Record<string, unknown> = {};
  const id = asString(response.id);
  const model = asString(response.model);
  const status = asString(response.status);
  const createdAt = asInteger(response.created_at);
  const finishReason = asString(response.finish_reason);

  if (id) {
    metadata.id = id;
  }

  if (model) {
    metadata.model = model;
  }

  if (status) {
    metadata.status = status;
  }

  if (createdAt !== undefined) {
    metadata.created_at = createdAt;
  }

  if (finishReason) {
    metadata.finish_reason = finishReason;
    return metadata;
  }

  const hasToolCalls = Array.isArray(response.output)
    ? response.output.some(
        (item) => isRecord(item) && item.type === "function_call",
      )
    : false;

  if (isRecord(response.incomplete_details)) {
    const reason = asString(response.incomplete_details.reason);

    if (reason) {
      metadata.finish_reason = reason.includes("token") ? "length" : reason;
      return metadata;
    }
  }

  if (hasToolCalls) {
    metadata.finish_reason = "tool_calls";
    return metadata;
  }

  if (status === "completed" || status === "done") {
    metadata.finish_reason = "stop";
  }

  return metadata;
}

export function extractUsageMetadata(
  response: unknown,
): UsageMetadata | undefined {
  if (!isRecord(response) || !isRecord(response.usage)) {
    return undefined;
  }

  const usage = response.usage;
  const inputTokens =
    asInteger(usage.input_tokens) ?? asInteger(usage.prompt_tokens);
  const outputTokens =
    asInteger(usage.output_tokens) ?? asInteger(usage.completion_tokens);
  const totalTokens =
    asInteger(usage.total_tokens) ??
    (inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined);

  if (
    inputTokens === undefined ||
    outputTokens === undefined ||
    totalTokens === undefined
  ) {
    return undefined;
  }

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
  };
}

export function extractToolCallItemAdded(event: Record<string, unknown>):
  | {
      outputIndex: number;
      callId: string;
      name?: string;
    }
  | undefined {
  if (event.type !== "response.output_item.added") {
    return undefined;
  }

  const outputIndex = asInteger(event.output_index);

  if (outputIndex === undefined || !isRecord(event.item)) {
    return undefined;
  }

  if (event.item.type !== "function_call") {
    return undefined;
  }

  const callId =
    asString(event.item.call_id) ??
    asString(event.item.id) ??
    asString(event.call_id);

  if (!callId) {
    return undefined;
  }

  return {
    outputIndex,
    callId,
    name: asString(event.item.name),
  };
}

export function extractToolCallArgsDelta(event: Record<string, unknown>):
  | {
      outputIndex: number;
      callId: string;
      delta: string;
    }
  | undefined {
  if (event.type !== "response.function_call_arguments.delta") {
    return undefined;
  }

  const outputIndex = asInteger(event.output_index);
  const callId = asString(event.call_id);
  const delta = asString(event.delta);

  if (outputIndex === undefined || !callId || !delta) {
    return undefined;
  }

  return {
    outputIndex,
    callId,
    delta,
  };
}

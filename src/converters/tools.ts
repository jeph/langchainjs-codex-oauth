import type { BindToolsInput } from "@langchain/core/language_models/chat_models"
import type { ToolDefinition } from "@langchain/core/language_models/base"
import { convertToOpenAITool } from "@langchain/core/utils/function_calling"

import { isRecord } from "../utils/json.js"

function isOpenAIToolSchema(
  value: unknown,
): value is { type: "function"; function: Record<string, unknown> } {
  return (
    isRecord(value) && value.type === "function" && isRecord(value.function)
  )
}

function isResponsesToolSchema(
  value: unknown,
): value is { type: "function"; name: string } & Record<string, unknown> {
  return (
    isRecord(value) &&
    value.type === "function" &&
    typeof value.name === "string"
  )
}

function isOpenAIFunctionSchema(
  value: unknown,
): value is { name: string; parameters: Record<string, unknown> } & Record<
  string,
  unknown
> {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    isRecord(value.parameters)
  )
}

export function convertTools(
  tools: BindToolsInput[],
): Array<Record<string, unknown>> {
  return tools.map((tool) => {
    if (isOpenAIToolSchema(tool)) {
      return {
        type: "function",
        ...tool.function,
      }
    }

    if (isResponsesToolSchema(tool)) {
      return tool
    }

    if (isOpenAIFunctionSchema(tool)) {
      return {
        type: "function",
        ...tool,
      }
    }

    const converted = convertToOpenAITool(tool) as ToolDefinition

    return {
      type: "function",
      ...converted.function,
    }
  })
}

export function normalizeToolChoice(
  toolChoice?: string | Record<string, unknown>,
): string | Record<string, unknown> | undefined {
  if (toolChoice == null) {
    return undefined
  }

  if (isOpenAIToolSchema(toolChoice)) {
    const name = toolChoice.function.name
    return typeof name === "string" ? { type: "function", name } : undefined
  }

  if (isResponsesToolSchema(toolChoice)) {
    return toolChoice
  }

  if (typeof toolChoice !== "string") {
    return toolChoice
  }

  const value = toolChoice.trim()
  const lowered = value.toLowerCase()

  if (lowered === "any") {
    return "required"
  }

  if (lowered === "auto" || lowered === "none" || lowered === "required") {
    return lowered
  }

  return {
    type: "function",
    name: value,
  }
}

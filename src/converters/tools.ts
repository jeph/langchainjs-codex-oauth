import type { BindToolsInput } from "@langchain/core/language_models/chat_models"
import type {
  FunctionCallOption,
  ToolDefinition,
} from "@langchain/core/language_models/base"
import { convertToOpenAITool } from "@langchain/core/utils/function_calling"

import type {
  CodexAllowedToolsChoice,
  CodexBackendTool,
  CodexCustomTool,
  CodexExperimentalTool,
  CodexFunctionTool,
  CodexToolChoice,
  CodexToolReference,
} from "../client/types.js"
import { isRecord } from "../utils/json.js"

function isOpenAIToolSchema(value: unknown): value is ToolDefinition {
  return (
    isRecord(value) && value.type === "function" && isRecord(value.function)
  )
}

function isCodexFunctionTool(value: unknown): value is CodexFunctionTool {
  return (
    isRecord(value) &&
    value.type === "function" &&
    typeof value.name === "string"
  )
}

function isCodexCustomTool(value: unknown): value is CodexCustomTool {
  return (
    isRecord(value) && value.type === "custom" && typeof value.name === "string"
  )
}

function isCodexExperimentalTool(
  value: unknown,
): value is CodexExperimentalTool {
  return (
    isRecord(value) &&
    typeof value.type === "string" &&
    value.type !== "function" &&
    value.type !== "custom" &&
    value.type !== "allowed_tools"
  )
}

function isCodexBackendTool(value: unknown): value is CodexBackendTool {
  return (
    isCodexFunctionTool(value) ||
    isCodexCustomTool(value) ||
    isCodexExperimentalTool(value)
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

function isFunctionCallOption(value: unknown): value is FunctionCallOption {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.type === "undefined"
  )
}

function isCodexToolReference(value: unknown): value is CodexToolReference {
  return (
    isRecord(value) &&
    typeof value.type === "string" &&
    value.type !== "allowed_tools" &&
    typeof value.name === "string"
  )
}

function isCodexAllowedToolsChoice(
  value: unknown,
): value is CodexAllowedToolsChoice {
  return (
    isRecord(value) &&
    value.type === "allowed_tools" &&
    (value.mode === "auto" || value.mode === "required") &&
    Array.isArray(value.tools) &&
    value.tools.every(isCodexToolReference)
  )
}

export function convertTools(tools: BindToolsInput[]): CodexBackendTool[] {
  return tools.map((tool) => {
    if (isOpenAIToolSchema(tool)) {
      return {
        type: "function",
        ...tool.function,
      }
    }

    if (isCodexBackendTool(tool)) {
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
  toolChoice?: unknown,
): CodexToolChoice | undefined {
  if (toolChoice == null) {
    return undefined
  }

  if (isOpenAIToolSchema(toolChoice)) {
    const name = toolChoice.function.name
    return typeof name === "string" ? { type: "function", name } : undefined
  }

  if (isFunctionCallOption(toolChoice)) {
    return { type: "function", name: toolChoice.name }
  }

  if (isCodexAllowedToolsChoice(toolChoice)) {
    return toolChoice
  }

  if (isCodexToolReference(toolChoice)) {
    return toolChoice
  }

  if (typeof toolChoice !== "string") {
    return undefined
  }

  const value = toolChoice.trim()
  if (!value) {
    return undefined
  }

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

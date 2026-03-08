import { CodexAPIError } from "../errors.js"

import type { CodexRequestParams } from "./types.js"

export type CodexRequestBody = Record<string, unknown>

export interface CompatibilityFallbackState {
  removedToolChoice: boolean
  removedTemperature: boolean
  removedMaxOutputTokens: boolean
}

export function createCompatibilityFallbackState(): CompatibilityFallbackState {
  return {
    removedToolChoice: false,
    removedTemperature: false,
    removedMaxOutputTokens: false,
  }
}

export function applyCompatibilityFallback(input: {
  body: CodexRequestBody
  error: CodexAPIError
  params: CodexRequestParams
  state: CompatibilityFallbackState
}):
  | {
      body: CodexRequestBody
      state: CompatibilityFallbackState
    }
  | undefined {
  const haystack = input.error.message.toLowerCase()

  if (
    !input.state.removedToolChoice &&
    input.params.toolChoice !== undefined &&
    input.error.statusCode === 400 &&
    haystack.includes("tool_choice")
  ) {
    const { tool_choice: _toolChoice, ...body } = input.body

    return {
      body,
      state: {
        ...input.state,
        removedToolChoice: true,
      },
    }
  }

  if (
    !input.state.removedTemperature &&
    input.params.temperature !== undefined &&
    input.error.statusCode === 400 &&
    haystack.includes("temperature")
  ) {
    const { temperature: _temperature, ...body } = input.body

    return {
      body,
      state: {
        ...input.state,
        removedTemperature: true,
      },
    }
  }

  if (
    !input.state.removedMaxOutputTokens &&
    input.params.maxOutputTokens !== undefined &&
    input.error.statusCode === 400 &&
    (haystack.includes("max_output_tokens") || haystack.includes("max_tokens"))
  ) {
    const { max_output_tokens: _maxOutputTokens, ...body } = input.body

    return {
      body,
      state: {
        ...input.state,
        removedMaxOutputTokens: true,
      },
    }
  }

  return undefined
}

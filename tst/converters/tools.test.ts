import { tool } from "langchain"
import { describe, expect, test } from "vitest"
import { z } from "zod"

import type {
  CodexAllowedToolsChoice,
  CodexCustomTool,
  CodexExperimentalTool,
  CodexFunctionTool,
} from "../../src/client/types.js"
import {
  convertTools,
  normalizeToolChoice,
} from "../../src/converters/tools.js"

describe("tool conversion", () => {
  test("converts LangChain tools into flattened function tools", () => {
    const add = tool(async ({ a, b }) => `${a + b}`, {
      name: "add_numbers",
      description: "Add two integers.",
      schema: z.object({
        a: z.number().int(),
        b: z.number().int(),
      }),
    })

    const converted = convertTools([add])

    expect(converted).toEqual([
      expect.objectContaining({
        type: "function",
        name: "add_numbers",
        description: "Add two integers.",
      }),
    ])
    expect((converted[0] as CodexFunctionTool).parameters).toMatchObject({
      type: "object",
      required: ["a", "b"],
    })
  })

  test("preserves backend-native tools without degrading them to records", () => {
    const customTool: CodexCustomTool = {
      type: "custom",
      name: "code_exec",
      description: "Execute a shell command.",
      format: {
        type: "grammar",
      },
    }
    const builtInTool: CodexExperimentalTool = {
      type: "web_search_preview",
      user_location: {
        type: "approximate",
      },
    }

    expect(convertTools([customTool, builtInTool])).toEqual([
      customTool,
      builtInTool,
    ])
  })
})

describe("tool choice normalization", () => {
  test("normalizes common LangChain and Responses tool choice shapes", () => {
    const allowedTools: CodexAllowedToolsChoice = {
      type: "allowed_tools",
      mode: "required",
      tools: [{ type: "function", name: "lookup_inventory" }],
    }

    expect(normalizeToolChoice("any")).toBe("required")
    expect(normalizeToolChoice("lookup_inventory")).toEqual({
      type: "function",
      name: "lookup_inventory",
    })
    expect(normalizeToolChoice({ name: "lookup_inventory" })).toEqual({
      type: "function",
      name: "lookup_inventory",
    })
    expect(
      normalizeToolChoice({
        type: "function",
        function: {
          name: "lookup_inventory",
          parameters: {
            type: "object",
            properties: {},
          },
        },
      }),
    ).toEqual({
      type: "function",
      name: "lookup_inventory",
    })
    expect(normalizeToolChoice(allowedTools)).toEqual(allowedTools)
  })

  test("drops unsupported tool choice objects instead of leaking raw records", () => {
    expect(normalizeToolChoice({ unsupported: true })).toBeUndefined()
  })
})

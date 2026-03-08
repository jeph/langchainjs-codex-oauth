import { describe, expect, test, vi } from "vitest"

import { CodexClient } from "../../src/client/index.js"

function streamFromText(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text))
      controller.close()
    },
  })
}

describe("CodexClient errors", () => {
  test("maps usage-limit 404 responses to 429", async () => {
    const response = new Response(
      JSON.stringify({
        error: {
          code: "usage_limit_reached",
        },
      }),
      {
        status: 404,
      },
    )

    const error = await CodexClient.toApiError(response)

    expect(error.statusCode).toBe(429)
    expect(error.message.toLowerCase()).toContain("usage limit")
  })

  test("sends an empty instructions string when none is provided", async () => {
    let capturedBody: Record<string, unknown> | undefined
    const client = new CodexClient({
      authStore: {
        load: async () => ({
          type: "oauth",
          access: "access",
          refresh: "refresh",
          expires: Date.now() + 60_000,
          accountId: "acct_123",
        }),
      } as never,
      fetchFn: vi.fn(async (_url, init) => {
        capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>

        return new Response(
          streamFromText(
            'data: {"type":"response.done","response":{"output":[],"status":"completed"}}\n\n',
          ),
          {
            status: 200,
            headers: {
              "Content-Type": "text/event-stream",
            },
          },
        )
      }),
      maxRetries: 0,
    })

    await client.complete({
      inputItems: [],
      model: "gpt-5.2-codex",
    })

    expect(capturedBody?.instructions).toBe("")
  })

  test("passes explicit instructions through verbatim", async () => {
    let capturedBody: Record<string, unknown> | undefined
    const client = new CodexClient({
      authStore: {
        load: async () => ({
          type: "oauth",
          access: "access",
          refresh: "refresh",
          expires: Date.now() + 60_000,
          accountId: "acct_123",
        }),
      } as never,
      fetchFn: vi.fn(async (_url, init) => {
        capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>

        return new Response(
          streamFromText(
            'data: {"type":"response.done","response":{"output":[],"status":"completed"}}\n\n',
          ),
          {
            status: 200,
            headers: {
              "Content-Type": "text/event-stream",
            },
          },
        )
      }),
      maxRetries: 0,
    })

    await client.complete({
      inputItems: [],
      model: "gpt-5.2-codex",
      instructions: "You are a router.",
    })

    expect(capturedBody?.instructions).toBe("You are a router.")
  })
})

import { describe, expect, test, vi } from "vitest"

import type { AuthStore, OAuthCredentials } from "../../src/auth/index.js"
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

function jwtForAccount(accountId: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      "https://api.openai.com/auth": {
        chatgpt_account_id: accountId,
      },
    }),
  ).toString("base64url")

  return `header.${payload}.signature`
}

function tokenResponse(input: {
  access: string
  refresh: string
  expiresIn?: number
}): Response {
  return new Response(
    JSON.stringify({
      access_token: input.access,
      refresh_token: input.refresh,
      expires_in: input.expiresIn ?? 3600,
    }),
    { status: 200 },
  )
}

function expiredCreds(refresh = "refresh_old"): OAuthCredentials {
  return {
    type: "oauth",
    access: "access_old",
    refresh,
    expires: Date.now() - 1000,
    accountId: "acct_old",
  }
}

function validAuthStore(): AuthStore {
  return {
    load: async () => ({
      type: "oauth",
      access: "access",
      refresh: "refresh",
      expires: Date.now() + 60_000,
      accountId: "acct_123",
    }),
  } as unknown as AuthStore
}

function successStreamResponse(
  response: Record<string, unknown> = { output: [], status: "completed" },
): Response {
  return new Response(
    streamFromText(
      `data: ${JSON.stringify({ type: "response.done", response })}\n\n`,
    ),
    {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
      },
    },
  )
}

function withoutPromptCacheKey(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const { prompt_cache_key: _promptCacheKey, ...rest } = body
  return rest
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
      model: "gpt-5.5",
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
      model: "gpt-5.5",
      instructions: "You are a router.",
    })

    expect(capturedBody?.instructions).toBe("You are a router.")
  })

  test("passes explicit priority service tier", async () => {
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
      model: "gpt-5.5",
      serviceTier: "priority",
    })

    expect(capturedBody?.service_tier).toBe("priority")
  })

  test("omits default service tier because backend default is implicit", async () => {
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
      model: "gpt-5.5",
      serviceTier: "default",
    })

    expect(capturedBody).not.toHaveProperty("service_tier")
  })

  test("sends a stable generated prompt cache key by default", async () => {
    const capturedBodies: Record<string, unknown>[] = []
    const client = new CodexClient({
      authStore: validAuthStore(),
      fetchFn: vi.fn(async (_url, init) => {
        capturedBodies.push(
          JSON.parse(String(init?.body)) as Record<string, unknown>,
        )
        return successStreamResponse()
      }),
      maxRetries: 0,
    })

    await client.complete({ inputItems: [], model: "gpt-5.5" })
    await client.complete({ inputItems: [], model: "gpt-5.5" })

    expect(capturedBodies).toHaveLength(2)
    expect(capturedBodies[0]?.prompt_cache_key).toEqual(
      expect.stringMatching(/^lcjs-codex-/u),
    )
    expect(capturedBodies[1]?.prompt_cache_key).toBe(
      capturedBodies[0]?.prompt_cache_key,
    )
  })

  test("generates different default prompt cache keys per client", async () => {
    const bodies: Record<string, unknown>[] = []
    const fetchFn = vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return successStreamResponse()
    })

    await new CodexClient({
      authStore: validAuthStore(),
      fetchFn,
      maxRetries: 0,
    }).complete({ inputItems: [], model: "gpt-5.5" })
    await new CodexClient({
      authStore: validAuthStore(),
      fetchFn,
      maxRetries: 0,
    }).complete({ inputItems: [], model: "gpt-5.5" })

    expect(bodies).toHaveLength(2)
    expect(bodies[0]?.prompt_cache_key).not.toBe(bodies[1]?.prompt_cache_key)
  })

  test("supports disabling prompt caching", async () => {
    let capturedBody: Record<string, unknown> | undefined
    const client = new CodexClient({
      authStore: validAuthStore(),
      promptCaching: false,
      fetchFn: vi.fn(async (_url, init) => {
        capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return successStreamResponse()
      }),
      maxRetries: 0,
    })

    await client.complete({ inputItems: [], model: "gpt-5.5" })

    expect(capturedBody).not.toHaveProperty("prompt_cache_key")
  })

  test("supports explicit and per-request prompt cache keys", async () => {
    const capturedBodies: Record<string, unknown>[] = []
    const client = new CodexClient({
      authStore: validAuthStore(),
      promptCacheKey: "constructor-cache-key",
      fetchFn: vi.fn(async (_url, init) => {
        capturedBodies.push(
          JSON.parse(String(init?.body)) as Record<string, unknown>,
        )
        return successStreamResponse()
      }),
      maxRetries: 0,
    })

    await client.complete({ inputItems: [], model: "gpt-5.5" })
    await client.complete({
      inputItems: [],
      model: "gpt-5.5",
      promptCacheKey: "call-cache-key",
    })

    expect(capturedBodies[0]?.prompt_cache_key).toBe("constructor-cache-key")
    expect(capturedBodies[1]?.prompt_cache_key).toBe("call-cache-key")
  })

  test("request-level prompt caching false wins over explicit cache keys", async () => {
    let capturedBody: Record<string, unknown> | undefined
    const client = new CodexClient({
      authStore: validAuthStore(),
      promptCacheKey: "constructor-cache-key",
      fetchFn: vi.fn(async (_url, init) => {
        capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return successStreamResponse()
      }),
      maxRetries: 0,
    })

    await client.complete({
      inputItems: [],
      model: "gpt-5.5",
      promptCaching: false,
      promptCacheKey: "ignored-call-cache-key",
    })

    expect(capturedBody).not.toHaveProperty("prompt_cache_key")
  })

  test("adding prompt caching only changes the prompt_cache_key field", async () => {
    const inputItems = [
      {
        type: "message" as const,
        role: "user" as const,
        content: [{ type: "input_text" as const, text: "Find the answer." }],
      },
      {
        type: "message" as const,
        role: "assistant" as const,
        content: [
          { type: "output_text" as const, text: "I will call a tool." },
        ],
      },
      {
        type: "function_call" as const,
        call_id: "call_lookup",
        name: "lookup",
        arguments: '{"id":1}',
      },
      {
        type: "function_call_output" as const,
        call_id: "call_lookup",
        output: "42",
      },
    ]
    const capturedBodies: Record<string, unknown>[] = []
    const fetchFn = vi.fn(async (_url, init) => {
      capturedBodies.push(
        JSON.parse(String(init?.body)) as Record<string, unknown>,
      )
      return successStreamResponse()
    })
    const params = {
      inputItems,
      model: "gpt-5.5",
      instructions: "You are careful.",
      reasoningEffort: "low" as const,
      textVerbosity: "high" as const,
      serviceTier: "priority" as const,
    }

    await new CodexClient({
      authStore: validAuthStore(),
      promptCacheKey: "cache-key",
      fetchFn,
      maxRetries: 0,
    }).complete(params)
    await new CodexClient({
      authStore: validAuthStore(),
      promptCaching: false,
      fetchFn,
      maxRetries: 0,
    }).complete(params)

    expect(capturedBodies[0]?.prompt_cache_key).toBe("cache-key")
    expect(withoutPromptCacheKey(capturedBodies[0]!)).toEqual(capturedBodies[1])
  })

  test("retries without prompt cache key if the backend rejects it", async () => {
    const capturedBodies: Record<string, unknown>[] = []
    const inputItems = [
      {
        type: "message" as const,
        role: "user" as const,
        content: [{ type: "input_text" as const, text: "Keep all context." }],
      },
      {
        type: "function_call_output" as const,
        call_id: "call_lookup",
        output: "tool output stays present",
      },
    ]
    const client = new CodexClient({
      authStore: validAuthStore(),
      promptCacheKey: "cache-key",
      fetchFn: vi.fn(async (_url, init) => {
        capturedBodies.push(
          JSON.parse(String(init?.body)) as Record<string, unknown>,
        )

        if (capturedBodies.length === 1) {
          return new Response(
            JSON.stringify({
              error: {
                code: "invalid_request_error",
                message: "Unknown parameter: prompt_cache_key",
              },
            }),
            { status: 400 },
          )
        }

        return successStreamResponse()
      }),
      maxRetries: 0,
    })

    await client.complete({
      inputItems,
      model: "gpt-5.5",
      instructions: "Never drop context.",
      maxOutputTokens: 20,
    })

    expect(capturedBodies).toHaveLength(2)
    expect(capturedBodies[0]?.prompt_cache_key).toBe("cache-key")
    expect(capturedBodies[1]).not.toHaveProperty("prompt_cache_key")
    expect(withoutPromptCacheKey(capturedBodies[0]!)).toEqual(capturedBodies[1])
  })
})

describe("CodexClient background auth refresh", () => {
  test("polls for expired credentials by default", async () => {
    vi.useFakeTimers()

    try {
      const access = jwtForAccount("acct_new")
      const save = vi.fn(async (_creds: OAuthCredentials) => undefined)
      const authStore = {
        authPath: "/tmp/lcjs-codex-default-background.json",
        load: vi.fn(async () => expiredCreds()),
        save,
      } as unknown as AuthStore
      const fetchFn = vi.fn(async () =>
        tokenResponse({ access, refresh: "refresh_new" }),
      )
      const client = new CodexClient({ authStore, fetchFn })

      await vi.advanceTimersByTimeAsync(29_999)
      expect(fetchFn).toHaveBeenCalledTimes(0)

      await vi.advanceTimersByTimeAsync(1)

      expect(fetchFn).toHaveBeenCalledTimes(1)
      expect(save).toHaveBeenCalledWith({
        type: "oauth",
        access,
        refresh: "refresh_new",
        expires: expect.any(Number),
        accountId: "acct_new",
      })

      client.stopBackgroundAuthRefresh()
    } finally {
      vi.useRealTimers()
    }
  })

  test("can disable background credential polling", async () => {
    vi.useFakeTimers()

    try {
      const authStore = {
        authPath: "/tmp/lcjs-codex-disabled-background.json",
        load: vi.fn(async () => expiredCreds()),
        save: vi.fn(async (_creds: OAuthCredentials) => undefined),
      } as unknown as AuthStore
      const fetchFn = vi.fn(async () =>
        tokenResponse({
          access: jwtForAccount("acct_new"),
          refresh: "refresh_new",
        }),
      )

      new CodexClient({
        authStore,
        fetchFn,
        backgroundAuthRefresh: false,
      })

      await vi.advanceTimersByTimeAsync(60_000)

      expect(authStore.load).toHaveBeenCalledTimes(0)
      expect(fetchFn).toHaveBeenCalledTimes(0)
    } finally {
      vi.useRealTimers()
    }
  })

  test("deduplicates concurrent refreshes for the same auth path", async () => {
    let resolveFetch: (response: Response) => void = () => undefined
    const access = jwtForAccount("acct_shared")
    const fetchFn = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )
    const authStore = (label: string): AuthStore =>
      ({
        authPath: "/tmp/lcjs-codex-shared-background.json",
        load: vi.fn(async () => expiredCreds(`refresh_${label}`)),
        save: vi.fn(async (_creds: OAuthCredentials) => undefined),
      }) as unknown as AuthStore
    const firstClient = new CodexClient({
      authStore: authStore("first"),
      fetchFn,
      backgroundAuthRefresh: false,
    })
    const secondClient = new CodexClient({
      authStore: authStore("second"),
      fetchFn,
      backgroundAuthRefresh: false,
    })

    const first = firstClient.refreshAuthIfNeeded()
    const second = secondClient.refreshAuthIfNeeded()

    await Promise.resolve()
    await Promise.resolve()
    expect(fetchFn).toHaveBeenCalledTimes(1)

    resolveFetch(tokenResponse({ access, refresh: "refresh_shared" }))

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({
        access,
        refresh: "refresh_shared",
        accountId: "acct_shared",
      }),
      expect.objectContaining({
        access,
        refresh: "refresh_shared",
        accountId: "acct_shared",
      }),
    ])
  })
})

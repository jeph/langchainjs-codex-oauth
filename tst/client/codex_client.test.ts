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

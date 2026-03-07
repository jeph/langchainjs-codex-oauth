import { setTimeout as sleep } from "node:timers/promises"

import { describe, expect, test } from "vitest"

import {
  parseAuthorizationInput,
  REDIRECT_URI,
  runLocalCallbackServer,
} from "../../src/auth/oauth.js"

async function deliverCallback(
  query: string,
): Promise<{ body: string; status: number }> {
  const callbackUrl = `${REDIRECT_URI}?${query}`

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(callbackUrl)
      return {
        body: await response.text(),
        status: response.status,
      }
    } catch (error) {
      if (attempt === 19) {
        throw error
      }

      await sleep(25)
    }
  }

  throw new Error("OAuth callback was never delivered.")
}

describe("runLocalCallbackServer", () => {
  test("returns undefined when the browser callback never arrives", async () => {
    await expect(runLocalCallbackServer(25)).resolves.toBeUndefined()
  })

  test("rejects explicit OAuth callback failures", async () => {
    const callback = runLocalCallbackServer(1_000)

    await deliverCallback(
      "state=abc123&error=access_denied&error_description=User%20denied%20access",
    )

    await expect(callback).rejects.toThrow(/User denied access/u)
  })

  test("rejects callbacks that omit the authorization code", async () => {
    const callback = runLocalCallbackServer(1_000)

    await deliverCallback("state=abc123")

    await expect(callback).rejects.toThrow(/authorization code/u)
  })

  test("rejects callbacks that omit the OAuth state", async () => {
    const callback = runLocalCallbackServer(1_000)
    const response = await deliverCallback("code=abc123")

    expect(response.status).toBe(400)
    expect(response.body).toContain("Missing OAuth state.")
    await expect(callback).rejects.toThrow(/OAuth state/u)
  })

  test("escapes reflected callback error descriptions", async () => {
    const callback = runLocalCallbackServer(1_000)
    const response = await deliverCallback(
      `state=abc123&error=access_denied&error_description=${encodeURIComponent('<script>alert("x")</script>')}`,
    )

    expect(response.status).toBe(400)
    expect(response.body).not.toContain("<script>")
    expect(response.body).toContain(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    )
    await expect(callback).rejects.toThrow(/script/u)
  })
})

describe("parseAuthorizationInput", () => {
  test("parses full redirect URLs", () => {
    expect(
      parseAuthorizationInput(`${REDIRECT_URI}?code=abc123&state=state123`),
    ).toEqual({
      code: "abc123",
      state: "state123",
    })
  })

  test("parses query-string input", () => {
    expect(parseAuthorizationInput("code=abc123&state=state123")).toEqual({
      code: "abc123",
      state: "state123",
    })
  })
})

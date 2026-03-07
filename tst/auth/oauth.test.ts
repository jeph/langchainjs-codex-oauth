import { setTimeout as sleep } from "node:timers/promises"

import { describe, expect, test } from "vitest"

import { REDIRECT_URI, runLocalCallbackServer } from "../../src/auth/oauth.js"

async function deliverCallback(query: string): Promise<void> {
  const callbackUrl = `${REDIRECT_URI}?${query}`

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(callbackUrl)
      await response.text()
      return
    } catch (error) {
      if (attempt === 19) {
        throw error
      }

      await sleep(25)
    }
  }
}

describe("runLocalCallbackServer", () => {
  test("returns undefined when the browser callback never arrives", async () => {
    await expect(runLocalCallbackServer(25)).resolves.toBeUndefined()
  })

  test("rejects explicit OAuth callback failures", async () => {
    const callback = runLocalCallbackServer(1_000)

    await deliverCallback(
      "error=access_denied&error_description=User%20denied%20access",
    )

    await expect(callback).rejects.toThrow(/User denied access/u)
  })

  test("rejects callbacks that omit the authorization code", async () => {
    const callback = runLocalCallbackServer(1_000)

    await deliverCallback("state=abc123")

    await expect(callback).rejects.toThrow(/authorization code/u)
  })
})

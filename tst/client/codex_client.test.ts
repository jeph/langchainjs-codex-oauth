import { describe, expect, test } from "vitest"

import { CodexClient } from "../../src/client/codex_client.js"

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
})

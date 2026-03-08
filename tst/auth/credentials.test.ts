import { describe, expect, test } from "vitest"

import { credentialsFromTokenResponse } from "../../src/auth/credentials.js"
import { OAuthFlowError } from "../../src/errors.js"

function base64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url")
}

function accessToken(payload: Record<string, unknown>): string {
  return [
    base64Url(JSON.stringify({ alg: "none", typ: "JWT" })),
    base64Url(JSON.stringify(payload)),
    "signature",
  ].join(".")
}

describe("credentialsFromTokenResponse", () => {
  test("derives OAuth credentials from a token response", () => {
    const creds = credentialsFromTokenResponse({
      token: {
        access: accessToken({
          "https://api.openai.com/auth": {
            chatgpt_account_id: "acct_123",
          },
        }),
        refresh: "refresh_123",
        expiresAtMs: 123_456,
      },
      errorType: OAuthFlowError,
      invalidTokenMessage: "invalid token",
      missingAccountIdMessage: "missing account id",
    })

    expect(creds).toEqual({
      type: "oauth",
      access: expect.any(String),
      refresh: "refresh_123",
      expires: 123_456,
      accountId: "acct_123",
    })
  })

  test("throws the requested error type for invalid tokens", () => {
    expect(() =>
      credentialsFromTokenResponse({
        token: {
          access: "not-a-jwt",
          refresh: "refresh_123",
          expiresAtMs: 123_456,
        },
        errorType: OAuthFlowError,
        invalidTokenMessage: "invalid token",
        missingAccountIdMessage: "missing account id",
      }),
    ).toThrowError(new OAuthFlowError("invalid token"))
  })
})

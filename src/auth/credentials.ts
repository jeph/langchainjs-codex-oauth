import type { OAuthCredentials } from "./store.js"
import {
  decodeJwtPayload,
  extractChatGPTAccountId,
  type TokenResponse,
} from "./oauth.js"

type AuthErrorConstructor = new (
  message: string,
  options?: { cause?: unknown },
) => Error

export function credentialsFromTokenResponse(input: {
  token: TokenResponse
  errorType: AuthErrorConstructor
  invalidTokenMessage: string
  missingAccountIdMessage: string
}): OAuthCredentials {
  const payload = decodeJwtPayload(input.token.access)

  if (!payload) {
    throw new input.errorType(input.invalidTokenMessage)
  }

  const accountId = extractChatGPTAccountId(payload)

  if (!accountId) {
    throw new input.errorType(input.missingAccountIdMessage)
  }

  return {
    type: "oauth",
    access: input.token.access,
    refresh: input.token.refresh,
    expires: input.token.expiresAtMs,
    accountId,
  }
}

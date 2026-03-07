import { setTimeout as sleep } from "node:timers/promises"

import { AuthStore, type OAuthCredentials } from "../auth/store.js"
import {
  decodeJwtPayload,
  extractChatGPTAccountId,
  refreshAccessToken,
} from "../auth/oauth.js"
import { CodexAPIError, NotAuthenticatedError } from "../errors.js"
import { normalizeModel } from "../converters/messages.js"
import { extractTextDelta, isTerminalEvent, iterSseEvents } from "./sse.js"
import { getCodexInstructions } from "./instructions.js"
import type { CodexRequestParams, CompletionResult } from "./types.js"
import { parseAssistantMessage } from "../converters/responses.js"
import { asString, isRecord, parseJsonObject } from "../utils/json.js"

export const CODEX_BASE_URL = "https://chatgpt.com/backend-api"
export const CODEX_RESPONSES_PATH = "/codex/responses"
export const DEFAULT_INCLUDE = ["reasoning.encrypted_content"]

export interface CodexClientOptions {
  authStore?: AuthStore
  authPath?: string
  baseURL?: string
  timeoutMs?: number
  maxRetries?: number
  fetchFn?: typeof fetch
}

function backoffMs(attempt: number): number {
  const base = Math.min(8_000, 500 * 2 ** attempt)
  return Math.round(base * (1 + Math.random() * 0.1))
}

function isRetryableStatus(statusCode?: number): boolean {
  return (
    statusCode === 429 ||
    statusCode === 500 ||
    statusCode === 502 ||
    statusCode === 503 ||
    statusCode === 504
  )
}

function combineSignals(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function isRetryableNetworkError(
  error: unknown,
  signal?: AbortSignal,
): boolean {
  if (signal?.aborted) {
    return false
  }

  return (
    error instanceof TypeError ||
    (error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError"))
  )
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return
  }

  if (signal.reason instanceof Error) {
    throw signal.reason
  }

  throw new Error("Request aborted.")
}

export class CodexClient {
  readonly authStore: AuthStore

  readonly baseURL: string

  readonly timeoutMs: number

  readonly maxRetries: number

  readonly fetchFn: typeof fetch

  constructor(options: CodexClientOptions = {}) {
    this.authStore = options.authStore ?? new AuthStore(options.authPath)
    this.baseURL = (options.baseURL ?? CODEX_BASE_URL).replace(/\/$/u, "")
    this.timeoutMs = options.timeoutMs ?? 60_000
    this.maxRetries = options.maxRetries ?? 2
    this.fetchFn = options.fetchFn ?? fetch
  }

  private async loadValidCredentials(): Promise<OAuthCredentials> {
    const creds = await this.authStore.load()

    if (creds.expires > Date.now()) {
      return creds
    }

    const refreshed = await refreshAccessToken({
      refreshToken: creds.refresh,
      fetchFn: this.fetchFn,
    })
    const payload = decodeJwtPayload(refreshed.access)

    if (!payload) {
      throw new NotAuthenticatedError(
        "Token refresh succeeded but the access token was invalid. Re-run `npx langchainjs-codex-oauth auth login`.",
      )
    }

    const accountId = extractChatGPTAccountId(payload)

    if (!accountId) {
      throw new NotAuthenticatedError(
        "Failed to derive chatgpt_account_id from the refreshed token. Re-run `npx langchainjs-codex-oauth auth login`.",
      )
    }

    const next: OAuthCredentials = {
      type: "oauth",
      access: refreshed.access,
      refresh: refreshed.refresh,
      expires: refreshed.expiresAtMs,
      accountId,
    }

    await this.authStore.save(next)
    return next
  }

  private buildHeaders(creds: OAuthCredentials): Headers {
    return new Headers({
      Accept: "text/event-stream",
      Authorization: `Bearer ${creds.access}`,
      "ChatGPT-Account-Id": creds.accountId,
      "Content-Type": "application/json",
      "OpenAI-Beta": "responses=experimental",
      originator: "codex_cli_rs",
    })
  }

  private buildRequestBody(
    params: CodexRequestParams,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: normalizeModel(params.model),
      store: false,
      stream: true,
      input: params.inputItems,
      include: params.include ?? DEFAULT_INCLUDE,
    }

    if (params.tools) {
      body.tools = params.tools
    }

    if (params.toolChoice) {
      body.tool_choice = params.toolChoice
    }

    if (params.temperature !== undefined) {
      body.temperature = params.temperature
    }

    if (params.maxOutputTokens !== undefined) {
      body.max_output_tokens = params.maxOutputTokens
    }

    if (params.reasoningEffort || params.reasoningSummary) {
      body.reasoning = {
        ...(params.reasoningEffort ? { effort: params.reasoningEffort } : {}),
        ...(params.reasoningSummary
          ? { summary: params.reasoningSummary }
          : {}),
      }
    }

    if (params.textVerbosity) {
      body.text = {
        verbosity: params.textVerbosity,
      }
    }

    return body
  }

  static async toApiError(response: Response): Promise<CodexAPIError> {
    let text = ""

    try {
      text = await response.text()
    } catch {
      // Ignore body parsing failures.
    }

    let statusCode = response.status
    let message = `Codex backend request failed (HTTP ${statusCode}).`

    const parsed = text ? parseJsonObject(text) : undefined
    const errorObject =
      parsed && isRecord(parsed.error) ? parsed.error : undefined
    const code = errorObject
      ? (asString(errorObject.code) ?? asString(errorObject.type))
      : undefined
    const detail = parsed ? asString(parsed.detail) : undefined

    if (code) {
      message = `Codex backend request failed (HTTP ${statusCode}, ${code}).`
    }

    const haystack = `${code ?? ""} ${detail ?? ""} ${text}`.toLowerCase()
    const usageLimit = [
      "usage_limit_reached",
      "usage_not_included",
      "rate_limit_exceeded",
      "usage limit",
      "too many requests",
    ].some((token) => haystack.includes(token))

    if (statusCode === 404 && usageLimit) {
      statusCode = 429
      message =
        "Codex usage limit reached for your ChatGPT subscription (treated as HTTP 429)."
    }

    if (text) {
      message = `${message} Response excerpt: ${text.slice(0, 1_000)}`
    }

    return new CodexAPIError(message, { statusCode })
  }

  async *streamEvents(
    params: CodexRequestParams,
  ): AsyncGenerator<Record<string, unknown>> {
    throwIfAborted(params.signal)

    const url = `${this.baseURL}${CODEX_RESPONSES_PATH}`
    const creds = await this.loadValidCredentials()
    const body = this.buildRequestBody(params)
    const baseInstructions = await getCodexInstructions(
      String(body.model),
      this.fetchFn,
    )

    body.instructions = params.extraInstructions
      ? `${baseInstructions}\n\n${params.extraInstructions}`.trim()
      : baseInstructions

    let removedExtraInstructions = false
    let removedToolChoice = false
    let removedTemperature = false
    let removedMaxOutputTokens = false
    let attempt = 0

    while (true) {
      throwIfAborted(params.signal)

      let response: Response

      try {
        response = await this.fetchFn(url, {
          method: "POST",
          headers: this.buildHeaders(creds),
          body: JSON.stringify(body),
          signal: combineSignals(this.timeoutMs, params.signal),
        })
      } catch (error) {
        if (
          attempt < this.maxRetries &&
          isRetryableNetworkError(error, params.signal)
        ) {
          await sleep(backoffMs(attempt))
          attempt += 1
          continue
        }

        throw new CodexAPIError("Network error calling Codex backend.", {
          cause: error,
        })
      }

      if (!response.ok) {
        const error = await CodexClient.toApiError(response)
        const haystack = error.message.toLowerCase()

        if (
          !removedExtraInstructions &&
          params.extraInstructions &&
          error.statusCode === 400 &&
          haystack.includes("instruction")
        ) {
          body.instructions = baseInstructions
          removedExtraInstructions = true
          continue
        }

        if (
          !removedToolChoice &&
          params.toolChoice !== undefined &&
          error.statusCode === 400 &&
          haystack.includes("tool_choice")
        ) {
          delete body.tool_choice
          removedToolChoice = true
          continue
        }

        if (
          !removedTemperature &&
          params.temperature !== undefined &&
          error.statusCode === 400 &&
          haystack.includes("temperature")
        ) {
          delete body.temperature
          removedTemperature = true
          continue
        }

        if (
          !removedMaxOutputTokens &&
          params.maxOutputTokens !== undefined &&
          error.statusCode === 400 &&
          (haystack.includes("max_output_tokens") ||
            haystack.includes("max_tokens"))
        ) {
          delete body.max_output_tokens
          removedMaxOutputTokens = true
          continue
        }

        if (attempt < this.maxRetries && isRetryableStatus(error.statusCode)) {
          await sleep(backoffMs(attempt))
          attempt += 1
          continue
        }

        throw error
      }

      if (!response.body) {
        return
      }

      for await (const event of iterSseEvents(response.body)) {
        yield event
      }

      return
    }
  }

  async completeWithResponse(
    params: CodexRequestParams,
  ): Promise<CompletionResult> {
    let response: Record<string, unknown> | null = null

    for await (const event of this.streamEvents(params)) {
      if (isTerminalEvent(event)) {
        response = isRecord(event.response) ? event.response : null
        break
      }
    }

    return {
      parsed: parseAssistantMessage(response),
      response,
    }
  }

  async complete(params: CodexRequestParams): Promise<string> {
    const result = await this.completeWithResponse(params)
    return result.parsed.content
  }

  async *streamText(params: CodexRequestParams): AsyncGenerator<string> {
    for await (const event of this.streamEvents(params)) {
      if (isTerminalEvent(event)) {
        return
      }

      const delta = extractTextDelta(event)

      if (delta) {
        yield delta
      }
    }
  }
}

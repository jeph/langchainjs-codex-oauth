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
import type {
  CodexInclude,
  CodexRequestParams,
  CompletionResult,
  ParsedAssistantMessage,
} from "./types.js"
import {
  extractToolCallArgsDelta,
  extractToolCallItemAdded,
  parseAssistantMessage,
} from "../converters/responses.js"
import { asString, isRecord, parseJsonObject } from "../utils/json.js"

export const CODEX_BASE_URL = "https://chatgpt.com/backend-api"
export const CODEX_RESPONSES_PATH = "/codex/responses"
export const DEFAULT_INCLUDE: CodexInclude[] = ["reasoning.encrypted_content"]

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

interface RequestRetryState {
  readonly attempt: number
  readonly includeToolChoice: boolean
  readonly includeTemperature: boolean
  readonly includeMaxOutputTokens: boolean
}

type RequestAttemptResult =
  | {
      readonly kind: "response"
      readonly response: Response
    }
  | {
      readonly kind: "retry"
      readonly retryState: RequestRetryState
    }

const INITIAL_RETRY_STATE: RequestRetryState = {
  attempt: 0,
  includeToolChoice: true,
  includeTemperature: true,
  includeMaxOutputTokens: true,
}

interface StreamedToolCallState {
  name?: string
  args: string
  outputIndex?: number
}

function parseStreamedAssistantMessage(
  text: string,
  toolCalls: ReadonlyMap<string, StreamedToolCallState>,
): ParsedAssistantMessage {
  const sortedToolCalls = [...toolCalls.entries()].sort(
    ([, left], [, right]) =>
      (left.outputIndex ?? Number.MAX_SAFE_INTEGER) -
      (right.outputIndex ?? Number.MAX_SAFE_INTEGER),
  )
  const parsed = sortedToolCalls.map(([id, toolCall]) => {
    if (!toolCall.name) {
      return {}
    }

    try {
      const args: unknown = JSON.parse(toolCall.args)

      if (!isRecord(args)) {
        throw new Error("arguments must be a JSON object")
      }

      return {
        toolCall: {
          type: "tool_call" as const,
          id,
          name: toolCall.name,
          args,
        },
      }
    } catch (error) {
      return {
        invalidToolCall: {
          type: "invalid_tool_call" as const,
          id,
          name: toolCall.name,
          args: toolCall.args,
          error: error instanceof Error ? error.message : String(error),
        },
      }
    }
  })

  return {
    content: text,
    toolCalls: parsed.flatMap(({ toolCall }) => (toolCall ? [toolCall] : [])),
    invalidToolCalls: parsed.flatMap(({ invalidToolCall }) =>
      invalidToolCall ? [invalidToolCall] : [],
    ),
  }
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
    retryState: RequestRetryState = INITIAL_RETRY_STATE,
  ): Record<string, unknown> {
    const reasoning =
      params.reasoningEffort || params.reasoningSummary
        ? {
            ...(params.reasoningEffort
              ? { effort: params.reasoningEffort }
              : {}),
            ...(params.reasoningSummary
              ? { summary: params.reasoningSummary }
              : {}),
          }
        : undefined
    const text = params.textVerbosity
      ? {
          verbosity: params.textVerbosity,
        }
      : undefined

    return {
      model: normalizeModel(params.model),
      store: false,
      stream: true,
      input: params.inputItems,
      include: params.include ?? DEFAULT_INCLUDE,
      instructions: params.instructions ?? "",
      ...(params.tools ? { tools: params.tools } : {}),
      ...(retryState.includeToolChoice && params.toolChoice !== undefined
        ? { tool_choice: params.toolChoice }
        : {}),
      ...(retryState.includeTemperature && params.temperature !== undefined
        ? { temperature: params.temperature }
        : {}),
      ...(retryState.includeMaxOutputTokens &&
      params.maxOutputTokens !== undefined
        ? { max_output_tokens: params.maxOutputTokens }
        : {}),
      ...(reasoning ? { reasoning } : {}),
      ...(text ? { text } : {}),
    }
  }

  static async toApiError(response: Response): Promise<CodexAPIError> {
    const text = await response.text().catch(() => "")
    const parsed = text ? parseJsonObject(text) : undefined
    const errorObject =
      parsed && isRecord(parsed.error) ? parsed.error : undefined
    const code = errorObject
      ? (asString(errorObject.code) ?? asString(errorObject.type))
      : undefined
    const detail = parsed ? asString(parsed.detail) : undefined

    const haystack = `${code ?? ""} ${detail ?? ""} ${text}`.toLowerCase()
    const usageLimit = [
      "usage_limit_reached",
      "usage_not_included",
      "rate_limit_exceeded",
      "usage limit",
      "too many requests",
    ].some((token) => haystack.includes(token))

    const normalized =
      response.status === 404 && usageLimit
        ? {
            statusCode: 429,
            message:
              "Codex usage limit reached for your ChatGPT subscription (treated as HTTP 429).",
          }
        : {
            statusCode: response.status,
            message: code
              ? `Codex backend request failed (HTTP ${response.status}, ${code}).`
              : `Codex backend request failed (HTTP ${response.status}).`,
          }

    const message = text
      ? `${normalized.message} Response excerpt: ${text.slice(0, 1_000)}`
      : normalized.message

    return new CodexAPIError(message, { statusCode: normalized.statusCode })
  }

  private async nextAttemptState(
    retryState: RequestRetryState,
  ): Promise<RequestRetryState> {
    await sleep(backoffMs(retryState.attempt))

    return {
      ...retryState,
      attempt: retryState.attempt + 1,
    }
  }

  private async sendRequest(
    url: string,
    creds: OAuthCredentials,
    params: CodexRequestParams,
    retryState: RequestRetryState,
  ): Promise<RequestAttemptResult> {
    throwIfAborted(params.signal)

    try {
      return {
        kind: "response",
        response: await this.fetchFn(url, {
          method: "POST",
          headers: this.buildHeaders(creds),
          body: JSON.stringify(this.buildRequestBody(params, retryState)),
          signal: combineSignals(this.timeoutMs, params.signal),
        }),
      }
    } catch (error) {
      if (
        retryState.attempt < this.maxRetries &&
        isRetryableNetworkError(error, params.signal)
      ) {
        return {
          kind: "retry",
          retryState: await this.nextAttemptState(retryState),
        }
      }

      throw new CodexAPIError("Network error calling Codex backend.", {
        cause: error,
      })
    }
  }

  private async nextRetryStateForError(
    params: CodexRequestParams,
    retryState: RequestRetryState,
    error: CodexAPIError,
  ): Promise<RequestRetryState | undefined> {
    const haystack = error.message.toLowerCase()

    if (
      retryState.includeToolChoice &&
      params.toolChoice !== undefined &&
      error.statusCode === 400 &&
      haystack.includes("tool_choice")
    ) {
      return {
        ...retryState,
        includeToolChoice: false,
      }
    }

    if (
      retryState.includeTemperature &&
      params.temperature !== undefined &&
      error.statusCode === 400 &&
      haystack.includes("temperature")
    ) {
      return {
        ...retryState,
        includeTemperature: false,
      }
    }

    if (
      retryState.includeMaxOutputTokens &&
      params.maxOutputTokens !== undefined &&
      error.statusCode === 400 &&
      (haystack.includes("max_output_tokens") ||
        haystack.includes("max_tokens"))
    ) {
      return {
        ...retryState,
        includeMaxOutputTokens: false,
      }
    }

    return retryState.attempt < this.maxRetries &&
      isRetryableStatus(error.statusCode)
      ? this.nextAttemptState(retryState)
      : undefined
  }

  private async *streamEventsWithRetry(
    url: string,
    creds: OAuthCredentials,
    params: CodexRequestParams,
    retryState: RequestRetryState,
  ): AsyncGenerator<Record<string, unknown>> {
    const result = await this.sendRequest(url, creds, params, retryState)

    if (result.kind === "retry") {
      yield* this.streamEventsWithRetry(url, creds, params, result.retryState)
      return
    }

    const { response } = result

    if (!response.ok) {
      const error = await CodexClient.toApiError(response)
      const nextRetryState = await this.nextRetryStateForError(
        params,
        retryState,
        error,
      )

      if (nextRetryState) {
        yield* this.streamEventsWithRetry(url, creds, params, nextRetryState)
        return
      }

      throw error
    }

    if (!response.body) {
      return
    }

    for await (const event of iterSseEvents(response.body)) {
      yield event
    }
  }

  async *streamEvents(
    params: CodexRequestParams,
  ): AsyncGenerator<Record<string, unknown>> {
    throwIfAborted(params.signal)

    const url = `${this.baseURL}${CODEX_RESPONSES_PATH}`
    const creds = await this.loadValidCredentials()

    yield* this.streamEventsWithRetry(url, creds, params, INITIAL_RETRY_STATE)
  }

  async completeWithResponse(
    params: CodexRequestParams,
  ): Promise<CompletionResult> {
    let response: Record<string, unknown> | null = null
    let streamedText = ""
    const itemIds = new Map<string, string>()
    const streamedToolCalls = new Map<string, StreamedToolCallState>()

    for await (const event of this.streamEvents(params)) {
      if (isTerminalEvent(event)) {
        response = isRecord(event.response) ? event.response : null
        break
      }

      const textDelta = extractTextDelta(event)

      if (textDelta) {
        streamedText += textDelta
      }

      const addedToolCall = extractToolCallItemAdded(event)

      if (addedToolCall) {
        if (addedToolCall.itemId) {
          itemIds.set(addedToolCall.itemId, addedToolCall.callId)
        }

        const current = streamedToolCalls.get(addedToolCall.callId)
        streamedToolCalls.set(addedToolCall.callId, {
          name: addedToolCall.name ?? current?.name,
          args: current?.args ?? "",
          outputIndex: addedToolCall.outputIndex,
        })
        continue
      }

      const toolCallArgs = extractToolCallArgsDelta(event)

      if (!toolCallArgs) {
        continue
      }

      const callId =
        toolCallArgs.callId ??
        (toolCallArgs.itemId ? itemIds.get(toolCallArgs.itemId) : undefined)

      if (!callId) {
        continue
      }

      const current = streamedToolCalls.get(callId)
      streamedToolCalls.set(callId, {
        name: current?.name,
        args: `${current?.args ?? ""}${toolCallArgs.delta}`,
        outputIndex: current?.outputIndex ?? toolCallArgs.outputIndex,
      })
    }

    const parsed = parseAssistantMessage(response)

    if (!response) {
      return {
        parsed,
        response,
      }
    }

    const streamed = parseStreamedAssistantMessage(
      streamedText,
      streamedToolCalls,
    )

    return {
      parsed: {
        content: parsed.content === "" ? streamed.content : parsed.content,
        toolCalls:
          parsed.toolCalls.length === 0 && parsed.invalidToolCalls.length === 0
            ? streamed.toolCalls
            : parsed.toolCalls,
        invalidToolCalls:
          parsed.toolCalls.length === 0 && parsed.invalidToolCalls.length === 0
            ? streamed.invalidToolCalls
            : parsed.invalidToolCalls,
      },
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

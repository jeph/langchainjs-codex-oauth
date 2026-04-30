import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager"
import {
  BaseChatModel,
  type BindToolsInput,
  type LangSmithParams,
} from "@langchain/core/language_models/chat_models"
import {
  assembleStructuredOutputPipeline,
  createFunctionCallingParser,
} from "@langchain/core/language_models/structured_output"
import type {
  BaseLanguageModelInput,
  StructuredOutputMethodOptions,
} from "@langchain/core/language_models/base"
import {
  AIMessage,
  AIMessageChunk,
  type BaseMessage,
  type ToolCallChunk,
} from "@langchain/core/messages"
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs"
import { Runnable } from "@langchain/core/runnables"
import { toJsonSchema } from "@langchain/core/utils/json_schema"
import {
  isSerializableSchema,
  type SerializableSchema,
} from "@langchain/core/utils/standard_schema"
import {
  getSchemaDescription,
  isInteropZodSchema,
  type InteropZodType,
} from "@langchain/core/utils/types"
import type { ZodType } from "zod"

import { AuthStore } from "../auth/store.js"
import { CodexClient } from "../client/codex_client.js"
import type {
  CodexBackendTool,
  CodexInclude,
  CodexRequestParams,
  ReasoningEffort,
  ReasoningSummary,
  TextVerbosity,
} from "../client/types.js"
import { extractTextDelta, isTerminalEvent } from "../client/sse.js"
import {
  buildInstructions,
  ensureToolCallIds,
  findEarliestStopIndex,
  toInputItems,
  truncateAtStop,
} from "../converters/messages.js"
import {
  extractResponseMetadata,
  extractToolCallArgsDelta,
  extractToolCallItemAdded,
  extractUsageMetadata,
  parseAssistantMessage,
} from "../converters/responses.js"
import { convertTools, normalizeToolChoice } from "../converters/tools.js"
import { VERSION } from "../version.js"
import { getEnvironmentVariable } from "../utils/env.js"
import type {
  ChatCodexOAuthCallOptions,
  ChatCodexOAuthParams,
} from "./types.js"

const BASE_URL_ENV = "LANGCHAINJS_CODEX_OAUTH_BASE_URL"
const TEMPERATURE_ENV = "LANGCHAINJS_CODEX_OAUTH_TEMPERATURE"
const MAX_TOKENS_ENV = "LANGCHAINJS_CODEX_OAUTH_MAX_TOKENS"
const TIMEOUT_ENV = "LANGCHAINJS_CODEX_OAUTH_TIMEOUT_S"
const MAX_RETRIES_ENV = "LANGCHAINJS_CODEX_OAUTH_MAX_RETRIES"

function parseIntegerEnv(name: string): number | undefined {
  const raw = getEnvironmentVariable(name)

  if (!raw) {
    return undefined
  }

  const value = Number.parseInt(raw, 10)
  return Number.isInteger(value) ? value : undefined
}

function parseFloatEnv(name: string): number | undefined {
  const raw = getEnvironmentVariable(name)

  if (!raw) {
    return undefined
  }

  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? value : undefined
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

interface RequestState {
  tools?: CodexBackendTool[]
  toolChoice?: CodexRequestParams["toolChoice"]
  temperature?: number
  maxOutputTokens?: number
  reasoningEffort?: ReasoningEffort
  reasoningSummary?: ReasoningSummary
  textVerbosity?: TextVerbosity
  serviceTier?: CodexRequestParams["serviceTier"]
  promptCaching?: boolean
  promptCacheKey?: string
  include?: CodexInclude[]
  instructions: string
}

interface StreamState {
  readonly itemIds: ReadonlyMap<string, string>
  readonly names: ReadonlyMap<string, string | undefined>
  readonly indexes: ReadonlyMap<string, number>
  readonly buffer: string
  readonly stopped: boolean
}

interface StreamStep {
  readonly state: StreamState
  readonly textOutputs: readonly string[]
  readonly chunk?: ChatGenerationChunk
  readonly terminalChunk?: ChatGenerationChunk
  readonly done: boolean
}

type ToolCallItemAdded = NonNullable<
  ReturnType<typeof extractToolCallItemAdded>
>
type ToolCallArgsDelta = NonNullable<
  ReturnType<typeof extractToolCallArgsDelta>
>

const INITIAL_STREAM_STATE: StreamState = {
  itemIds: new Map<string, string>(),
  names: new Map<string, string | undefined>(),
  indexes: new Map<string, number>(),
  buffer: "",
  stopped: false,
}

function withMapValue<K, V>(
  map: ReadonlyMap<K, V>,
  key: K,
  value: V,
): ReadonlyMap<K, V> {
  return new Map([...map, [key, value]])
}

function structuredOutputFunctionName(
  schema:
    | Record<string, unknown>
    | SerializableSchema
    | InteropZodType
    | ZodType,
  configuredName?: string,
): string {
  if (configuredName) {
    return configuredName
  }

  return !isInteropZodSchema(schema) &&
    !isSerializableSchema(schema) &&
    typeof schema === "object" &&
    schema !== null &&
    "name" in schema &&
    typeof schema.name === "string"
    ? schema.name
    : "extract"
}

export class ChatCodexOAuth extends BaseChatModel<
  ChatCodexOAuthCallOptions,
  AIMessageChunk
> {
  static override lc_name(): string {
    return "ChatCodexOAuth"
  }

  override lc_serializable = true

  override lc_namespace = ["langchain", "chat_models", "codex_oauth"]

  model: string

  temperature?: number

  maxTokens?: number

  reasoningEffort?: ReasoningEffort

  reasoningSummary?: ReasoningSummary

  textVerbosity?: TextVerbosity

  serviceTier?: CodexRequestParams["serviceTier"]

  promptCaching: boolean

  promptCacheKey?: string

  include?: CodexInclude[]

  timeout: number

  maxRetries: number

  baseURL: string

  authPath?: string

  backgroundAuthRefresh: ChatCodexOAuthParams["backgroundAuthRefresh"]

  readonly client: CodexClient

  constructor(fields: ChatCodexOAuthParams = {}) {
    super(fields)
    this._addVersion("langchainjs-codex-oauth", VERSION)
    this.model = fields.model ?? "gpt-5.5"
    this.temperature = fields.temperature ?? parseFloatEnv(TEMPERATURE_ENV)
    this.maxTokens = fields.maxTokens ?? parseIntegerEnv(MAX_TOKENS_ENV)
    this.reasoningEffort = fields.reasoningEffort ?? "medium"
    this.reasoningSummary = fields.reasoningSummary
    this.textVerbosity = fields.textVerbosity ?? "medium"
    this.serviceTier = fields.serviceTier
    this.promptCaching = fields.promptCaching ?? true
    this.promptCacheKey = fields.promptCacheKey
    this.include = fields.include ?? ["reasoning.encrypted_content"]
    this.timeout = fields.timeout ?? (parseFloatEnv(TIMEOUT_ENV) ?? 60) * 1000
    this.maxRetries = fields.maxRetries ?? parseIntegerEnv(MAX_RETRIES_ENV) ?? 2
    this.baseURL =
      fields.baseURL ??
      getEnvironmentVariable(BASE_URL_ENV) ??
      "https://chatgpt.com/backend-api"
    this.authPath = fields.authPath
    this.backgroundAuthRefresh = fields.backgroundAuthRefresh
    this.client = new CodexClient({
      authStore: new AuthStore(fields.authPath),
      baseURL: this.baseURL,
      timeoutMs: this.timeout,
      maxRetries: this.maxRetries,
      backgroundAuthRefresh: this.backgroundAuthRefresh,
      promptCaching: this.promptCaching,
      promptCacheKey: this.promptCacheKey,
    })
  }

  stopBackgroundAuthRefresh(): void {
    this.client.stopBackgroundAuthRefresh()
  }

  override get lc_aliases(): Record<string, string> {
    return {
      modelName: "model",
    }
  }

  override get callKeys(): string[] {
    return [
      ...super.callKeys,
      "tools",
      "tool_choice",
      "temperature",
      "maxTokens",
      "stop",
      "reasoningEffort",
      "reasoningSummary",
      "textVerbosity",
      "serviceTier",
      "promptCaching",
      "promptCacheKey",
      "include",
    ]
  }

  _llmType(): string {
    return "codex_oauth"
  }

  override getLsParams(options: this["ParsedCallOptions"]): LangSmithParams {
    return {
      ls_provider: "codex_oauth",
      ls_model_name: this.model,
      ls_model_type: "chat",
      ls_temperature: options.temperature ?? this.temperature,
      ls_max_tokens: options.maxTokens ?? this.maxTokens,
      ls_stop: options.stop,
    }
  }

  override invocationParams(
    options?: this["ParsedCallOptions"],
  ): Record<string, unknown> {
    return {
      model: this.model,
      temperature: options?.temperature ?? this.temperature,
      max_output_tokens: options?.maxTokens ?? this.maxTokens,
      tool_choice: normalizeToolChoice(options?.tool_choice),
      reasoning: {
        ...((options?.reasoningEffort ?? this.reasoningEffort)
          ? { effort: options?.reasoningEffort ?? this.reasoningEffort }
          : {}),
        ...((options?.reasoningSummary ?? this.reasoningSummary)
          ? { summary: options?.reasoningSummary ?? this.reasoningSummary }
          : {}),
      },
      text:
        (options?.textVerbosity ?? this.textVerbosity)
          ? { verbosity: options?.textVerbosity ?? this.textVerbosity }
          : undefined,
      service_tier:
        (options?.serviceTier ?? this.serviceTier) === "priority"
          ? "priority"
          : undefined,
      prompt_cache_key:
        (options?.promptCaching ?? this.promptCaching) === false
          ? undefined
          : (options?.promptCacheKey ?? this.promptCacheKey),
      include: options?.include ?? this.include,
    }
  }

  override bindTools(
    tools: BindToolsInput[],
    kwargs?: Partial<ChatCodexOAuthCallOptions>,
  ): Runnable<
    BaseLanguageModelInput,
    AIMessageChunk,
    ChatCodexOAuthCallOptions
  > {
    return this.withConfig({
      ...kwargs,
      tool_choice: normalizeToolChoice(kwargs?.tool_choice),
      tools,
    } as Partial<ChatCodexOAuthCallOptions>)
  }

  override withStructuredOutput<RunOutput extends Record<string, unknown>>(
    outputSchema: SerializableSchema<RunOutput>,
    config?: StructuredOutputMethodOptions<false>,
  ): Runnable<BaseLanguageModelInput, RunOutput>
  override withStructuredOutput<RunOutput extends Record<string, unknown>>(
    outputSchema: SerializableSchema<RunOutput>,
    config?: StructuredOutputMethodOptions<true>,
  ): Runnable<
    BaseLanguageModelInput,
    {
      raw: BaseMessage
      parsed: RunOutput
    }
  >
  override withStructuredOutput<RunOutput extends Record<string, unknown>>(
    outputSchema: InteropZodType<RunOutput> | Record<string, unknown>,
    config?: StructuredOutputMethodOptions<false>,
  ): Runnable<BaseLanguageModelInput, RunOutput>
  override withStructuredOutput<RunOutput extends Record<string, unknown>>(
    outputSchema: InteropZodType<RunOutput> | Record<string, unknown>,
    config?: StructuredOutputMethodOptions<true>,
  ): Runnable<
    BaseLanguageModelInput,
    {
      raw: BaseMessage
      parsed: RunOutput
    }
  >
  override withStructuredOutput<RunOutput extends Record<string, unknown>>(
    outputSchema: ZodType<RunOutput> | Record<string, unknown>,
    config?: StructuredOutputMethodOptions<false>,
  ): Runnable<BaseLanguageModelInput, RunOutput>
  override withStructuredOutput<RunOutput extends Record<string, unknown>>(
    outputSchema: ZodType<RunOutput> | Record<string, unknown>,
    config?: StructuredOutputMethodOptions<true>,
  ): Runnable<
    BaseLanguageModelInput,
    {
      raw: BaseMessage
      parsed: RunOutput
    }
  >
  override withStructuredOutput<RunOutput extends Record<string, unknown>>(
    outputSchema:
      | SerializableSchema<RunOutput>
      | InteropZodType<RunOutput>
      | ZodType<RunOutput>
      | Record<string, unknown>,
    config?: StructuredOutputMethodOptions<boolean>,
  ):
    | Runnable<BaseLanguageModelInput, RunOutput>
    | Runnable<
        BaseLanguageModelInput,
        {
          raw: BaseMessage
          parsed: RunOutput
        }
      > {
    if (config?.strict) {
      throw new Error(
        '"strict" mode is not supported for this model by default.',
      )
    }

    if (config?.method === "jsonMode") {
      throw new Error(
        'Base withStructuredOutput implementation only supports "functionCalling" as a method.',
      )
    }

    const schema = outputSchema
    const description =
      getSchemaDescription(schema) ?? "A function available to call."
    const functionName = structuredOutputFunctionName(schema, config?.name)

    const asJsonSchema =
      isInteropZodSchema(schema) || isSerializableSchema(schema)
        ? toJsonSchema(schema)
        : schema
    const tools = [
      {
        type: "function" as const,
        function: {
          name: functionName,
          description,
          parameters: asJsonSchema,
        },
      },
    ]
    const outputParser = createFunctionCallingParser(schema, functionName)

    return assembleStructuredOutputPipeline(
      this.bindTools(tools),
      outputParser,
      config?.includeRaw,
      config?.includeRaw ? "StructuredOutputRunnable" : "StructuredOutput",
    ) as
      | Runnable<BaseLanguageModelInput, RunOutput>
      | Runnable<
          BaseLanguageModelInput,
          {
            raw: BaseMessage
            parsed: RunOutput
          }
        >
  }

  private buildRequestState(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
  ): RequestState {
    return {
      tools: options.tools?.length ? convertTools(options.tools) : undefined,
      toolChoice: normalizeToolChoice(options.tool_choice),
      temperature: options.temperature ?? this.temperature,
      maxOutputTokens: options.maxTokens ?? this.maxTokens,
      reasoningEffort: options.reasoningEffort ?? this.reasoningEffort,
      reasoningSummary: options.reasoningSummary ?? this.reasoningSummary,
      textVerbosity: options.textVerbosity ?? this.textVerbosity,
      serviceTier: options.serviceTier ?? this.serviceTier,
      promptCaching: options.promptCaching,
      promptCacheKey: options.promptCacheKey,
      include: options.include ?? this.include,
      instructions: buildInstructions(messages),
    }
  }

  private buildClientRequest(
    messages: BaseMessage[],
    state: RequestState,
    signal?: AbortSignal,
  ): CodexRequestParams {
    return {
      inputItems: toInputItems(messages),
      model: this.model,
      tools: state.tools,
      toolChoice: state.toolChoice,
      temperature: state.temperature,
      maxOutputTokens: state.maxOutputTokens,
      reasoningEffort: state.reasoningEffort,
      reasoningSummary: state.reasoningSummary,
      textVerbosity: state.textVerbosity,
      serviceTier: state.serviceTier,
      promptCaching: state.promptCaching,
      promptCacheKey: state.promptCacheKey,
      include: state.include,
      instructions: state.instructions,
      signal,
    }
  }

  private async *emitTextChunk(
    text: string,
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    if (!text) {
      return
    }

    const chunk = new ChatGenerationChunk({
      message: new AIMessageChunk({
        content: text,
      }),
      text,
    })

    yield chunk
    await runManager?.handleLLMNewToken(
      text,
      undefined,
      undefined,
      undefined,
      undefined,
      { chunk },
    )
  }

  private createTerminalChunk(
    event: Record<string, unknown>,
  ): ChatGenerationChunk {
    const rawResponse =
      typeof event.response === "object" && event.response !== null
        ? (event.response as Record<string, unknown>)
        : null
    const parsed = rawResponse
      ? {
          responseMetadata: extractResponseMetadata(rawResponse),
          usageMetadata: extractUsageMetadata(rawResponse),
        }
      : { responseMetadata: {}, usageMetadata: undefined }
    const assistant = rawResponse
      ? parseAssistantMessage(rawResponse)
      : undefined
    const result = assistant ? ensureToolCallIds(assistant.toolCalls) : []
    const invalid = assistant?.invalidToolCalls ?? []

    return new ChatGenerationChunk({
      message: new AIMessageChunk({
        content: "",
        tool_calls: result,
        invalid_tool_calls: invalid,
        response_metadata: parsed.responseMetadata,
        usage_metadata: parsed.usageMetadata,
      }),
      text: "",
      generationInfo: parsed.responseMetadata,
    })
  }

  private streamStateWithAddedToolCall(
    streamState: StreamState,
    added: ToolCallItemAdded,
  ): StreamState {
    return {
      ...streamState,
      itemIds: added.itemId
        ? withMapValue(streamState.itemIds, added.itemId, added.callId)
        : streamState.itemIds,
      names: withMapValue(streamState.names, added.callId, added.name),
      indexes: withMapValue(
        streamState.indexes,
        added.callId,
        added.outputIndex,
      ),
    }
  }

  private streamStepForToolCallArgs(
    streamState: StreamState,
    args: ToolCallArgsDelta,
  ): StreamStep {
    const callId =
      args.callId ??
      (args.itemId ? streamState.itemIds.get(args.itemId) : undefined)

    if (!callId) {
      return {
        state: streamState,
        textOutputs: [],
        done: false,
      }
    }

    const nextState = {
      ...streamState,
      indexes: streamState.indexes.has(callId)
        ? streamState.indexes
        : withMapValue(streamState.indexes, callId, args.outputIndex),
      names: streamState.names.has(callId)
        ? streamState.names
        : withMapValue(streamState.names, callId, undefined),
    }
    const toolCallChunk: ToolCallChunk = {
      type: "tool_call_chunk",
      id: callId,
      name: nextState.names.get(callId),
      args: args.delta,
      index: nextState.indexes.get(callId),
    }

    return {
      state: nextState,
      textOutputs: [],
      chunk: new ChatGenerationChunk({
        message: new AIMessageChunk({
          content: "",
          tool_call_chunks: [toolCallChunk],
        }),
        text: "",
      }),
      done: false,
    }
  }

  private streamStepForTextDelta(
    streamState: StreamState,
    delta: string,
    stop: string[],
    maxStopLength: number,
  ): StreamStep {
    const nextBuffer = `${streamState.buffer}${delta}`

    if (stop.length > 0) {
      const earliest = findEarliestStopIndex(nextBuffer, stop)

      if (earliest !== undefined) {
        return {
          state: {
            ...streamState,
            buffer: "",
            stopped: true,
          },
          textOutputs: [nextBuffer.slice(0, earliest)],
          done: false,
        }
      }

      const safeLength =
        maxStopLength > 1
          ? Math.max(0, nextBuffer.length - (maxStopLength - 1))
          : nextBuffer.length

      return {
        state: {
          ...streamState,
          buffer: nextBuffer.slice(safeLength),
        },
        textOutputs: [nextBuffer.slice(0, safeLength)],
        done: false,
      }
    }

    return {
      state: {
        ...streamState,
        buffer: "",
      },
      textOutputs: [nextBuffer],
      done: false,
    }
  }

  private processStreamEvent(
    event: Record<string, unknown>,
    streamState: StreamState,
    stop: string[],
    maxStopLength: number,
  ): StreamStep {
    if (isTerminalEvent(event)) {
      return {
        state: streamState,
        textOutputs:
          !streamState.stopped && streamState.buffer.length > 0
            ? [streamState.buffer]
            : [],
        terminalChunk: this.createTerminalChunk(event),
        done: true,
      }
    }

    const added = extractToolCallItemAdded(event)

    if (added && !streamState.stopped) {
      return {
        state: this.streamStateWithAddedToolCall(streamState, added),
        textOutputs: [],
        done: false,
      }
    }

    const args = extractToolCallArgsDelta(event)

    if (args && !streamState.stopped) {
      return this.streamStepForToolCallArgs(streamState, args)
    }

    const delta = extractTextDelta(event)

    return !delta || streamState.stopped
      ? {
          state: streamState,
          textOutputs: [],
          done: false,
        }
      : this.streamStepForTextDelta(streamState, delta, stop, maxStopLength)
  }

  private async *emitStreamStep(
    step: StreamStep,
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    for (const text of step.textOutputs) {
      yield* this.emitTextChunk(text, runManager)
    }

    if (step.chunk) {
      yield step.chunk
    }

    if (step.terminalChunk) {
      yield step.terminalChunk
    }
  }

  private async *streamResponseEventChunks(
    events: AsyncGenerator<Record<string, unknown>>,
    signal: AbortSignal | undefined,
    stop: string[],
    maxStopLength: number,
    runManager: CallbackManagerForLLMRun | undefined,
    streamState: StreamState,
  ): AsyncGenerator<ChatGenerationChunk> {
    let currentState = streamState

    for await (const event of events) {
      throwIfAborted(signal)

      const step = this.processStreamEvent(
        event,
        currentState,
        stop,
        maxStopLength,
      )

      yield* this.emitStreamStep(step, runManager)

      if (step.done) {
        return
      }

      currentState = step.state
    }
  }

  override async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    throwIfAborted(options.signal)
    const state = this.buildRequestState(messages, options)
    const result = await this.client.completeWithResponse(
      this.buildClientRequest(messages, state, options.signal),
    )

    const responseMetadata = extractResponseMetadata(result.response)
    const usageMetadata = extractUsageMetadata(result.response)
    const content = truncateAtStop(result.parsed.content, options.stop)
    const message = new AIMessage({
      content,
      tool_calls: ensureToolCallIds(result.parsed.toolCalls),
      invalid_tool_calls: result.parsed.invalidToolCalls,
      response_metadata: responseMetadata,
      usage_metadata: usageMetadata,
    })

    return {
      generations: [
        {
          text: content,
          message,
        },
      ],
      llmOutput: {
        id: responseMetadata.id,
        tokenUsage: usageMetadata
          ? {
              promptTokens: usageMetadata.input_tokens,
              completionTokens: usageMetadata.output_tokens,
              totalTokens: usageMetadata.total_tokens,
            }
          : undefined,
      },
    }
  }

  override async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    throwIfAborted(options.signal)
    const state = this.buildRequestState(messages, options)
    const request = this.buildClientRequest(messages, state, options.signal)
    const stop = (options.stop ?? []).filter(
      (item): item is string => typeof item === "string" && item.length > 0,
    )
    const maxStopLength = stop.reduce(
      (max, item) => Math.max(max, item.length),
      0,
    )

    yield* this.streamResponseEventChunks(
      this.client.streamEvents(request),
      options.signal,
      stop,
      maxStopLength,
      runManager,
      INITIAL_STREAM_STATE,
    )
  }
}

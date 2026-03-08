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
  CodexInclude,
  ReasoningEffort,
  ReasoningSummary,
  TextVerbosity,
} from "../client/types.js"
import { extractTextDelta, isTerminalEvent } from "../client/sse.js"
import {
  ensureToolCallIds,
  findEarliestStopIndex,
  truncateAtStop,
} from "../converters/messages.js"
import {
  extractResponseMetadata,
  extractToolCallArgsDelta,
  extractToolCallItemAdded,
  extractUsageMetadata,
  parseAssistantMessage,
} from "../converters/responses.js"
import { normalizeToolChoice } from "../converters/tools.js"
import { VERSION } from "../version.js"
import { throwIfAborted } from "../utils/abort.js"
import {
  resolveChatCodexOAuthConfig,
  type ResolvedChatCodexOAuthConfig,
} from "./config.js"
import {
  buildClientRequest,
  buildInvocationParams,
  buildRequestState,
} from "./request.js"
import type {
  ChatCodexOAuthCallOptions,
  ChatCodexOAuthParams,
} from "./types.js"

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

  include?: CodexInclude[]

  timeout: number

  maxRetries: number

  baseURL: string

  authPath?: string

  readonly client: CodexClient

  private readonly config: ResolvedChatCodexOAuthConfig

  constructor(fields: ChatCodexOAuthParams = {}) {
    super(fields)
    this.config = resolveChatCodexOAuthConfig(fields)
    this._addVersion("langchainjs-codex-oauth", VERSION)
    this.model = this.config.model
    this.temperature = this.config.temperature
    this.maxTokens = this.config.maxTokens
    this.reasoningEffort = this.config.reasoningEffort
    this.reasoningSummary = this.config.reasoningSummary
    this.textVerbosity = this.config.textVerbosity
    this.include = this.config.include
    this.timeout = this.config.timeout
    this.maxRetries = this.config.maxRetries
    this.baseURL = this.config.baseURL
    this.authPath = this.config.authPath
    this.client = new CodexClient({
      authStore: new AuthStore(fields.authPath),
      baseURL: this.baseURL,
      timeoutMs: this.timeout,
      maxRetries: this.maxRetries,
    })
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
    return buildInvocationParams(this.config, options)
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

  override async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    throwIfAborted(options.signal)
    const state = buildRequestState(messages, this.config, options)
    const result = await this.client.completeWithResponse(
      buildClientRequest(messages, this.model, state, options.signal),
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
    const state = buildRequestState(messages, this.config, options)
    const request = buildClientRequest(
      messages,
      this.model,
      state,
      options.signal,
    )
    const stop = (options.stop ?? []).filter(
      (item): item is string => typeof item === "string" && item.length > 0,
    )
    const maxStopLength = stop.reduce(
      (max, item) => Math.max(max, item.length),
      0,
    )
    const itemIds = new Map<string, string>()
    const names = new Map<string, string | undefined>()
    const indexes = new Map<string, number>()
    let buffer = ""
    let stopped = false

    for await (const event of this.client.streamEvents(request)) {
      throwIfAborted(options.signal)

      if (isTerminalEvent(event)) {
        if (!stopped && buffer.length > 0) {
          yield* this.emitTextChunk(buffer, runManager)
        }

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

        yield new ChatGenerationChunk({
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
        return
      }

      const added = extractToolCallItemAdded(event)

      if (added && !stopped) {
        if (added.itemId) {
          itemIds.set(added.itemId, added.callId)
        }

        names.set(added.callId, added.name)
        indexes.set(added.callId, added.outputIndex)
        continue
      }

      const args = extractToolCallArgsDelta(event)

      if (args && !stopped) {
        const callId =
          args.callId ?? (args.itemId ? itemIds.get(args.itemId) : undefined)

        if (!callId) {
          continue
        }

        if (!indexes.has(callId)) {
          indexes.set(callId, args.outputIndex)
        }

        if (!names.has(callId)) {
          names.set(callId, undefined)
        }

        const toolCallChunk: ToolCallChunk = {
          type: "tool_call_chunk",
          id: callId,
          name: names.get(callId),
          args: args.delta,
          index: indexes.get(callId),
        }
        const chunk = new ChatGenerationChunk({
          message: new AIMessageChunk({
            content: "",
            tool_call_chunks: [toolCallChunk],
          }),
          text: "",
        })
        yield chunk
        continue
      }

      const delta = extractTextDelta(event)

      if (!delta || stopped) {
        continue
      }

      buffer += delta

      if (stop.length > 0) {
        const earliest = findEarliestStopIndex(buffer, stop)

        if (earliest !== undefined) {
          const text = buffer.slice(0, earliest)

          yield* this.emitTextChunk(text, runManager)

          stopped = true
          buffer = ""
          continue
        }

        const safeLength =
          maxStopLength > 1
            ? Math.max(0, buffer.length - (maxStopLength - 1))
            : buffer.length
        const text = buffer.slice(0, safeLength)
        buffer = buffer.slice(safeLength)

        yield* this.emitTextChunk(text, runManager)

        continue
      }

      yield* this.emitTextChunk(buffer, runManager)
      buffer = ""
    }
  }
}

import { isRecord } from "../utils/json.js"

async function* streamChunks(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader()

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        return
      }

      if (value) {
        yield value
      }
    }
  } finally {
    reader.releaseLock()
  }
}

interface SseParserState {
  readonly buffer: string
  readonly data: readonly string[]
}

interface SseParserResult {
  readonly state: SseParserState
  readonly events: readonly Record<string, unknown>[]
}

const EMPTY_SSE_STATE: SseParserState = {
  buffer: "",
  data: [],
}

function emptySseResult(state: SseParserState): SseParserResult {
  return {
    state,
    events: [],
  }
}

function flushSseData(state: SseParserState): SseParserResult {
  if (state.data.length === 0) {
    return emptySseResult(state)
  }

  const payload = state.data.join("\n")
  const nextState = {
    ...state,
    data: [],
  }

  if (payload.trim() === "[DONE]") {
    return emptySseResult(nextState)
  }

  try {
    const parsed: unknown = JSON.parse(payload)

    return isRecord(parsed)
      ? {
          state: nextState,
          events: [parsed],
        }
      : emptySseResult(nextState)
  } catch {
    return emptySseResult(nextState)
  }
}

function parseSseLine(state: SseParserState, line: string): SseParserResult {
  if (line === "") {
    return flushSseData(state)
  }

  if (line.startsWith(":")) {
    return emptySseResult(state)
  }

  return line.startsWith("data:")
    ? emptySseResult({
        ...state,
        data: [...state.data, line.slice(5).trimStart()],
      })
    : emptySseResult(state)
}

function parseBufferedLines(state: SseParserState): SseParserResult {
  const lines = state.buffer.split("\n")
  const remainder = lines.at(-1) ?? ""
  const completeLines = lines.slice(0, -1)

  return completeLines.reduce<SseParserResult>(
    (result, rawLine) => {
      const next = parseSseLine(result.state, rawLine.replace(/\r$/u, ""))

      return {
        state: next.state,
        events: [...result.events, ...next.events],
      }
    },
    {
      state: {
        ...state,
        buffer: remainder,
      },
      events: [],
    },
  )
}

function parseSseChunk(state: SseParserState, chunk: string): SseParserResult {
  return parseBufferedLines({
    ...state,
    buffer: `${state.buffer}${chunk}`,
  })
}

function finalizeSseState(
  state: SseParserState,
  trailing: string,
): SseParserResult {
  const trailingLine = `${state.buffer}${trailing}`
  const trailingResult = trailingLine
    ? parseSseLine(
        {
          ...state,
          buffer: "",
        },
        trailingLine.replace(/\r$/u, ""),
      )
    : emptySseResult({
        ...state,
        buffer: "",
      })
  const flushed = flushSseData(trailingResult.state)

  return {
    state: flushed.state,
    events: [...trailingResult.events, ...flushed.events],
  }
}

export async function* iterSseEvents(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<Record<string, unknown>> {
  const decoder = new TextDecoder()
  let state = EMPTY_SSE_STATE

  for await (const chunk of streamChunks(stream)) {
    const result = parseSseChunk(state, decoder.decode(chunk, { stream: true }))
    state = result.state

    for (const event of result.events) {
      yield event
    }
  }

  const result = finalizeSseState(state, decoder.decode())

  for (const event of result.events) {
    yield event
  }
}

export function isTerminalEvent(event: Record<string, unknown>): boolean {
  const type = typeof event.type === "string" ? event.type : ""
  return type === "response.done" || type === "response.completed"
}

export function extractTextDelta(
  event: Record<string, unknown>,
): string | undefined {
  const type = typeof event.type === "string" ? event.type : ""

  if (type.endsWith("output_text.delta")) {
    if (typeof event.delta === "string") {
      return event.delta
    }

    if (typeof event.text === "string") {
      return event.text
    }
  }

  if (type.endsWith("text.delta") && typeof event.text === "string") {
    return event.text
  }

  return undefined
}

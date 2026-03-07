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

export async function* iterSseEvents(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<Record<string, unknown>> {
  const decoder = new TextDecoder()
  let buffer = ""
  let data: string[] = []

  const flush = async function* (): AsyncGenerator<Record<string, unknown>> {
    if (data.length === 0) {
      return
    }

    const payload = data.join("\n")
    data = []

    if (payload.trim() === "[DONE]") {
      return
    }

    try {
      const parsed: unknown = JSON.parse(payload)

      if (isRecord(parsed)) {
        yield parsed
      }
    } catch {
      // Ignore malformed event payloads.
    }
  }

  for await (const chunk of streamChunks(stream)) {
    buffer += decoder.decode(chunk, { stream: true })

    while (buffer.includes("\n")) {
      const index = buffer.indexOf("\n")
      const line = buffer.slice(0, index).replace(/\r$/u, "")
      buffer = buffer.slice(index + 1)

      if (line === "") {
        yield* flush()
        continue
      }

      if (line.startsWith(":")) {
        continue
      }

      if (line.startsWith("data:")) {
        data.push(line.slice(5).trimStart())
      }
    }
  }

  buffer += decoder.decode()

  if (buffer.length > 0) {
    const line = buffer.replace(/\r$/u, "")

    if (line.startsWith("data:")) {
      data.push(line.slice(5).trimStart())
    }
  }

  yield* flush()
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

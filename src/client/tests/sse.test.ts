import { describe, expect, test } from "vitest";

import { extractTextDelta, isTerminalEvent, iterSseEvents } from "../sse.js";

function streamFromText(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

describe("SSE parsing", () => {
  test("parses JSON data events", async () => {
    const events: Array<Record<string, unknown>> = [];

    for await (const event of iterSseEvents(
      streamFromText(
        'data: {"type":"response.output_text.delta","delta":"hi"}\n\n',
      ),
    )) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("response.output_text.delta");
    expect(extractTextDelta(events[0]!)).toBe("hi");
  });

  test("ignores done sentinel and terminal checks still work", async () => {
    const events: Array<Record<string, unknown>> = [];

    for await (const event of iterSseEvents(
      streamFromText(
        'data: {"type":"response.done","response":{}}\n\ndata: [DONE]\n\n',
      ),
    )) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(isTerminalEvent(events[0]!)).toBe(true);
  });
});

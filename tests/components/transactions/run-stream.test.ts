import { describe, expect, test } from "bun:test";

import { readRunEvents, watchRun } from "@/components/transactions/run-stream";
import type { RunEvent } from "@/lib/transactions/types";

const row = {
  id: "one",
  date: "2026-08-21",
  description: "Harbor Stationery",
  amountMinor: -100,
  currency: "CAD",
  status: "rules",
  category: null,
  movement: null,
  confidence: null,
  source: null,
  reason: null,
} as const;

function chunkedStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("readRunEvents", () => {
  test("decodes events split across network chunks", async () => {
    const stream = chunkedStream([
      `${JSON.stringify({ type: "row", row })}\n{"type":"do`,
      'ne","runId":"run-1","status":"completed"}',
    ]);
    const events: RunEvent[] = [];
    for await (const event of readRunEvents(stream)) events.push(event);

    expect(events).toEqual([
      { type: "row", row },
      { type: "done", runId: "run-1", status: "completed" },
    ]);
  });

  test("rejects malformed status updates", async () => {
    const stream = chunkedStream(['{"type":"unexpected"}\n']);
    const consume = async () => {
      for await (const event of readRunEvents(stream)) void event;
    };
    await expect(consume()).rejects.toThrow("invalid status update");
  });

  test("reconnects from the next workflow event without replaying a row", async () => {
    const startIndexes: number[] = [];
    const events: RunEvent[] = [];
    const reconnects: number[] = [];
    await watchRun(
      async (startIndex) => {
        startIndexes.push(startIndex);
        return startIndex === 0
          ? chunkedStream([`${JSON.stringify({ type: "row", row })}\n`])
          : chunkedStream(['{"type":"done","runId":"run-1","status":"completed"}\n']);
      },
      (event) => events.push(event),
      new AbortController().signal,
      (attempt) => reconnects.push(attempt),
    );

    expect(startIndexes).toEqual([0, 1]);
    expect(reconnects).toEqual([1]);
    expect(events).toEqual([
      { type: "row", row },
      { type: "done", runId: "run-1", status: "completed" },
    ]);
  });

  test("does not reconnect after an intentional abort", async () => {
    const controller = new AbortController();
    const startIndexes: number[] = [];
    await watchRun(
      async (startIndex) => {
        startIndexes.push(startIndex);
        return chunkedStream([`${JSON.stringify({ type: "row", row })}\n`]);
      },
      () => controller.abort(),
      controller.signal,
    );
    expect(startIndexes).toEqual([0]);
  });
});

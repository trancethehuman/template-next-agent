import type { RunEvent } from "@/lib/transactions/types";

const MAX_EVENT_LENGTH = 64 * 1024;

function parseRunEvent(line: string): RunEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error("The run sent an invalid status update.");
  }

  if (!value || typeof value !== "object" || !("type" in value)) {
    throw new Error("The run sent an invalid status update.");
  }
  if (value.type === "row" && "row" in value && value.row && typeof value.row === "object") {
    const row = value.row as { id?: unknown; status?: unknown };
    if (typeof row.id === "string" && typeof row.status === "string") {
      return value as RunEvent;
    }
  }
  if (value.type === "done" && "status" in value && "runId" in value) {
    if (
      typeof value.runId === "string" &&
      (value.status === "completed" || value.status === "failed")
    ) {
      return value as RunEvent;
    }
  }
  throw new Error("The run sent an invalid status update.");
}

export async function* readRunEvents(stream: ReadableStream<Uint8Array>): AsyncGenerator<RunEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      if (pending.length > MAX_EVENT_LENGTH) {
        throw new Error("The run sent a status update that was too large.");
      }

      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        if (line) yield parseRunEvent(line);
        newline = pending.indexOf("\n");
      }
    }

    pending += decoder.decode();
    if (pending.trim()) yield parseRunEvent(pending.trim());
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export class RunStreamFatalError extends Error {}

export async function watchRun(
  getStream: (startIndex: number) => Promise<ReadableStream<Uint8Array>>,
  onEvent: (event: RunEvent) => void,
  signal: AbortSignal,
  onReconnect?: (attempt: number) => void,
): Promise<void> {
  let nextIndex = 0;
  let reconnects = 0;

  while (!signal.aborted) {
    try {
      const stream = await getStream(nextIndex);
      for await (const event of readRunEvents(stream)) {
        if (signal.aborted) return;
        nextIndex += 1;
        onEvent(event);
        if (event.type === "done") return;
      }
      throw new Error("The live connection ended before the run completed.");
    } catch (cause) {
      if (signal.aborted) return;
      if (cause instanceof RunStreamFatalError || reconnects >= 3) throw cause;
      reconnects += 1;
      onReconnect?.(reconnects);
      await new Promise((resolve) => setTimeout(resolve, reconnects * 500));
    }
  }
}

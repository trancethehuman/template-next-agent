import assert from "node:assert/strict";
import { test, mock } from "bun:test";
import type { RunEvent, TransactionInput } from "../../lib/transactions/types";

const events: RunEvent[] = [];
let streamClosed = false;

mock.module("workflow", () => ({
  FatalError: class FatalError extends Error {},
  getWorkflowMetadata: () => ({ workflowRunId: "run-batches" }),
  getWritable: () => new WritableStream<string>({
    write(chunk) {
      events.push(JSON.parse(chunk) as RunEvent);
    },
    close() {
      streamClosed = true;
    },
  }),
}));

const { classifyTransactionsWorkflow } = await import("../../workflows/classify-transactions");

test("workflow streams batch boundaries around four-row groups", async () => {
  events.length = 0;
  streamClosed = false;
  const transactions: TransactionInput[] = Array.from({ length: 5 }, (_, index) => ({
    id: `row-${index + 1}`,
    date: "2026-09-28",
    description: "Transfer between our own accounts",
    amountMinor: -1000 - index,
    currency: "CAD",
  }));

  assert.deepEqual(await classifyTransactionsWorkflow(transactions), { status: "completed" });
  assert.equal(streamClosed, true);

  const batches = events.filter((event) => event.type === "batch");
  assert.deepEqual(batches, [
    { type: "batch", batchIndex: 0, totalBatches: 2, rowIds: ["row-1", "row-2", "row-3", "row-4"], status: "processing" },
    { type: "batch", batchIndex: 0, totalBatches: 2, rowIds: ["row-1", "row-2", "row-3", "row-4"], status: "completed" },
    { type: "batch", batchIndex: 1, totalBatches: 2, rowIds: ["row-5"], status: "processing" },
    { type: "batch", batchIndex: 1, totalBatches: 2, rowIds: ["row-5"], status: "completed" },
  ]);

  const boundaryIndexes = events.flatMap((event, index) => event.type === "batch" ? [index] : []);
  assert.equal(events.slice(0, boundaryIndexes[0]).filter((event) => event.type === "row").length, 5);
  assert.equal(events.slice(boundaryIndexes[0] + 1, boundaryIndexes[1]).filter((event) => event.type === "row").length, 8);
  assert.equal(events.slice(boundaryIndexes[2] + 1, boundaryIndexes[3]).filter((event) => event.type === "row").length, 2);
  assert.deepEqual(events.at(-1), { type: "done", runId: "run-batches", status: "completed" });
});

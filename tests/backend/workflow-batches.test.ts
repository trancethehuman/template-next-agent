import assert from "node:assert/strict";
import { test, mock } from "bun:test";
import type { RunEvent, TransactionInput } from "../../lib/transactions/types";

const events: RunEvent[] = [];
let streamClosed = false;

mock.module("workflow", () => ({
  FatalError: class FatalError extends Error {},
  getWorkflowMetadata: () => ({ workflowRunId: "run-batches" }),
  getWritable: () =>
    new WritableStream<string>({
      write(chunk) {
        events.push(JSON.parse(chunk) as RunEvent);
      },
      close() {
        streamClosed = true;
      },
    }),
}));

const { classifyTransactionsWorkflow } = await import(
  "../../workflows/classify-transactions"
);

test("workflow streams batch boundaries around four-row groups", async () => {
  events.length = 0;
  streamClosed = false;
  const transactions: TransactionInput[] = Array.from(
    { length: 5 },
    (_, index) => ({
      id: `row-${index + 1}`,
      date: "2026-09-28",
      description: "Transfer between our own accounts",
      amountMinor: -1000 - index,
      currency: "CAD",
    }),
  );

  assert.deepEqual(await classifyTransactionsWorkflow(transactions), {
    status: "completed",
  });
  assert.equal(streamClosed, true);

  const batches = events.filter((event) => event.type === "batch");
  assert.deepEqual(batches, [
    {
      type: "batch",
      batchIndex: 0,
      totalBatches: 2,
      rowIds: ["row-1", "row-2", "row-3", "row-4"],
      status: "processing",
    },
    {
      type: "batch",
      batchIndex: 0,
      totalBatches: 2,
      rowIds: ["row-1", "row-2", "row-3", "row-4"],
      status: "completed",
    },
    {
      type: "batch",
      batchIndex: 1,
      totalBatches: 2,
      rowIds: ["row-5"],
      status: "processing",
    },
    {
      type: "batch",
      batchIndex: 1,
      totalBatches: 2,
      rowIds: ["row-5"],
      status: "completed",
    },
  ]);

  const boundaryIndexes = events.flatMap((event, index) =>
    event.type === "batch" ? [index] : [],
  );
  assert.equal(
    events.slice(0, boundaryIndexes[0]).filter((event) => event.type === "row")
      .length,
    5,
  );
  assert.equal(
    events
      .slice(boundaryIndexes[0] + 1, boundaryIndexes[1])
      .filter((event) => event.type === "row").length,
    8,
  );
  assert.equal(
    events
      .slice(boundaryIndexes[2] + 1, boundaryIndexes[3])
      .filter((event) => event.type === "row").length,
    2,
  );
  assert.deepEqual(events.at(-1), {
    type: "done",
    runId: "run-batches",
    status: "completed",
  });
});

let modelFails = false;
const calls: {
  model: string;
  state: unknown;
  questions: Record<string, unknown>;
  providerOptions: unknown;
}[] = [];
const modelAnswers = {
  movement: {
    type: "choice",
    choice: "purchase",
    probabilities: { purchase: 0.96, unclear: 0.04 },
  },
  category: {
    type: "choice",
    choice: "software",
    probabilities: { software: 0.94, other: 0.06 },
  },
  evidence: {
    type: "score",
    score: 1.625,
    probabilities: { "0": 0.01, "1": 0.355, "2": 0.635 },
  },
  ownAccount: { type: "boolean", probability: 0.02 },
};
mock.module("ai", () => ({
  experimental_evaluate: async (params: (typeof calls)[number]) => {
    calls.push(params);
    if (modelFails)
      throw new Error(
        "Provider error with private details that must not be streamed",
      );
    return {
      answers: modelAnswers,
      response: { modelId: params.model },
      usage: { inputTokens: 100, outputTokens: 0, totalTokens: 100 },
      providerMetadata: { typesafe: { confidence: { movement: 0.8 } } },
    };
  },
}));

test("model-only reruns stream actual answers before policy and preserve native score and P(true)", async () => {
  events.length = 0;
  calls.length = 0;
  modelFails = false;
  const transaction: TransactionInput = {
    id: "model-row",
    date: "2026-09-28",
    description: "Transfer between our own accounts",
    amountMinor: -2900,
    currency: "CAD",
  };
  await classifyTransactionsWorkflow([transaction], {
    modelId: "liquid/d1",
    syntheticData: true,
    useRules: false,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "liquid/d1");
  assert.deepEqual(Object.keys(calls[0].questions), [
    "movement",
    "category",
    "evidence",
    "ownAccount",
  ]);
  assert.deepEqual(calls[0].providerOptions, {
    gateway: { zeroDataRetention: false },
  });
  const rows = events.flatMap((event) =>
    event.type === "row" ? [event.row] : [],
  );
  assert.deepEqual(
    rows.map((row) => row.status),
    ["queued", "rules", "jev", "evaluated", "policy", "classified"],
  );
  const trace = rows[3].trace!;
  assert.deepEqual(trace.answers, modelAnswers);
  assert.equal(trace.nativeConfidence?.movement, 0.8);
  assert.equal(rows.at(-1)?.confidence, 0.94);
  assert.equal(trace.answers.ownAccount.probability, 0.02);
  assert.equal(trace.answers.evidence.score, 1.625);
  assert.equal(trace.usage.outputTokens, 0);
  assert.ok(trace.elapsedMs >= 0);
});

test("model failure is visible and never becomes a fake decision or another-model fallback", async () => {
  events.length = 0;
  calls.length = 0;
  modelFails = true;
  try {
    await assert.rejects(
      classifyTransactionsWorkflow([
        {
          id: "failed-model",
          date: "2026-09-28",
          description: "Cloud subscription",
          amountMinor: -2900,
          currency: "CAD",
        },
      ]),
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].providerOptions, {
      gateway: { zeroDataRetention: true },
    });
    const failed = events.flatMap((event) =>
      event.type === "row" && event.row.status === "failed" ? [event.row] : [],
    )[0];
    assert.equal(failed.trace, undefined);
    assert.equal(failed.confidence, null);
    assert.doesNotMatch(failed.reason ?? "", /private details/);
    assert.deepEqual(events.at(-1), {
      type: "done",
      runId: "run-batches",
      status: "failed",
    });
  } finally {
    modelFails = false;
  }
});

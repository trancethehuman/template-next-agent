import { describe, expect, test } from "bun:test";

import {
  applyRunEvent,
  createRunProgress,
  summarizeRows,
} from "@/components/transactions/run-progress";
import type {
  ClassificationRow,
  RunEvent,
  TransactionInput,
} from "@/lib/transactions/types";

const transaction: TransactionInput = {
  id: "one",
  date: "2026-08-21",
  description: "Example merchant",
  amountMinor: -100,
  currency: "CAD",
};

function rowEvent(
  row: ClassificationRow,
  status: ClassificationRow["status"],
): RunEvent {
  return { type: "row", row: { ...row, status } };
}

describe("run progress", () => {
  test("groups rows into batches of four", () => {
    const transactions = Array.from({ length: 9 }, (_, index) => ({
      ...transaction,
      id: `row-${index}`,
    }));
    const progress = createRunProgress(transactions);
    expect(progress.batches.map((batch) => batch.rowIds.length)).toEqual([
      4, 4, 1,
    ]);
    expect(progress.batches.map((batch) => batch.status)).toEqual([
      "queued",
      "queued",
      "queued",
    ]);
  });

  test("keeps completed batches complete after a processing replay", () => {
    let progress = createRunProgress([transaction]);
    const event: Omit<Extract<RunEvent, { type: "batch" }>, "status"> = {
      type: "batch",
      batchIndex: 0,
      totalBatches: 1,
      rowIds: ["one"],
    };
    progress = applyRunEvent(progress, { ...event, status: "processing" });
    progress = applyRunEvent(progress, { ...event, status: "completed" });
    progress = applyRunEvent(progress, { ...event, status: "processing" });
    expect(progress.batches[0].status).toBe("completed");
  });

  test("ignores backward replay, dedupes steps, and accepts a later terminal decision", () => {
    let progress = createRunProgress([transaction]);
    const queued = progress.rows[0];
    const failed: ClassificationRow = {
      ...queued,
      status: "failed",
      reason: "Gateway unavailable",
    };
    const classified: ClassificationRow = {
      ...queued,
      status: "classified",
      category: "Software",
      movement: "expense",
      confidence: 0.91,
      source: "jev",
      reason: "Matched subscription",
    };
    for (const event of [
      rowEvent(queued, "queued"),
      rowEvent(queued, "rules"),
      rowEvent(queued, "jev"),
      { type: "row", row: failed } as const,
      rowEvent(queued, "queued"),
      rowEvent(queued, "rules"),
      rowEvent(queued, "jev"),
    ]) {
      progress = applyRunEvent(progress, event);
    }
    expect(progress.rows[0].status).toBe("failed");
    expect(progress.histories.get("one")?.map((step) => step.status)).toEqual([
      "queued",
      "rules",
      "jev",
      "failed",
    ]);

    progress = applyRunEvent(progress, { type: "row", row: classified });
    expect(progress.rows[0]).toEqual(classified);
    expect(progress.histories.get("one")?.map((step) => step.status)).toEqual([
      "queued",
      "rules",
      "jev",
      "classified",
    ]);

    progress = applyRunEvent(progress, { type: "row", row: classified });
    expect(progress.histories.get("one")).toHaveLength(4);
  });
});

test("rerunning one transaction keeps another run's answer trace and phase history isolated", () => {
  const first = createRunProgress([transaction, { ...transaction, id: "two" }]);
  const completed = applyRunEvent(first, {
    type: "row",
    row: {
      ...first.rows[0],
      status: "classified",
      category: "Software",
      source: "model",
      confidence: 0.95,
      modelId: "typesafe-ai/jev",
    },
  });
  let rerun = createRunProgress([transaction]);
  const queued = { ...rerun.rows[0], modelId: "liquid/d1" as const };
  for (const status of [
    "queued",
    "rules",
    "jev",
    "evaluated",
    "policy",
    "needs_review",
  ] as const)
    rerun = applyRunEvent(rerun, rowEvent(queued, status));
  rerun = applyRunEvent(rerun, rowEvent(queued, "evaluated"));
  expect(completed.rows[0].category).toBe("Software");
  expect(completed.rows[1].status).toBe("queued");
  expect(completed.histories.get("one")).toHaveLength(1);
  expect(rerun.histories.get("one")?.map((row) => row.status)).toEqual([
    "queued",
    "rules",
    "jev",
    "evaluated",
    "policy",
    "needs_review",
  ]);
  expect(rerun.rows[0].modelId).toBe("liquid/d1");
  expect(summarizeRows(completed.rows)).toEqual({
    total: 2,
    completed: 1,
    reviews: 0,
  });
  expect(summarizeRows(rerun.rows)).toEqual({
    total: 1,
    completed: 1,
    reviews: 1,
  });
});

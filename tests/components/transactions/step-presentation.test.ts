import { expect, test } from "bun:test";
import {
  stageForStatus,
  stepExplanation,
  stepMetadata,
} from "@/components/transactions/step-presentation";
import { createRunProgress } from "@/components/transactions/run-progress";
import { mockTransactions } from "@/lib/transactions/mock";
import type { DecisionTrace } from "@/lib/transactions/types";

const trace: DecisionTrace = {
  modelId: "typesafe-ai/jev",
  responseModelId: "typesafe-ai/jev",
  version: "test-synthetic",
  startedAt: 10,
  finishedAt: 35,
  elapsedMs: 25,
  usage: {},
  answers: {
    movement: { type: "choice", choice: "purchase" },
    category: {
      type: "choice",
      choice: "software",
      probabilities: { software: 0.94 },
    },
    evidence: { type: "score", score: 1.625 },
    ownAccount: { type: "boolean", probability: 0.03 },
  },
};

test("metadata reveals only actual returned answers; missing probabilities and tokens stay missing", () => {
  const queued = createRunProgress([mockTransactions[0]]).rows[0];
  expect(stageForStatus(queued.status)).toBe("input");
  expect(stepMetadata("answers", queued)).toEqual([
    ["Answers", "Not returned yet"],
  ]);
  const returned = { ...queued, status: "evaluated" as const, trace };
  const metadata = stepMetadata("answers", returned);
  expect(metadata).toContainEqual(["Money type", "purchase · Not returned"]);
  expect(metadata).toContainEqual(["Category", "software · 94.0%"]);
  expect(metadata).toContainEqual(["Evidence score", "1.625 / 2"]);
  expect(metadata).toContainEqual(["Own account · P(true)", "3.0%"]);
  expect(stepMetadata("model", returned)).toContainEqual([
    "Tokens",
    "— in / — out",
  ]);
});

test("rule outcomes explain the actual skipped model path without invented scores", () => {
  const row = {
    ...createRunProgress([mockTransactions[0]]).rows[0],
    status: "classified" as const,
    source: "rule" as const,
    reason: "Explicit own-account transfer",
  };
  expect(stageForStatus(row.status)).toBe("outcome");
  expect(stepExplanation("outcome", row)).toContain("model was skipped");
  expect(stepMetadata("answers", row)).toEqual([
    ["Answers", "Skipped · no model call"],
  ]);
  expect(stepMetadata("outcome", row)).toContainEqual([
    "Selected probability",
    "—",
  ]);
});

test("a model-classified transfer does not imply that a category was assigned", () => {
  const row = {
    ...createRunProgress([mockTransactions[0]]).rows[0],
    status: "classified" as const,
    source: "model" as const,
    movement: "transfer" as const,
    category: null,
  };
  expect(stepExplanation("outcome", row)).toContain("classified");
  expect(stepExplanation("outcome", row)).not.toContain("has a category");
});

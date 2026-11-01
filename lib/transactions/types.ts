import type { DecisionModelId } from "@/lib/classification/models";

export type ClassificationStatus =
  | "queued"
  | "rules"
  | "jev"
  | "evaluated"
  | "policy"
  | "classified"
  | "needs_review"
  | "failed";

export interface TransactionInput {
  id: string;
  date: string;
  description: string;
  amountMinor: number;
  currency: "CAD" | "USD";
}

export interface RunOptions {
  modelId: DecisionModelId;
  useRules: boolean;
  syntheticData: boolean;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities?: Record<string, number>;
}

export interface DecisionTrace {
  modelId: DecisionModelId;
  responseModelId: string;
  version: string;
  startedAt: number;
  finishedAt: number;
  elapsedMs: number;
  answers: {
    movement: ChoiceAnswer;
    category: ChoiceAnswer;
    evidence: {
      type: "score";
      score: number;
      probabilities?: Record<string, number>;
    };
    ownAccount: { type: "boolean"; probability: number };
  };
  nativeConfidence?: Record<string, number>;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}

export interface ClassificationRow extends TransactionInput {
  status: ClassificationStatus;
  category: string | null;
  movement: "expense" | "income" | "transfer" | null;
  confidence: number | null;
  source: "rule" | "model" | "jev" | null;
  reason: string | null;
  trace?: DecisionTrace;
  modelId?: DecisionModelId;
  rulesApplied?: boolean;
  occurredAt?: number;
  rowElapsedMs?: number;
}

export type RunEvent =
  | { type: "row"; row: ClassificationRow }
  | {
      type: "batch";
      batchIndex: number;
      totalBatches: number;
      rowIds: string[];
      status: "processing" | "completed";
    }
  | { type: "done"; runId: string; status: "completed" | "failed" };

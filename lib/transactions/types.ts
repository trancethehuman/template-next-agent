export type ClassificationStatus =
  | "queued"
  | "rules"
  | "jev"
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

export interface ClassificationRow extends TransactionInput {
  status: ClassificationStatus;
  category: string | null;
  movement: "expense" | "income" | "transfer" | null;
  confidence: number | null;
  source: "rule" | "jev" | null;
  reason: string | null;
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

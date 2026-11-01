import type {
  ClassificationRow,
  ClassificationStatus,
  RunEvent,
  TransactionInput,
  RunOptions,
} from "@/lib/transactions/types";

export const BATCH_SIZE = 4;

export interface BatchProgress {
  index: number;
  rowIds: string[];
  status: "queued" | "processing" | "completed";
}

export interface RunProgress {
  rows: ClassificationRow[];
  histories: ReadonlyMap<string, ClassificationRow[]>;
  batches: BatchProgress[];
}

export function isTerminalStatus(status: ClassificationStatus): boolean {
  return (
    status === "classified" || status === "needs_review" || status === "failed"
  );
}

export function summarizeRows(rows: readonly ClassificationRow[]) {
  return {
    total: rows.length,
    completed: rows.filter((row) => isTerminalStatus(row.status)).length,
    reviews: rows.filter((row) => row.status === "needs_review").length,
  };
}

function statusOrder(status: ClassificationStatus): number {
  if (status === "queued") return 0;
  if (status === "rules") return 1;
  if (status === "jev") return 2;
  if (status === "evaluated") return 3;
  if (status === "policy") return 4;
  return 5;
}

function sameRow(first: ClassificationRow, second: ClassificationRow): boolean {
  return (
    first.id === second.id &&
    first.date === second.date &&
    first.description === second.description &&
    first.amountMinor === second.amountMinor &&
    first.currency === second.currency &&
    first.status === second.status &&
    first.category === second.category &&
    first.movement === second.movement &&
    first.confidence === second.confidence &&
    first.source === second.source &&
    first.reason === second.reason &&
    JSON.stringify(first.trace) === JSON.stringify(second.trace)
  );
}

export function createRunProgress(
  transactions: TransactionInput[],
  options?: Pick<RunOptions, "modelId" | "useRules">,
): RunProgress {
  const rows: ClassificationRow[] = transactions.map((transaction) => ({
    ...transaction,
    status: "queued",
    category: null,
    movement: null,
    confidence: null,
    source: null,
    reason: null,
    ...(options
      ? { modelId: options.modelId, rulesApplied: options.useRules }
      : {}),
  }));
  const batches: BatchProgress[] = [];
  for (let index = 0; index < transactions.length; index += BATCH_SIZE) {
    batches.push({
      index: batches.length,
      rowIds: transactions
        .slice(index, index + BATCH_SIZE)
        .map((transaction) => transaction.id),
      status: "queued",
    });
  }
  return { rows, histories: new Map(), batches };
}

export function applyRunEvent(
  progress: RunProgress,
  event: RunEvent,
): RunProgress {
  if (event.type === "batch") {
    const batch = progress.batches[event.batchIndex];
    if (
      !batch ||
      event.totalBatches !== progress.batches.length ||
      batch.rowIds.length !== event.rowIds.length ||
      batch.rowIds.some((id, index) => id !== event.rowIds[index]) ||
      batch.status === "completed" ||
      batch.status === event.status
    ) {
      return progress;
    }
    return {
      ...progress,
      batches: progress.batches.map((candidate) =>
        candidate.index === event.batchIndex
          ? { ...candidate, status: event.status }
          : candidate,
      ),
    };
  }

  if (event.type !== "row") return progress;
  const currentIndex = progress.rows.findIndex(
    (row) => row.id === event.row.id,
  );
  if (currentIndex < 0) return progress;
  const current = progress.rows[currentIndex];
  if (isTerminalStatus(current.status) && !isTerminalStatus(event.row.status)) {
    return progress;
  }
  if (statusOrder(event.row.status) < statusOrder(current.status)) {
    return progress;
  }

  const history = progress.histories.get(event.row.id) ?? [];
  if (
    sameRow(current, event.row) &&
    history.some((step) => sameRow(step, event.row))
  ) {
    return progress;
  }

  const histories = new Map(progress.histories);
  histories.set(
    event.row.id,
    isTerminalStatus(event.row.status)
      ? [...history.filter((step) => !isTerminalStatus(step.status)), event.row]
      : [
          ...history.filter((step) => step.status !== event.row.status),
          event.row,
        ],
  );
  return {
    ...progress,
    rows: progress.rows.map((row, index) =>
      index === currentIndex ? event.row : row,
    ),
    histories,
  };
}

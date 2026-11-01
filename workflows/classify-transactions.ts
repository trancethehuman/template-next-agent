import { FatalError, getWorkflowMetadata, getWritable } from "workflow";
import {
  evaluateTransaction,
  decideJevAnswers,
} from "@/lib/classification/jev";
import { defaultRunOptions } from "@/lib/classification/models";
import { queuedRow } from "@/lib/classification/input";
import { classifyByRule } from "@/lib/classification/rules";
import type {
  ClassificationRow,
  RunEvent,
  RunOptions,
  TransactionInput,
} from "@/lib/transactions/types";

async function writeEvent(
  writer: WritableStreamDefaultWriter<string>,
  event: RunEvent,
): Promise<void> {
  await writer.write(`${JSON.stringify(event)}\n`);
}

async function emitQueuedRows(
  transactions: TransactionInput[],
  options: RunOptions,
): Promise<void> {
  "use step";
  const writer = getWritable<string>().getWriter();
  try {
    for (const transaction of transactions) {
      await writeEvent(writer, {
        type: "row",
        row: {
          ...queuedRow(transaction),
          modelId: options.modelId,
          rulesApplied: options.useRules,
          occurredAt: Date.now(),
        },
      });
    }
  } finally {
    writer.releaseLock();
  }
}

async function emitBatchProgress(
  batchIndex: number,
  totalBatches: number,
  rowIds: string[],
  status: "processing" | "completed",
): Promise<void> {
  "use step";
  const writer = getWritable<string>().getWriter();
  try {
    await writeEvent(writer, {
      type: "batch",
      batchIndex,
      totalBatches,
      rowIds,
      status,
    });
  } finally {
    writer.releaseLock();
  }
}

async function classifyRow(
  transaction: TransactionInput,
  options: RunOptions,
): Promise<ClassificationRow["status"]> {
  "use step";
  const writer = getWritable<string>().getWriter();
  const startedAt = Date.now();
  const base = {
    ...queuedRow(transaction),
    modelId: options.modelId,
    rulesApplied: options.useRules,
  };
  async function emit(row: ClassificationRow) {
    await writeEvent(writer, {
      type: "row",
      row: {
        ...row,
        occurredAt: Date.now(),
        rowElapsedMs: Date.now() - startedAt,
      },
    });
  }
  try {
    await emit({ ...base, status: "rules" });
    const rule = options.useRules ? classifyByRule(transaction) : null;
    if (rule) {
      await emit({ ...base, ...rule });
      return rule.status;
    }
    await emit({ ...base, status: "jev" });
    try {
      const trace = await evaluateTransaction(transaction, options);
      await emit({ ...base, status: "evaluated", trace });
      await emit({ ...base, status: "policy", trace });
      const result = {
        ...base,
        ...decideJevAnswers(
          transaction,
          trace.answers.movement,
          trace.answers.category,
        ),
        trace,
      };
      await emit(result);
      return result.status;
    } catch {
      const failed: ClassificationRow = {
        ...base,
        status: "failed",
        reason:
          "Model evaluation failed. Check Gateway access, model availability, and retention support, then rerun. No fallback was used.",
      };
      await emit(failed);
      return failed.status;
    }
  } finally {
    writer.releaseLock();
  }
}

async function emitDone(
  runId: string,
  status: "completed" | "failed",
): Promise<void> {
  "use step";
  const writable = getWritable<string>();
  const writer = writable.getWriter();
  try {
    await writeEvent(writer, { type: "done", runId, status });
  } finally {
    writer.releaseLock();
  }
  await writable.close();
}

export async function classifyTransactionsWorkflow(
  transactions: TransactionInput[],
  options: RunOptions = defaultRunOptions,
): Promise<{ status: "completed" | "failed" }> {
  "use workflow";
  const runId = getWorkflowMetadata().workflowRunId;
  await emitQueuedRows(transactions, options);
  const batchSize = 4;
  const totalBatches = Math.ceil(transactions.length / batchSize);
  let failed = false;
  for (let index = 0; index < transactions.length; index += batchSize) {
    const batch = transactions.slice(index, index + batchSize);
    const batchIndex = index / batchSize;
    const rowIds = batch.map((transaction) => transaction.id);
    await emitBatchProgress(batchIndex, totalBatches, rowIds, "processing");
    const statuses = await Promise.all(
      batch.map((transaction) => classifyRow(transaction, options)),
    );
    if (statuses.includes("failed")) failed = true;
    await emitBatchProgress(batchIndex, totalBatches, rowIds, "completed");
  }
  const status = failed ? "failed" : "completed";
  await emitDone(runId, status);
  if (failed)
    throw new FatalError("One or more transactions could not be classified.");
  return { status };
}

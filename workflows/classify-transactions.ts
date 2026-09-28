import { FatalError, getWorkflowMetadata, getWritable } from "workflow";
import { classifyWithJev } from "@/lib/classification/jev";
import { queuedRow } from "@/lib/classification/input";
import { classifyByRule } from "@/lib/classification/rules";
import type { ClassificationRow, RunEvent, TransactionInput } from "@/lib/transactions/types";

async function writeEvent(writer: WritableStreamDefaultWriter<string>, event: RunEvent): Promise<void> {
  await writer.write(`${JSON.stringify(event)}\n`);
}

async function emitQueuedRows(transactions: TransactionInput[]): Promise<void> {
  "use step";
  const writer = getWritable<string>().getWriter();
  try {
    for (const transaction of transactions) {
      await writeEvent(writer, { type: "row", row: queuedRow(transaction) });
    }
  } finally {
    writer.releaseLock();
  }
}

async function classifyRow(transaction: TransactionInput): Promise<ClassificationRow["status"]> {
  "use step";
  const writer = getWritable<string>().getWriter();
  try {
    await writeEvent(writer, { type: "row", row: { ...queuedRow(transaction), status: "rules" } });
    const rule = classifyByRule(transaction);
    if (rule) {
      await writeEvent(writer, { type: "row", row: rule });
      return rule.status;
    }

    await writeEvent(writer, { type: "row", row: { ...queuedRow(transaction), status: "jev" } });
    try {
      const result = await classifyWithJev(transaction);
      await writeEvent(writer, { type: "row", row: result });
      return result.status;
    } catch {
      const failed: ClassificationRow = {
        ...queuedRow(transaction),
        status: "failed",
        reason: "The classifier was unavailable. Check AI Gateway access and try again.",
      };
      await writeEvent(writer, { type: "row", row: failed });
      return failed.status;
    }
  } finally {
    writer.releaseLock();
  }
}

async function emitDone(runId: string, status: "completed" | "failed"): Promise<void> {
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

export async function classifyTransactionsWorkflow(transactions: TransactionInput[]): Promise<{ status: "completed" | "failed" }> {
  "use workflow";
  const runId = getWorkflowMetadata().workflowRunId;
  await emitQueuedRows(transactions);
  let failed = false;
  for (let index = 0; index < transactions.length; index += 4) {
    const statuses = await Promise.all(transactions.slice(index, index + 4).map(classifyRow));
    if (statuses.includes("failed")) failed = true;
  }
  const status = failed ? "failed" : "completed";
  await emitDone(runId, status);
  if (failed) throw new FatalError("One or more transactions could not be classified.");
  return { status };
}

import { z } from "zod";
import type { ClassificationRow, TransactionInput } from "@/lib/transactions/types";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});

export const transactionInputSchema: z.ZodType<TransactionInput> = z.object({
  id: z.string().trim().min(1).max(100),
  date: isoDate,
  description: z.string().trim().min(1).max(200),
  amountMinor: z.number().int().safe().refine((value) => value !== 0),
  currency: z.enum(["CAD", "USD"]),
}).strict();

export const runInputSchema = z.object({
  transactions: z.array(transactionInputSchema).min(1).max(25).refine(
    (transactions) => new Set(transactions.map((transaction) => transaction.id)).size === transactions.length,
  ),
}).strict();

export function queuedRow(transaction: TransactionInput): ClassificationRow {
  return {
    ...transaction,
    status: "queued",
    category: null,
    movement: null,
    confidence: null,
    source: null,
    reason: null,
  };
}

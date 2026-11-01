import { z } from "zod";
import { decisionModels, getDecisionModel } from "./models";
import type {
  ClassificationRow,
  TransactionInput,
} from "@/lib/transactions/types";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T12:00:00.000Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  });

export const transactionInputSchema: z.ZodType<TransactionInput> = z
  .object({
    id: z.string().trim().min(1).max(100),
    date: isoDate,
    description: z.string().trim().min(1).max(200),
    amountMinor: z
      .number()
      .int()
      .safe()
      .refine((value) => value !== 0),
    currency: z.enum(["CAD", "USD"]),
  })
  .strict();

export const runOptionsSchema = z
  .object({
    modelId: z
      .enum(decisionModels.map((model) => model.id))
      .default("typesafe-ai/jev"),
    useRules: z.boolean().default(true),
    syntheticData: z.boolean().default(false),
  })
  .strict()
  .refine(
    (options) =>
      getDecisionModel(options.modelId).zeroDataRetention ||
      options.syntheticData,
    {
      message: "This model requires explicitly acknowledged synthetic data.",
    },
  );

export const runInputSchema = z
  .object({
    options: runOptionsSchema.default({
      modelId: "typesafe-ai/jev",
      useRules: true,
      syntheticData: false,
    }),
    transactions: z
      .array(transactionInputSchema)
      .min(1)
      .max(25)
      .refine(
        (transactions) =>
          new Set(transactions.map((transaction) => transaction.id)).size ===
          transactions.length,
      ),
  })
  .strict();

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

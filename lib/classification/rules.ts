import type { ClassificationRow, TransactionInput } from "@/lib/transactions/types";
import { queuedRow } from "./input";

export function classifyByRule(transaction: TransactionInput): ClassificationRow | null {
  const description = transaction.description.toLowerCase();

  if (/\b(?:transfer (?:between|to|from) (?:(?:my|our)(?: own)?|own) accounts?|payment (?:to|of) (?:(?:my|our)(?: own)?|own) credit card)\b/.test(description)) {
    return {
      ...queuedRow(transaction),
      status: "classified",
      movement: "transfer",
      confidence: 1,
      source: "rule",
      reason: "The description explicitly identifies a transfer between owned accounts.",
    };
  }

  if (transaction.amountMinor < 0 && /^(?:monthly )?(?:bank|account|wire) (?:service )?fee$/.test(description.trim())) {
    return {
      ...queuedRow(transaction),
      status: "classified",
      category: "Bank fees",
      movement: "expense",
      confidence: 1,
      source: "rule",
      reason: "The description explicitly identifies a bank fee.",
    };
  }

  return null;
}

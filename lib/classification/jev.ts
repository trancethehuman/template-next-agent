import { experimental_evaluate as evaluate } from "ai";
import type {
  ClassificationRow,
  TransactionInput,
} from "@/lib/transactions/types";
import { queuedRow } from "./input";
import { defaultRunOptions, getDecisionModel } from "./models";
import { decisionQuestions, evaluationState } from "./questions";
import type { DecisionTrace, RunOptions } from "@/lib/transactions/types";

export const CLASSIFIER_MODEL = "typesafe-ai/jev";
export const CLASSIFIER_VERSION = "transaction-demo-v2";

const categoryLabels = {
  software: "Software & cloud",
  travel: "Travel",
  meals: "Meals",
  office: "Office & equipment",
  professional: "Professional services",
  marketing: "Marketing",
  bank_fees: "Bank fees",
  income: "Income",
  other: "Other business expense",
} as const;

type CategoryChoice = keyof typeof categoryLabels | "none";
type MovementChoice =
  | "purchase"
  | "customer_payment"
  | "supplier_refund"
  | "own_transfer"
  | "bank_fee"
  | "unclear";

interface ChoiceAnswer {
  choice: string;
  probabilities?: Record<string, number>;
}

export function selectedProbability(answer: ChoiceAnswer): number | null {
  const value = answer.probabilities?.[answer.choice];
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
    ? value
    : null;
}

function hasClearLead(answer: ChoiceAnswer, minimum: number): boolean {
  const selected = selectedProbability(answer);
  if (selected === null) return false;
  const runnerUp = Math.max(
    0,
    ...Object.entries(answer.probabilities ?? {})
      .filter(([choice]) => choice !== answer.choice)
      .map(([, probability]) => probability),
  );
  return selected >= minimum && selected - runnerUp >= 0.2;
}

export function decideJevAnswers(
  transaction: TransactionInput,
  movementAnswer: ChoiceAnswer,
  categoryAnswer: ChoiceAnswer,
): ClassificationRow {
  const movementChoice = movementAnswer.choice as MovementChoice;
  const categoryChoice = categoryAnswer.choice as CategoryChoice;
  const movement =
    movementChoice === "own_transfer"
      ? "transfer"
      : movementChoice === "customer_payment" ||
          movementChoice === "supplier_refund"
        ? "income"
        : movementChoice === "purchase" || movementChoice === "bank_fee"
          ? "expense"
          : null;
  const category = Object.hasOwn(categoryLabels, categoryChoice)
    ? categoryLabels[categoryChoice as keyof typeof categoryLabels]
    : null;
  const movementProbability = selectedProbability(movementAnswer);
  const categoryProbability =
    movement === "transfer" ? 1 : selectedProbability(categoryAnswer);
  const confidence =
    movementProbability === null || categoryProbability === null
      ? null
      : Math.min(movementProbability, categoryProbability);
  const directionFits =
    transaction.amountMinor > 0
      ? movementChoice === "customer_payment" ||
        movementChoice === "supplier_refund" ||
        movementChoice === "own_transfer"
      : movementChoice === "purchase" ||
        movementChoice === "bank_fee" ||
        movementChoice === "own_transfer";
  const categoryFits =
    movement === "transfer"
      ? true
      : movement === "income"
        ? categoryChoice === "income"
        : category !== null && categoryChoice !== "income";
  const accepted =
    movement !== null &&
    directionFits &&
    categoryFits &&
    hasClearLead(movementAnswer, 0.85) &&
    (movement === "transfer" || hasClearLead(categoryAnswer, 0.9));

  return {
    ...queuedRow(transaction),
    status: accepted ? "classified" : "needs_review",
    category: movement === "transfer" ? null : category,
    movement,
    confidence,
    source: "model",
    reason: accepted
      ? "The classifier found a clear movement type and category."
      : !directionFits || !categoryFits
        ? "The suggested classification conflicts with the transaction direction or category."
        : "The evidence or model probabilities are too uncertain to classify automatically.",
  };
}

function readConfidence(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, number] =>
      typeof entry[1] === "number" &&
      Number.isFinite(entry[1]) &&
      entry[1] >= 0 &&
      entry[1] <= 1,
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export async function evaluateTransaction(
  transaction: TransactionInput,
  options: RunOptions,
): Promise<DecisionTrace> {
  const model = getDecisionModel(options.modelId);
  if (!model.zeroDataRetention && !options.syntheticData)
    throw new Error("Synthetic data acknowledgement required.");
  const startedAt = Date.now();
  const result = await evaluate({
    model: options.modelId,
    state: evaluationState(transaction),
    questions: decisionQuestions,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(45_000),
    providerOptions: {
      gateway: { zeroDataRetention: model.zeroDataRetention },
    },
  });
  return {
    modelId: options.modelId,
    responseModelId: result.response.modelId,
    version: CLASSIFIER_VERSION,
    startedAt,
    finishedAt: Date.now(),
    elapsedMs: Date.now() - startedAt,
    answers: result.answers,
    nativeConfidence: readConfidence(
      result.providerMetadata?.typesafe?.confidence,
    ),
    usage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens,
    },
  };
}

export async function classifyWithJev(
  transaction: TransactionInput,
): Promise<ClassificationRow> {
  const trace = await evaluateTransaction(transaction, defaultRunOptions);
  return {
    ...decideJevAnswers(
      transaction,
      trace.answers.movement,
      trace.answers.category,
    ),
    trace,
  };
}

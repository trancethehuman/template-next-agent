import { getDecisionModel } from "@/lib/classification/models";
import type { ClassificationRow } from "@/lib/transactions/types";
import { isTerminalStatus } from "./run-progress";

export type Stage =
  | "input"
  | "rules"
  | "model"
  | "answers"
  | "policy"
  | "outcome";

export function stageForStatus(status: ClassificationRow["status"]): Stage {
  if (isTerminalStatus(status)) return "outcome";
  return (
    {
      queued: "input",
      rules: "rules",
      jev: "model",
      evaluated: "answers",
      policy: "policy",
    } as const
  )[status as "queued" | "rules" | "jev" | "evaluated" | "policy"];
}

function percent(value: number | undefined | null): string {
  if (value == null) return "Not returned";
  if (value > 0 && value < 0.0005) return "<0.05%";
  if (value < 1 && value > 0.9995) return ">99.95%";
  return `${(value * 100).toFixed(1)}%`;
}

// Only use the event currently revealed to the viewer. Later answers in the
// completed run must not appear in a tooltip during an earlier playback step.
export function stepMetadata(
  stage: Stage,
  current: ClassificationRow,
): [string, string][] {
  const trace = current.trace;
  const model = getDecisionModel(current.modelId ?? "typesafe-ai/jev");
  const terminal = isTerminalStatus(current.status);
  const ruleMatch = terminal && current.source === "rule";
  switch (stage) {
    case "input":
      return [
        ["Date", current.date],
        [
          "Amount",
          `${current.currency} ${(Math.abs(current.amountMinor) / 100).toFixed(2)}`,
        ],
        ["Direction", current.amountMinor < 0 ? "Paid out" : "Received in"],
      ];
    case "rules":
      return [
        [
          "Rules",
          current.rulesApplied === false ? "Turned off" : "Transfers and fees",
        ],
        [
          "Result",
          ruleMatch
            ? (current.reason ?? "Matched")
            : stageForStatus(current.status) === "input"
              ? "Not checked yet"
              : current.status === "rules"
                ? "Checking"
                : "No match · model needed",
        ],
      ];
    case "model":
      return [
        ["Provider", model.provider],
        ["Model", model.id],
        [
          "Request time",
          trace
            ? `${trace.elapsedMs.toLocaleString()} ms`
            : ruleMatch
              ? "Skipped · rule matched"
              : "Not returned yet",
        ],
        [
          "Tokens",
          trace
            ? `${trace.usage.inputTokens ?? "—"} in / ${trace.usage.outputTokens ?? "—"} out`
            : "Not returned yet",
        ],
        ...(trace ? [["Questions", trace.version] as [string, string]] : []),
      ];
    case "answers": {
      if (!trace)
        return [
          [
            "Answers",
            ruleMatch ? "Skipped · no model call" : "Not returned yet",
          ],
        ];
      const { movement, category, evidence, ownAccount } = trace.answers;
      return [
        [
          "Money type",
          `${movement.choice} · ${percent(movement.probabilities?.[movement.choice])}`,
        ],
        [
          "Category",
          `${category.choice} · ${percent(category.probabilities?.[category.choice])}`,
        ],
        ["Evidence score", `${evidence.score.toFixed(3)} / 2`],
        ["Own account · P(true)", percent(ownAccount.probability)],
        ...(trace.nativeConfidence
          ? Object.entries(trace.nativeConfidence).map(
              ([key, value]): [string, string] => [
                `Provider confidence · ${key}`,
                percent(value),
              ],
            )
          : []),
      ];
    }
    case "policy":
      return [
        ["Money type", "At least 85%"],
        ["Category", "At least 90%"],
        ["Lead over next choice", "At least 20 points"],
        ["Direction", "Must agree with the row"],
        ["Score and P(true)", "For teaching; do not decide acceptance"],
      ];
    case "outcome":
      return [
        [
          "Result",
          terminal
            ? current.status === "classified"
              ? "Classified"
              : current.status === "needs_review"
                ? "Needs review"
                : "Failed"
            : "Not reached yet",
        ],
        [
          "Category",
          terminal ? (current.category ?? current.movement ?? "—") : "Pending",
        ],
        [
          "Selected probability",
          terminal && !ruleMatch ? percent(current.confidence) : "—",
        ],
        [
          "Row time",
          terminal && current.rowElapsedMs != null
            ? `${current.rowElapsedMs.toLocaleString()} ms`
            : "Not finished yet",
        ],
      ];
  }
}

export function stepExplanation(
  stage: Stage,
  current: ClassificationRow,
): string {
  const model = getDecisionModel(current.modelId ?? "typesafe-ai/jev");
  switch (stage) {
    case "input":
      return "We read the date, description and amount, then check that the row is valid.";
    case "rules":
      return current.rulesApplied === false
        ? "Rules are turned off for this run, so every row goes to the model."
        : "Simple rules catch clear transfers and fees. Other transactions go to the model.";
    case "model":
      return `${model.label} answers four fixed questions in one call. It chooses from the options we provide.`;
    case "answers":
      return "The model returns a money type, a category, an evidence score and the chance this is an own-account transfer.";
    case "policy":
      return "Our code checks the chosen answers and their probabilities. Low or conflicting evidence goes to review.";
    case "outcome":
      return current.source === "rule"
        ? "A simple rule matched. This row was handled by code, so the model was skipped."
        : current.status === "needs_review"
          ? "This row needs a person to review it. The answers did not meet our checks."
          : current.status === "failed"
            ? "The model call failed. Check access and rerun this transaction."
            : "The answers passed our checks. This row is classified, and no accounting entry is posted.";
  }
}

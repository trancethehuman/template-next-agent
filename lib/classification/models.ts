import type { RunOptions } from "@/lib/transactions/types";

// Native evaluation models verified against Gateway's catalogue on 2026-10-11.
// Keep this allowlist server-controlled: clients cannot request arbitrary models.
export const decisionModels = [
  {
    id: "typesafe-ai/jev",
    label: "Jev",
    provider: "TypeSafe",
    zeroDataRetention: true,
  },
  {
    id: "openai/gpt-6-luna-decisions",
    label: "OpenAI Decisions API",
    provider: "OpenAI",
    zeroDataRetention: false,
  },
  {
    id: "microsoft/microsoft-decision-1",
    label: "Microsoft Decision 1",
    provider: "Microsoft",
    zeroDataRetention: true,
  },
  {
    id: "liquid/d1",
    label: "Liquid D1",
    provider: "Liquid",
    zeroDataRetention: false,
  },
  {
    id: "convaiinnovations/laya",
    label: "Laya",
    provider: "ConvAI",
    zeroDataRetention: false,
  },
] as const;

export type DecisionModelId = (typeof decisionModels)[number]["id"];

export const defaultRunOptions: RunOptions = {
  modelId: "typesafe-ai/jev",
  useRules: true,
  syntheticData: false,
};

export function getDecisionModel(id: DecisionModelId) {
  return decisionModels.find((model) => model.id === id)!;
}

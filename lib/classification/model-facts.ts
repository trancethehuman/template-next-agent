import { decisionModels } from "./models";
import type { DecisionModelId } from "./models";

export const modelCatalogueUrl = "https://ai-gateway.vercel.sh/v1/models";

export interface ModelFacts {
  id: DecisionModelId;
  contextTokens: number | null;
  inputUsdPerMillion: number | null;
  outputUsdPerMillion: number | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonnegative(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim()))
    return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function parseModelFacts(value: unknown): ModelFacts[] {
  const data = record(value)?.data;
  if (!Array.isArray(data)) throw new Error("Model catalogue is unavailable.");
  return decisionModels.flatMap(({ id }) => {
    const model = data.map(record).find((item) => item?.id === id);
    if (!model || model.type !== "evaluation") return [];
    const pricing = record(model.pricing);
    const input = nonnegative(pricing?.input);
    const output = nonnegative(pricing?.output);
    const context = nonnegative(model.context_window);
    return [
      {
        id,
        contextTokens: context && Number.isInteger(context) ? context : null,
        inputUsdPerMillion: input === null ? null : input * 1_000_000,
        outputUsdPerMillion: output === null ? null : output * 1_000_000,
      },
    ];
  });
}

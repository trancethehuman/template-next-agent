import { expect, test } from "bun:test";
import { parseModelFacts } from "@/lib/classification/model-facts";

test("public model stats preserve zero prices and missing prices, and exclude arbitrary models", () => {
  const facts = parseModelFacts({
    data: [
      {
        id: "typesafe-ai/jev",
        type: "evaluation",
        context_window: 32000,
        pricing: { input: "0.000000042", output: "0" },
      },
      {
        id: "openai/gpt-6-luna-decisions",
        type: "evaluation",
        context_window: 1050000,
        pricing: { input: "0.0000001" },
      },
      {
        id: "arbitrary/model",
        type: "evaluation",
        context_window: 32,
        pricing: { input: "0" },
      },
    ],
  });
  expect(facts).toHaveLength(2);
  expect(facts[0]).toMatchObject({
    id: "typesafe-ai/jev",
    contextTokens: 32000,
    outputUsdPerMillion: 0,
  });
  expect(facts[0].inputUsdPerMillion).toBeCloseTo(0.042, 8);
  expect(facts[1].outputUsdPerMillion).toBeNull();
});

test("invalid and missing catalogue values never become fabricated stats", () => {
  expect(() => parseModelFacts({})).toThrow();
  const [fact] = parseModelFacts({
    data: [
      {
        id: "typesafe-ai/jev",
        type: "evaluation",
        context_window: -1,
        pricing: { input: "", output: "Infinity" },
      },
    ],
  });
  expect(fact.contextTokens).toBeNull();
  expect(fact.inputUsdPerMillion).toBeNull();
  expect(fact.outputUsdPerMillion).toBeNull();
});

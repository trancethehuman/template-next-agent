import assert from "node:assert/strict";
import { test } from "node:test";
import { runInputSchema } from "../../lib/classification/input";
import { classifyByRule } from "../../lib/classification/rules";
import { decideJevAnswers } from "../../lib/classification/jev";
import { authorizeDemoRequest } from "../../lib/classification/auth";
import type { TransactionInput } from "../../lib/transactions/types";

const transaction: TransactionInput = {
  id: "sample-1",
  date: "2026-09-28",
  description: "Cloud subscription",
  amountMinor: -2900,
  currency: "CAD",
};

test("run input accepts a bounded, valid transaction and trims text", () => {
  const result = runInputSchema.safeParse({
    transactions: [{ ...transaction, description: "  Cloud subscription  " }],
  });
  assert.equal(result.success, true);
  if (result.success)
    assert.equal(result.data.transactions[0].description, "Cloud subscription");
});

test("run input rejects invalid dates, duplicates, zero amounts, and oversized batches", () => {
  const samples = [
    [{ ...transaction, date: "2026-02-30" }],
    [transaction, { ...transaction }],
    [{ ...transaction, amountMinor: 0 }],
    Array.from({ length: 26 }, (_, index) => ({
      ...transaction,
      id: `row-${index}`,
    })),
  ];
  for (const transactions of samples)
    assert.equal(runInputSchema.safeParse({ transactions }).success, false);
});

test("rules recognize an explicit own-account transfer without sending it to Jev", () => {
  const result = classifyByRule({
    ...transaction,
    description: "Transfer between our own accounts",
  });
  assert.equal(result?.status, "classified");
  assert.equal(result?.movement, "transfer");
  assert.equal(result?.category, null);
  assert.equal(result?.source, "rule");
});

test("rules leave ordinary purchases for Jev", () => {
  assert.equal(classifyByRule(transaction), null);
});

test("Jev answers classify a clear purchase", () => {
  const result = decideJevAnswers(
    transaction,
    { choice: "purchase", probabilities: { purchase: 0.96, unclear: 0.04 } },
    { choice: "software", probabilities: { software: 0.94, other: 0.06 } },
  );
  assert.equal(result.status, "classified");
  assert.equal(result.category, "Software & cloud");
  assert.equal(result.movement, "expense");
  assert.equal(result.confidence, 0.94);
});

test("uncertain or direction-conflicting Jev answers require review", () => {
  const uncertain = decideJevAnswers(
    transaction,
    { choice: "purchase", probabilities: { purchase: 0.6, unclear: 0.4 } },
    { choice: "software", probabilities: { software: 0.95, other: 0.05 } },
  );
  assert.equal(uncertain.status, "needs_review");

  const conflict = decideJevAnswers(
    transaction,
    {
      choice: "customer_payment",
      probabilities: { customer_payment: 0.99, unclear: 0.01 },
    },
    { choice: "income", probabilities: { income: 0.99, none: 0.01 } },
  );
  assert.equal(conflict.status, "needs_review");
  assert.match(conflict.reason ?? "", /conflicts/);
});

test("production run endpoints fail closed without an access token", () => {
  const response = authorizeDemoRequest(
    new Request("https://example.test/api/runs"),
    { NODE_ENV: "production" },
  );
  assert.equal(response?.status, 503);
  const environment = {
    NODE_ENV: "production",
    DEMO_ACCESS_TOKEN: "test-token",
  };
  const denied = authorizeDemoRequest(
    new Request("https://example.test/api/runs"),
    environment,
  );
  assert.equal(denied?.status, 401);
  const accepted = authorizeDemoRequest(
    new Request("https://example.test/api/runs", {
      headers: { Authorization: "Bearer test-token" },
    }),
    environment,
  );
  assert.equal(accepted, null);
});

test("loopback development uses server configuration without a browser token", () => {
  const environment = {
    NODE_ENV: "development",
    DEMO_ACCESS_TOKEN: "test-token",
  };
  for (const path of ["/api/runs", "/api/runs/synthetic-run/stream"]) {
    assert.equal(
      authorizeDemoRequest(
        new Request(`http://127.0.0.1:3000${path}`, {
          headers: {
            host: "127.0.0.1:3000",
            origin: "http://127.0.0.1:3000",
            "sec-fetch-site": "same-origin",
          },
        }),
        environment,
      ),
      null,
    );
  }
  assert.equal(
    authorizeDemoRequest(
      new Request("http://127.0.0.1:3000/api/runs"),
      environment,
    ),
    null,
  );
  assert.equal(
    authorizeDemoRequest(
      new Request("http://localhost:3000/api/runs", {
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
          "sec-fetch-site": "same-origin",
        },
      }),
      environment,
    ),
    null,
  );
  assert.equal(
    authorizeDemoRequest(
      new Request("http://localhost:3000/api/runs", {
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://localhost:3000",
          "sec-fetch-site": "same-site",
        },
      }),
      environment,
    )?.status,
    401,
  );
  const hostileHeaders: Record<string, string>[] = [
    { origin: "https://example.test" },
    { "sec-fetch-site": "cross-site" },
    { host: "example.test" },
  ];
  for (const headers of hostileHeaders) {
    assert.equal(
      authorizeDemoRequest(
        new Request("http://127.0.0.1:3000/api/runs", { headers }),
        environment,
      )?.status,
      401,
    );
  }
  assert.equal(
    authorizeDemoRequest(
      new Request("https://example.test/api/runs"),
      environment,
    )?.status,
    401,
  );
  assert.equal(
    authorizeDemoRequest(new Request("http://127.0.0.1:3000/api/runs"), {
      ...environment,
      NODE_ENV: "production",
    })?.status,
    401,
  );
  assert.equal(
    authorizeDemoRequest(new Request("https://example.test/api/runs"), {
      NODE_ENV: "development",
    })?.status,
    503,
  );
});

test("model selection is bounded and models without ZDR require synthetic acknowledgement", () => {
  assert.equal(
    runInputSchema.safeParse({
      transactions: [transaction],
      options: { modelId: "arbitrary/model" },
    }).success,
    false,
  );
  for (const modelId of [
    "openai/gpt-6-luna-decisions",
    "liquid/d1",
    "convaiinnovations/laya",
  ]) {
    assert.equal(
      runInputSchema.safeParse({
        transactions: [transaction],
        options: { modelId },
      }).success,
      false,
    );
    const acknowledged = runInputSchema.safeParse({
      transactions: [transaction],
      options: { modelId, syntheticData: true, useRules: false },
    });
    assert.equal(acknowledged.success, true);
    if (acknowledged.success) {
      assert.equal(acknowledged.data.options.modelId, modelId);
      assert.equal(acknowledged.data.options.useRules, false);
    }
  }
  const defaults = runInputSchema.parse({ transactions: [transaction] });
  assert.deepEqual(defaults.options, {
    modelId: "typesafe-ai/jev",
    useRules: true,
    syntheticData: false,
  });
});

test("missing probabilities require review and remain missing, rather than displaying a fabricated zero", () => {
  const result = decideJevAnswers(
    transaction,
    { choice: "purchase" },
    { choice: "software" },
  );
  assert.equal(result.status, "needs_review");
  assert.equal(result.confidence, null);
});

test("a high selected probability cannot bypass direction or category policy", () => {
  const result = decideJevAnswers(
    transaction,
    { choice: "purchase", probabilities: { purchase: 0.99, unclear: 0.01 } },
    { choice: "income", probabilities: { income: 0.99, none: 0.01 } },
  );
  assert.equal(result.status, "needs_review");
  assert.match(result.reason ?? "", /conflicts/);
});

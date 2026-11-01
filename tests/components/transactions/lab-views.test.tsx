import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { executionStatusLabel } from "@/components/transactions/execution-status";
import { createRunProgress } from "@/components/transactions/run-progress";
import { mockTransactions } from "@/lib/transactions/mock";
import { getTransactionView, transactionViews } from "@/lib/transactions/views";

let query = "";
mock.module("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(query),
}));

const { TransactionsPlayground } =
  await import("@/components/transactions/transactions-playground");

function renderView(view: string) {
  query = `view=${view}`;
  return renderToStaticMarkup(<TransactionsPlayground />);
}

describe("focused decision lab views", () => {
  test("the walkthrough starts with the model and orders data before the demo and results", () => {
    expect(getTransactionView(null)).toBe("models");
    expect(getTransactionView("unrecognised")).toBe("models");
    expect(transactionViews.map((view) => view.id)).toEqual([
      "models",
      "import",
      "step",
      "live",
      "transactions",
      "compare",
      "settings",
    ]);
    const html = renderView("models");
    expect(html).toContain("Jev model card");
    expect(html).toContain("Next: add transactions");
    expect(html).not.toContain("Choose CSV");
  });
  test("unsubmitted and rejected runs never appear to be queued in Workflow", () => {
    const row = createRunProgress([mockTransactions[0]]).rows[0];
    expect(executionStatusLabel(row)).toBe("Ready");
    expect(executionStatusLabel(row, { state: "failed" })).toBe("Not started");
    expect(
      executionStatusLabel(row, { state: "running", runId: "synthetic-run" }),
    ).toBe("Queued");
    expect(
      executionStatusLabel(
        { ...row, status: "failed" },
        { state: "failed", runId: "synthetic-run" },
      ),
    ).toBe("Failed");
  });
  test("import exposes file intake without model settings, graphs, or results", () => {
    const html = renderView("import");
    expect(html).toContain("Choose CSV");
    expect(html).toContain("Mock Amex CSV");
    expect(html).not.toContain("Demo access token");
    expect(html).not.toContain("Decision workflow graph");
    expect(html).not.toContain("Model comparisons");
  });

  test("settings keeps deployment credentials out of intake and model selection on its own page", () => {
    const html = renderView("settings");
    expect(html).toContain("Demo access token");
    expect(html).not.toContain("Decision model");
    expect(html).toContain("Check simple rules first");
    expect(html).not.toContain("Choose CSV");
    expect(html).not.toContain("Decision workflow graph");
    expect(html).not.toContain("<table");
  });

  test("local settings do not ask users to re-enter server tokens", () => {
    query = "view=settings";
    const html = renderToStaticMarkup(
      <TransactionsPlayground localDevelopment />,
    );
    expect(html).toContain("No access token entry is needed");
    expect(html).not.toContain("Demo access token");
    expect(html).not.toContain('type="password"');
  });

  test("empty result and processing views direct the user to import without fake runs", () => {
    for (const view of ["transactions", "step", "live", "compare"]) {
      const html = renderView(view);
      expect(html).toContain("No transactions yet");
      expect(html).not.toContain("Decision workflow graph");
      expect(html).not.toContain("Run complete");
      expect(html).not.toContain("<table");
    }
  });
});

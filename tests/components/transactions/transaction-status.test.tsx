import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { TransactionStatus } from "@/components/transactions/transactions-playground";
import type { ClassificationRow } from "@/lib/transactions/types";

const baseRow: ClassificationRow = {
  id: "sample-01",
  date: "2026-08-21",
  description: "Example",
  amountMinor: -100,
  currency: "CAD",
  category: null,
  movement: null,
  confidence: null,
  source: null,
  reason: null,
  status: "queued",
};

describe("TransactionStatus", () => {
  test("shows the failure explanation beneath the badge", () => {
    const html = renderToStaticMarkup(
      <TransactionStatus
        row={{
          ...baseRow,
          status: "failed",
          reason: "The classifier was unavailable. Check AI Gateway access and try again.",
        }}
      />,
    );
    expect(html).toContain("Failed");
    expect(html).toContain("The classifier was unavailable. Check AI Gateway access and try again.");
  });

  test("shows a review explanation in the row", () => {
    const html = renderToStaticMarkup(
      <TransactionStatus
        row={{
          ...baseRow,
          status: "needs_review",
          reason: "Merchant context was too ambiguous for a confident category.",
        }}
      />,
    );
    expect(html).toContain("Review needed");
    expect(html).toContain("Merchant context was too ambiguous for a confident category.");
  });
});

"use client";

import type { TransactionView } from "@/lib/transactions/views";
import { transactionViewHref } from "@/lib/transactions/views";

// Native history keeps the mounted lab, its live stream, and in-memory results.
// Next.js synchronizes this URL with useSearchParams and browser Back/Forward.
export function navigateTransactionView(view: TransactionView) {
  const href = transactionViewHref(view);
  if (`${window.location.pathname}${window.location.search}` !== href) {
    window.history.pushState(null, "", href);
  }
  window.scrollTo({ top: 0 });
}

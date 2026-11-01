export const transactionViews = [
  { id: "models", label: "1. Choose a model", title: "Choose a model" },
  { id: "import", label: "2. Add transactions", title: "Add transactions" },
  { id: "step", label: "3. Run the demo", title: "Run the demo" },
  { id: "live", label: "Full speed", title: "Run at full speed" },
  { id: "transactions", label: "4. View results", title: "View results" },
  { id: "compare", label: "5. Compare models", title: "Compare models" },
  { id: "settings", label: "Settings", title: "Settings" },
] as const;

export type TransactionView = (typeof transactionViews)[number]["id"];

export function getTransactionView(value: string | null): TransactionView {
  return transactionViews.find((view) => view.id === value)?.id ?? "models";
}

export function transactionViewHref(view: TransactionView): string {
  return `/transactions?view=${view}`;
}

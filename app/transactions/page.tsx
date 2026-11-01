import { Suspense } from "react";
import { TransactionsPlayground } from "@/components/transactions/transactions-playground";

export default function TransactionsPage() {
  return (
    <Suspense
      fallback={
        <p className="text-sm text-muted-foreground">Opening decision lab…</p>
      }
    >
      <TransactionsPlayground
        localDevelopment={process.env.NODE_ENV === "development"}
      />
    </Suspense>
  );
}

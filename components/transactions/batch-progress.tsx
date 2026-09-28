import { LoaderCircleIcon } from "lucide-react";

import { rowStatusLabel } from "@/components/transactions/row-steps";
import { isTerminalStatus } from "@/components/transactions/run-progress";
import type { BatchProgress } from "@/components/transactions/run-progress";
import { Badge } from "@/components/ui/badge";
import type { ClassificationRow } from "@/lib/transactions/types";
import { cn } from "@/lib/utils";

function BatchStatus({ status }: { status: BatchProgress["status"] }) {
  if (status === "processing") {
    return (
      <Badge className="rounded-none" variant="secondary">
        <LoaderCircleIcon aria-hidden="true" className="animate-spin" data-icon="inline-start" />
        Processing
      </Badge>
    );
  }

  return (
    <Badge className="rounded-none" variant={status === "completed" ? "default" : "outline"}>
      {status === "completed" ? "Complete" : "Waiting"}
    </Badge>
  );
}

export function BatchProgressCards({ batches, rows }: { batches: readonly BatchProgress[]; rows: readonly ClassificationRow[] }) {
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const completedBatches = batches.filter((batch) => batch.status === "completed").length;

  return (
    <section aria-label="Batch progress" className="border border-border bg-background">
      <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">Batch progress</h2>
          <p className="text-sm text-muted-foreground">Transactions run in groups of four.</p>
        </div>
        <p className="font-mono text-xs text-muted-foreground">
          {completedBatches} / {batches.length} complete
        </p>
      </div>

      <div className={cn("grid border-t border-border", batches.length > 1 && "sm:grid-cols-2", batches.length > 2 && "xl:grid-cols-3")}>
        {batches.map((batch) => {
          const batchRows = batch.rowIds.flatMap((id) => {
            const row = rowById.get(id);
            return row ? [row] : [];
          });
          const completed = batchRows.filter((row) => isTerminalStatus(row.status)).length;

          return (
            <div aria-label={`Batch ${batch.index + 1}`} className="flex flex-col gap-5 border-r border-b border-border bg-background p-6" key={batch.index} role="group">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                    Batch {String(batch.index + 1).padStart(2, "0")}
                  </p>
                  <p className="text-sm font-medium">
                    {completed} of {batchRows.length} rows finished
                  </p>
                </div>
                <BatchStatus status={batch.status} />
              </div>

              <ul className="border-t border-border">
                {batchRows.map((row) => (
                  <li className="flex items-start justify-between gap-4 border-b border-border py-2.5 text-xs" key={row.id}>
                    <span className="min-w-0 truncate" title={row.description}>{row.description}</span>
                    <span className="shrink-0 text-muted-foreground">{rowStatusLabel(row.status)}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

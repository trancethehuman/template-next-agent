import { LoaderCircleIcon } from "lucide-react";

import { rowStatusLabel } from "@/components/transactions/row-steps";
import { isTerminalStatus } from "@/components/transactions/run-progress";
import type { BatchProgress } from "@/components/transactions/run-progress";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ClassificationRow } from "@/lib/transactions/types";

function BatchStatus({ status }: { status: BatchProgress["status"] }) {
  if (status === "processing") {
    return <Badge variant="secondary"><LoaderCircleIcon aria-hidden="true" className="animate-spin" data-icon="inline-start" />Processing</Badge>;
  }
  return <Badge variant={status === "completed" ? "default" : "outline"}>{status === "completed" ? "Complete" : "Waiting"}</Badge>;
}

export function BatchProgressCards({ batches, rows }: { batches: readonly BatchProgress[]; rows: readonly ClassificationRow[] }) {
  const rowById = new Map(rows.map((row) => [row.id, row]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Batch progress</CardTitle>
        <CardDescription>Transactions run in groups of four. Each group and row updates as the workflow advances.</CardDescription>
        <CardAction><Badge variant="outline">{batches.filter((batch) => batch.status === "completed").length} of {batches.length} complete</Badge></CardAction>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {batches.map((batch) => {
          const batchRows = batch.rowIds.flatMap((id) => {
            const row = rowById.get(id);
            return row ? [row] : [];
          });
          const completed = batchRows.filter((row) => isTerminalStatus(row.status)).length;
          return (
            <Card className="gap-3 py-4" key={batch.index}>
              <CardHeader className="gap-1 px-4">
                <CardTitle className="text-sm">Batch {batch.index + 1} of {batches.length}</CardTitle>
                <CardDescription>{completed} of {batchRows.length} rows finished</CardDescription>
                <CardAction><BatchStatus status={batch.status} /></CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 px-4">
                {batchRows.map((row) => (
                  <div className="flex items-start justify-between gap-3 text-xs" key={row.id}>
                    <span className="min-w-0 truncate" title={row.description}>{row.description}</span>
                    <span className="shrink-0 text-muted-foreground">{rowStatusLabel(row.status)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </CardContent>
    </Card>
  );
}

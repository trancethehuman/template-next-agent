import { CircleCheckIcon, CircleHelpIcon, LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { isTerminalStatus } from "@/components/transactions/run-progress";
import type { ClassificationRow, ClassificationStatus } from "@/lib/transactions/types";

export function rowStatusLabel(status: ClassificationStatus): string {
  switch (status) {
    case "queued": return "Queued";
    case "rules": return "Checking rules";
    case "jev": return "Using Jev";
    case "classified": return "Classified";
    case "needs_review": return "Review needed";
    case "failed": return "Failed";
  }
}

function stepDescription(step: ClassificationRow): string {
  switch (step.status) {
    case "queued": return "Added to the classification workflow.";
    case "rules": return "Checking deterministic transaction rules.";
    case "jev": return "Asking Jev to classify a transaction that needs model judgment.";
    case "classified": return `Classified as ${step.movement === "transfer" ? "a transfer" : step.category ?? "a category"} by ${step.source === "rule" ? "a rule" : "Jev"}.`;
    case "needs_review": return "A person should review this classification before using it.";
    case "failed": return "The classifier could not finish this transaction.";
  }
}

function StepIcon({ step, active }: { step: ClassificationRow; active: boolean }) {
  if (step.status === "failed") return <TriangleAlertIcon aria-hidden="true" className="size-4 text-destructive" />;
  if (step.status === "needs_review") return <CircleHelpIcon aria-hidden="true" className="size-4 text-muted-foreground" />;
  if (active && !isTerminalStatus(step.status)) return <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin text-primary" />;
  return <CircleCheckIcon aria-hidden="true" className="size-4 text-primary" />;
}

export function RowSteps({ row, history }: { row: ClassificationRow; history: readonly ClassificationRow[] }) {
  return (
    <div className="flex flex-col gap-3 py-2 whitespace-normal">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Workflow steps</h3>
        <Badge variant="outline">{rowStatusLabel(row.status)}</Badge>
      </div>
      {history.length === 0 ? (
        <p className="text-sm text-muted-foreground">Waiting for this row to enter the workflow.</p>
      ) : (
        <ol aria-label={`Workflow steps for ${row.description}`} aria-live="polite" aria-relevant="additions text" className="flex flex-col gap-3">
          {history.map((step, index) => (
            <li className="flex items-start gap-3" key={`${step.id}-${step.status}`}>
              <span className="mt-0.5"><StepIcon active={index === history.length - 1} step={step} /></span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium">{rowStatusLabel(step.status)}</span>
                <span className="text-sm text-muted-foreground">{stepDescription(step)}</span>
                {step.reason && isTerminalStatus(step.status) && (
                  <span className="text-sm text-muted-foreground">{step.reason}</span>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
